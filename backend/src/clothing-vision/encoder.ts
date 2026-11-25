/**
 * Model loading and embedding for the local fashion classifier (§9 AI PIPELINE).
 *
 * One model does everything: `Marqo/marqo-fashionSigLIP` (default; marqo-fashionCLIP
 * with VISION_MODEL=clip), a fashion-domain model with Apache-2.0 weights
 * published as two separate ONNX towers. There is no
 * second network, no segmentation network and no colour network — the CLIP
 * towers cover "what is this", and pure-JS pixel maths covers "what colour is
 * it" (see color.js).
 *
 * The towers cannot be loaded with `AutoModel` because the repository has no
 * combined `onnx/model.onnx`, only `vision_model.onnx` and `text_model.onnx`, so
 * they are requested by class.
 *
 * Everything is lazy: `require` is cheap, the ONNX sessions and the ~1000-prompt
 * text bank are built on first use and then reused for the life of the process.
 * Callers only need `embedImage`; `status()` reports what actually loaded.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';

import * as P from './prompts';

// CLIP's own context length. Tokenising to the model's max length is not
// optional here: the exported text tower has `input_ids` pinned to [batch, 77],
// so a dynamically padded batch is rejected by the graph.
const CONTEXT_LENGTH = 77;
const MAX_PROMPTS_PER_BATCH = 64;

const state = {
  attempted: false,
  ready: false,
  error: null,
  tf: null,
  vision: null,
  text: null,
  processor: null,
  tokenizer: null,
  dim: null,
  /** Attribute bank, built once: { garments, nonClothing, styles, ... }. */
  bank: null,
  bankPromise: null,
  warm: false,
};

function transformers() {
  if (state.tf) return state.tf;
  // Optional dependency — a missing package must degrade, not crash the server.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require, import/no-extraneous-dependencies
    state.tf = require('@huggingface/transformers') as any;
  } catch (e) {
    state.error = e.code === 'MODULE_NOT_FOUND'
      ? '@huggingface/transformers not installed'
      : String(e.message || e).slice(0, 200);
    return null;
  }
  const { env } = state.tf;
  if (env?.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;
  // Keep weights inside the backend folder instead of the OS temp dir.
  env.cacheDir = path.join(__dirname, '..', '..', '.model-cache');
  env.allowLocalModels = true;
  return state.tf;
}

/** Load the two ONNX towers. Idempotent. */
async function init() {
  if (state.ready) return true;
  if (state.attempted) return state.ready;
  state.attempted = true;

  const tf = transformers();
  if (!tf) return false;

  if (/^(off|0|false|no)$/i.test(String(process.env.CLOTHING_VISION || ''))) {
    state.error = 'disabled via CLOTHING_VISION=off';
    return false;
  }

  try {
    const [vision, text, processor, tokenizer] = await Promise.all([
      (P.MODEL.family === 'siglip' ? tf.SiglipVisionModel : tf.CLIPVisionModelWithProjection).from_pretrained(P.MODEL.id, { dtype: P.MODEL.dtype }),
      (P.MODEL.family === 'siglip' ? tf.SiglipTextModel : tf.CLIPTextModelWithProjection).from_pretrained(P.MODEL.id, { dtype: P.MODEL.dtype }),
      tf.AutoProcessor.from_pretrained(P.MODEL.id),
      tf.AutoTokenizer.from_pretrained(P.MODEL.id),
    ]);
    state.vision = vision;
    state.text = text;
    state.processor = processor;
    state.tokenizer = tokenizer;
    state.dim = P.MODEL.embeddingDim;
    state.ready = true;
    return true;
  } catch (e) {
    state.error = String(e.message || e).slice(0, 240);
    return false;
  }
}

/** Unit-length vector. */
function normalize(vec) {
  let n = 0;
  for (let i = 0; i < vec.length; i += 1) n += vec[i] * vec[i];
  n = Math.sqrt(n);
  if (!n) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] / n;
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

/**
 * Average normalised embeddings for a list of prompt sentences.
 * Sentences are batched so a long label bank does not build one enormous graph.
 */
async function embedSentences(sentences) {
  const dim = state.dim;
  const acc = new Float64Array(dim);
  let count = 0;

  for (let i = 0; i < sentences.length; i += MAX_PROMPTS_PER_BATCH) {
    const batch = sentences.slice(i, i + MAX_PROMPTS_PER_BATCH);
    const ids = state.tokenizer(batch, {
      padding: 'max_length',
      max_length: P.MODEL.contextLength,
      truncation: true,
    });
    const out = await state.text(ids);
    const embeds = out.text_embeds;
    const data = embeds.data;
    const width = embeds.dims[embeds.dims.length - 1];
    for (let b = 0; b < batch.length; b += 1) {
      const off = b * width;
      const v = normalize(data.slice(off, off + width));
      for (let j = 0; j < width; j += 1) acc[j] += v[j];
      count += 1;
    }
  }

  const out = new Array(dim);
  for (let j = 0; j < dim; j += 1) out[j] = acc[j] / count;
  return normalize(out);
}

