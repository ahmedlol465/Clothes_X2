/**
 * Local clothing analysis (§9 AI PIPELINE).
 *
 * One entry point, `analyzeClothingImage`, takes real image bytes and returns
 * either a `non_clothing` rejection or a full set of attributes — every one of
 * them measured, none of them defaulted into existence.
 *
 *   what is it?    CLIP zero-shot against a declared label bank   (classify.js)
 *   what colour?   masked pixel statistics in CIELAB LCh          (color.js)
 *
 * There is no segmentation network and no colour network. For the photos this
 * app receives — one garment, plainly framed — a border-anchored flood fill and
 * Lab medians are both faster than a second net and, crucially, they degrade
 * loudly (`color.method`, `color.confidence`) instead of quietly.
 *
 * What comes back:
 *   success              true only when the gate passed
 *   error_type           'non_clothing' | 'unreadable_image' | 'model_unavailable'
 *   category/subcategory coarse slot + shopper's name
 *   color                named from garment pixels
 *   style/season/pattern/material   each with its own agreement evidence
 *   confidence           single honest number: agreement x attribute certainty
 *   model                id, licence, dtype — so a result is traceable
 *
 * Nothing here is cached per image; the expensive part (model + prompt bank) is
 * loaded once and reused.
 */
'use strict';

const path = require('path');

const encoder = require('./encoder');
const { classify } = require('./classify');
const { analyzeColor } = require('./color');
const { MODEL } = require('./prompts');

const MAX_BYTES = 12 * 1024 * 1024;

/** Magic-byte sniff. Upload endpoints lose the extension, so trust the bytes. */
function mimeFor(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 12 && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return 'image/jpeg';
}

/** Attribute keys that must be certain before they are reported as a fact. */
const ATTRIBUTES = ['style', 'season', 'pattern', 'material'];

/**
 * Analyse one image.
 *
 * @param {Buffer|Uint8Array} bytes   encoded image
 * @param {object} [opts]
 * @param {string} [opts.filename]     only used in the error message
 * @returns {Promise<object>} never throws for an unreadable or non-garment image
 */
async function analyzeClothingImage(bytes, opts = {}) {
  const filename = opts.filename || 'image';
  const base = {
    success: false,
    analyzedAt: new Date().toISOString(),
    model: { id: MODEL.id, licence: MODEL.licence, dtype: MODEL.dtype, embeddingDim: MODEL.embeddingDim },
  };

  if (!bytes || !bytes.length) {
    return { ...base, error_type: 'unreadable_image', error: 'no image bytes supplied' };
  }
  if (bytes.length > MAX_BYTES) {
    return {
      ...base,
      error_type: 'unreadable_image',
      error: `image is ${(bytes.length / 1048576).toFixed(1)}MB, limit is ${MAX_BYTES / 1048576}MB`,
    };
  }

  // Model first: a missing model is a deployment problem, not a photo problem,
  // and it must not be reported as "this is not clothing".
  if (!(await encoder.init())) {
    const st = await encoder.status();
    return {
      ...base,
      error_type: 'model_unavailable',
      error: st.error || 'clothing vision model failed to load',
      suggestion: 'npm install @huggingface/transformers and allow one model download',
    };
  }

  let image;
  try {
    // `RawImage.fromBlob` wants something with `.arrayBuffer()`; on Node that is
    // a real Blob, and the MIME type has to be right or the decoder guesses
    // wrong on the extensionless Buffer the server actually holds.
    const { RawImage } = require('@huggingface/transformers');
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    image = await RawImage.fromBlob(new Blob([buf], { type: mimeFor(buf) }));
  } catch (e) {
    return {
      ...base,
      error_type: 'unreadable_image',
      error: String(e.message || e).slice(0, 200),
      filename,
    };
  }

  let verdict;
  try {
    const vec = await encoder.embedImage(image);
    verdict = await classify(vec);
  } catch (e) {
    return {
      ...base,
      error_type: 'analysis_failed',
      error: String(e.message || e).slice(0, 200),
      filename,
    };
  }

  if (!verdict.isClothing) {
    return {
      ...base,
      error_type: 'non_clothing',
      error: verdict.reason,
      rejected: verdict.rejected,
      filename,
    };
  }

  // Colour is measured on the same bytes the classifier saw, so a garment that
  // fails to segment cannot silently contribute background pixels.
  let color;
  try {
    color = await analyzeColor(bytes);
  } catch (e) {
    color = {
      color: null,
      confidence: 0,
      method: 'failed',
      error: String(e.message || e).slice(0, 160),
    };
  }

  // Attribute certainty: the weakest of the four attributes caps how confident
  // the whole row can honestly be. One uncertain attribute (say "is this silk
  // or polyester?") should not certify the colour or the category with it.
  const certainties = ATTRIBUTES.map((k) => (verdict[k]?.confident ? verdict[k].share : 0));
  const weakest = certainties.length ? Math.min(...certainties) : 0;
  const agreement = verdict.agreement * (0.45 + 0.55 * weakest);

  const uncertain = ATTRIBUTES.filter((k) => !verdict[k]?.confident);

  const result = {
    ...base,
    success: true,
    confidence: Number(agreement.toFixed(4)),
    confidenceKind: 'agreement',
    category: verdict.category,
    subcategory: verdict.subcategory,
    color: color.color,
    pattern: verdict.pattern.value,
    material: verdict.material.value,
    style: verdict.style.value,
    season: verdict.season.value,
    formality: formalityFor(verdict),
    suggestedName: titleCase([color.color, verdict.subcategory]),
    gate: verdict.gate,
    agreement: verdict.agreement,
    colorDetail: color,
    evidence: {
      category: verdict.categoryEvidence,
      style: verdict.style,
      season: verdict.season,
      pattern: verdict.pattern,
      material: verdict.material,
    },
    uncertainAttributes: uncertain,
    filename,
  };

  return applyOverrides(result, opts);
}

/**
 * Formality is not read off the image: it is a property of the garment class.
 * Deriving it from the taxonomy's own scale keeps it consistent with how the
 * scoring engine reads `formality` on every other item.
 */
function formalityFor(verdict) {
  const bySubcategory = {
    Suit: 'Formal', Blazer: 'Smart Casual', 'Dress Shoes': 'Formal', 'Dress Shirt': 'Smart Casual',
    Coat: 'Smart Casual', Jacket: 'Casual', Hoodie: 'Casual', Sweater: 'Casual', Cardigan: 'Casual',
    'T-Shirt': 'Casual', Polo: 'Smart Casual', Blouse: 'Smart Casual', 'Tank Top': 'Casual',
    Skirt: 'Casual', Dress: 'Elegant', Jeans: 'Casual', Chinos: 'Smart Casual', Pants: 'Smart Casual',
    Shorts: 'Casual', Sneakers: 'Casual', Boots: 'Casual', Belt: 'Smart Casual', Scarf: 'Smart Casual',
    Sunglasses: 'Casual', Handbag: 'Smart Casual',
  };
  const byStyle = {
    Casual: 'Casual', 'Smart Casual': 'Smart Casual', Formal: 'Formal', Elegant: 'Elegant',
    Sporty: 'Sport', Streetwear: 'Casual', Preppy: 'Smart Casual', Boho: 'Casual',
    Minimal: 'Minimal', Vintage: 'Casual',
  };
  return bySubcategory[verdict.subcategory] || byStyle[verdict.style?.value] || 'Smart Casual';
}

/**
 * Fold in caller-supplied corrections.
 *
 * Only fields the user explicitly set win, and only over an automatic guess —
 * never over a rejection. A caller cannot use `overrides` to force a
 * non_clothing image into the wardrobe.
 */
function applyOverrides(result, overrides = {}) {
  if (!result || result.success === false) return result;
  const out = { ...result };
  const applied = [];
  for (const key of ['category', 'color', 'style', 'pattern', 'material', 'season', 'formality', 'name']) {
    const val = overrides[key];
    if (!val) continue;
    out[key] = val;
    if (key === 'name') out.suggestedName = val;
    applied.push(key);
    // An edited field is no longer an uncertain one, and is no longer evidence
    // for the original automatic value.
    out.uncertainAttributes = (out.uncertainAttributes || []).filter((k) => k !== key);
    out.userAdjusted = [...(out.userAdjusted || []), key];
  }
  if (applied.length) out.overridesApplied = applied;
  return out;
}

function titleCase(parts) {
  return parts
    .filter(Boolean)
    .map((p) => String(p).trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reads a stored image path relative to the backend storage root. */
function readStored(pathOrUrl, storageRoot) {
  const fs = require('fs');
  try {
    const rel = String(pathOrUrl).replace(/^\/+/, '');
    const full = path.isAbsolute(rel) ? rel : path.join(storageRoot, rel);
    return fs.existsSync(full) ? fs.readFileSync(full) : null;
  } catch {
    return null;
  }
}

module.exports = { analyzeClothingImage, formalityFor, MAX_BYTES };