/** Expand every phrase of one entry across the template set. */
function sentences(phrases, templates) {
  const out = [];
  for (const phrase of phrases) {
    for (const t of templates) out.push(t.replace('{}', phrase));
  }
  return out;
}

/**
 * Build one centroid per declared value.
 *
 * The centroid averages normalised embeddings over every (phrase x template)
 * combination, which is what makes the result a property of the garment rather
 * than of one hand-written sentence.
 */
async function buildBank() {
  const build = async (entries, templates) => Promise.all(entries.map(async (entry) => ({
    ...entry,
    vec: await embedSentences(sentences(entry.phrases, templates)),
  })));

  const [garments, nonClothing, styles, genders, seasons, patterns, materials] = await Promise.all([
    build(P.GARMENTS, P.GARMENT_TEMPLATES),
    build(P.NON_CLOTHING, P.NEGATIVE_TEMPLATES),
    build(P.STYLES, P.GARMENT_TEMPLATES),
    build(P.GENDERS, P.GARMENT_TEMPLATES),
    build(P.SEASONS, P.GARMENT_TEMPLATES),
    build(P.PATTERNS, P.GARMENT_TEMPLATES),
    build(P.MATERIALS, P.GARMENT_TEMPLATES),
  ]);

  return { garments, nonClothing, styles, genders, seasons, patterns, materials };
}

/**
 * Disk cache for the label bank. Building it embeds ~1000 prompts and takes
 * tens of seconds on a CPU, so without a cache the first upload after every
 * restart waits for it. The key covers the model and every prompt, so editing
 * prompts.ts or switching model rebuilds it. Lives in .model-cache (git-ignored).
 */
function bankCachePath() {
  const crypto = require('node:crypto');
  const key = crypto.createHash('sha1')
    .update(JSON.stringify([P.MODEL.id, P.MODEL.dtype, P.GARMENT_TEMPLATES, P.NEGATIVE_TEMPLATES,
      P.GARMENTS, P.NON_CLOTHING, P.STYLES, P.GENDERS, P.SEASONS, P.PATTERNS, P.MATERIALS]))
    .digest('hex').slice(0, 16);
  return path.join(__dirname, '..', '..', '.model-cache', `label-bank-${key}.json`);
}

async function readBankCache() {
  try {
    const b = JSON.parse(fs.readFileSync(bankCachePath(), 'utf8'));
    return b && Array.isArray(b.garments) && b.garments.length ? b : null;
  } catch {
    return null;
  }
}

function writeBankCache(b) {
  try {
    const file = bankCachePath();
    if (fs.existsSync(file)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(b));
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    /* a cache that cannot be written only costs time */
  }
}

/** The label bank, built on first use. Concurrent callers share one build. */
async function bank() {
  if (state.bank) return state.bank;
  if (state.bankPromise) return state.bankPromise;
  state.bankPromise = (async () => {
    state.bank = (await readBankCache()) || (await buildBank());
    writeBankCache(state.bank);
    state.warm = true;
    return state.bank;
  })();
  try {
    return await state.bankPromise;
  } finally {
    state.bankPromise = null;
  }
}

/**
 * Embed a decoded image.
 *
 * @param {RawImage} image  from `tf.RawImage.fromBlob` / `.read`
 * @returns {Promise<Float32Array>} unit-length embedding
 */
async function embedImage(image) {
  if (!(await init())) {
    const err: any = new Error(state.error || 'clothing vision unavailable');
    err.code = 'CLOTHING_VISION_UNAVAILABLE';
    throw err;
  }
  const { pixel_values } = await state.processor(image);
  const out = await state.vision({ pixel_values });
  return normalize(out.image_embeds.data);
}

/** Fire-and-forget warm-up so the first real request is not the slow one. */
function warmup() {
  return (async () => {
    if (!(await init())) return false;
    await bank();
    return true;
  })().catch(() => false);
}

/** Startup diagnostics for GET /admin/system-health. */
async function status() {
  await init();
  const loading = state.bankPromise ? true : false;
  return {
    ready: state.ready && state.warm,
    modelsReady: state.ready,
    bankReady: state.warm,
    loading,
    model: P.MODEL.id,
    licence: P.MODEL.licence,
    dtype: P.MODEL.dtype,
    dim: state.dim,
    promptBankSize: P.GARMENTS.length + P.NON_CLOTHING.length + P.GENDERS.length + P.STYLES.length
      + P.SEASONS.length + P.PATTERNS.length + P.MATERIALS.length,
    cacheDir: path.join(__dirname, '..', '..', '.model-cache'),
    cached: fs.existsSync(path.join(__dirname, '..', '..', '.model-cache')),
    error: state.error,
  };
}

export {
  CONTEXT_LENGTH,
  init,
  bank,
  embedImage,
  warmup,
  status,
  normalize,
  dot,
};