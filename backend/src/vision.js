/**
 * Reference-outfit matching — the "advanced clothes" feature.
 *
 * Workflow:
 *   1. Vision model reads a photo of an outfit someone else is wearing and
 *      returns a structured spec: one entry per slot with garment, colour,
 *      material and formality.
 *   2. Each spec slot is matched against the user's own wardrobe by attribute
 *      similarity, blended with semantic retrieval.
 *   3. The result is a wearable plan: the closest piece you own per slot, the
 *      score, why it works, and an explicit list of what you do NOT own.
 *
 * Free to run — Gemini 2.0 Flash vision has a generous free tier and no key is
 * needed for the fallback path, which scores wardrobe items against the
 * filename-derived attributes instead.
 */
'use strict';

const tax = require('./taxonomy');
const retrieval = require('./retrieval');

/** Slots we try to fill, in the order a stylist would dress a person. */
const TARGET_SLOTS = ['outerwear', 'top', 'bottom', 'shoes', 'accessory'];

const SLOT_LABEL = {
  outerwear: 'Outer layer',
  top: 'Top',
  bottom: 'Bottoms',
  shoes: 'Shoes',
  accessory: 'Accessory',
};

/**
 * Normalise whatever the vision model returned into
 * `{ title, occasion, notes, slots: [{ slot, garment, color, material, formality }] }`.
 * Tolerates a bare array, a wrapped object, or missing fields.
 */
function normaliseSpec(raw) {
  let slots = [];
  let title = '';
  let occasion = '';
  let notes = '';

  if (Array.isArray(raw)) slots = raw;
  else if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.slots)) slots = raw.slots;
    else if (Array.isArray(raw.outfit)) slots = raw.outfit;
    else if (Array.isArray(raw.items)) slots = raw.items;
    else if (Array.isArray(raw.pieces)) slots = raw.pieces;
    title = raw.title || raw.name || raw.outfitName || '';
    occasion = raw.occasion || raw.event || raw.context || '';
    notes = raw.notes || raw.description || raw.summary || '';
  }

  slots = slots
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const slot = tax.detectOccasions(s.slot || s.role || s.layer || '')[0];
      const garment = String(s.garment || s.item || s.name || s.type || '').trim();
      if (!garment) return null;
      return {
        slot: slot || null,
        garment,
        color: String(s.color || s.colour || '').trim(),
        material: String(s.material || s.fabric || '').trim(),
        pattern: String(s.pattern || '').trim(),
        formality: String(s.formality || s.dressCode || '').trim(),
      };
    })
    .filter(Boolean)
    .slice(0, 6);

  return { title, occasion, notes, slots };
}

/**
 * How well a wardrobe item fills a requested slot (0..1).
 *
 * Weighted attribute similarity: colour family > exact colour > garment-name
 * overlap > material > formality. Deliberately explainable — every component
 * is returned so the UI can say *why* an item was chosen.
 */
function attributeAffinity(request, item) {
  const parts = [];

  // Colour: exact match > same family > neutral vs neutral > mismatch.
  const wantColor = tax.normalize(request.color);
  const gotColor = tax.normalize(item.color);
  if (wantColor && gotColor) {
    if (gotColor.includes(wantColor) || wantColor.includes(gotColor)) parts.push({ key: 'color', value: 1, weight: 0.34 });
    else if (tax.familyOf(gotColor) === tax.familyOf(wantColor)) parts.push({ key: 'color', value: 0.72, weight: 0.34 });
    else if (tax.isNeutral(gotColor) && tax.isNeutral(wantColor)) parts.push({ key: 'color', value: 0.8, weight: 0.34 });
    else parts.push({ key: 'color', value: 0.3, weight: 0.34 });
  } else if (wantColor || gotColor) {
    parts.push({ key: 'color', value: 0.55, weight: 0.34 });
  }

  // Garment name: token overlap between the request and the item.
  const wantTokens = new Set(String(request.garment).toLowerCase().match(/[a-z]+/g) || []);
  const gotTokens = new Set(`${item.name} ${item.category} ${item.style}`.toLowerCase().match(/[a-z]+/g) || []);
  let overlap = 0;
  for (const t of wantTokens) if (gotTokens.has(t)) overlap += 1;
  parts.push({
    key: 'garment',
    value: wantTokens.size ? Math.min(1, overlap / wantTokens.size) : 0.6,
    weight: 0.3,
  });

  // Material.
  const wantMat = tax.normalize(request.material);
  const gotMat = tax.normalize(item.material);
  if (wantMat && gotMat) {
    parts.push({
      key: 'material',
      value: gotMat.includes(wantMat) || wantMat.includes(gotMat) ? 1 : 0.45,
      weight: 0.16,
    });
  }

  // Formality / dress code.
  const wantLevel = tax.occasionTarget(request.formality);
  if (wantLevel != null) {
    const gotLevel = tax.formalityOf(item);
    parts.push({ key: 'formality', value: Math.max(0, 1 - Math.abs(gotLevel - wantLevel) / 5), weight: 0.2 });
  }

  const totalWeight = parts.reduce((a, p) => a + p.weight, 0) || 1;
  const score = parts.reduce((a, p) => a + p.value * p.weight, 0) / totalWeight;
  return { score, parts };
}

/** Best wardrobe candidate for one requested slot. */
function matchSlot(request, wardrobe, slot, opts = {}) {
  const candidates = wardrobe.filter((i) => !i.archived);
  const pool = slot
    ? candidates.filter((i) => tax.slotOf(i) === slot)
    : candidates;
  if (!pool.length) return { request, slot, item: null, score: 0, reason: 'No matching category in your wardrobe.' };

  const ranked = pool
    .map((item) => {
      const { score, parts } = attributeAffinity(request, item);
      const nameMatch = tax.normalize(`${item.name} ${item.style} ${item.color}`)
        .includes(tax.normalize(request.garment).split(/\s+/).pop() || '~');
      // A strong name hit deserves a nudge even if attributes disagree.
      const adjusted = Math.min(1, score * 0.88 + (nameMatch ? 0.12 : 0));
      return { item, score: adjusted, parts, nameMatch };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const pct = Math.round(best.score * 100);
  return {
    request,
    slot: slot || tax.slotOf(best.item),
    slotLabel: SLOT_LABEL[slot || tax.slotOf(best.item)] || 'Piece',
    item: best.item,
    itemId: best.item.id,
    score: pct,
    exact: pct >= 82,
    closeEnough: pct >= 62,
    reason: describeMatch(request, best, pct),
    alternatives: ranked.slice(1, 3).map((r) => ({ itemId: r.item.id, name: r.item.name, score: Math.round(r.score * 100) })),
    breakdown: best.parts.map((p) => ({
      key: p.key,
      value: Math.round(p.value * 100),
    })),
  };
}

function describeMatch(request, best, pct) {
  const bits = [];
  const got = best.item;
  if (pct >= 88) bits.push('essentially the same piece');
  else if (pct >= 70) bits.push('a very close stand-in');
  else if (pct >= 55) bits.push('the nearest thing you own');
  else bits.push('the closest available, though it is a stretch');

  const wantColor = tax.normalize(request.color);
  const gotColor = tax.normalize(got.color);
  if (wantColor && gotColor && wantColor !== gotColor) {
    bits.push(`yours is ${gotColor} rather than ${request.color}`);
  }
  if (request.material && !tax.normalize(got.material).includes(tax.normalize(request.material))) {
    bits.push(`in ${got.material || 'a different fabric'}`);
  }
  return `Closest match for the ${request.garment} — ${bits.join(', ')} (${pct}%).`;
}

/** Fallback when no vision model is configured: guess from the filename. */
function specFromFilename(filename = '', name = '') {
  const hay = `${filename} ${name}`.toLowerCase();
  const slots = [];
  const push = (slot, garment, color) => {
    if (garment) slots.push({ slot, garment, color: color || '', material: '', formality: '' });
  };
  if (/shirt|blouse|tee|t-?shirt|top|polo/.test(hay)) push('top', /shirt|blouse/.test(hay) ? 'shirt' : 'top');
  if (/jean|trouser|pant|chino|skirt|short/.test(hay)) push('bottom', /jean/.test(hay) ? 'jeans' : 'trousers');
  if (/shoe|sneaker|boot|loafer|heel/.test(hay)) push('shoes', 'shoes');
  if (/jacket|coat|blazer|hoodie/.test(hay)) push('outerwear', /blazer/.test(hay) ? 'blazer' : 'jacket');
  // Without this a belt photo fell through to the "reference look" catch-all and
  // was then widened across the whole wardrobe, landing on an unrelated blazer.
  if (/belt|accessor|scarf|hat|cap|tie|bag|tote|watch|sunglass/.test(hay)) {
    const garment = /belt/.test(hay) ? 'belt'
      : /scarf/.test(hay) ? 'scarf'
        : /hat|cap/.test(hay) ? 'hat'
          : /tie/.test(hay) ? 'necktie'
            : /sunglass/.test(hay) ? 'sunglasses'
              : /watch/.test(hay) ? 'watch'
                : /bag|tote/.test(hay) ? 'bag'
                  : 'accessory';
    push('accessory', garment);
  }
  if (!slots.length) push(null, 'reference look');
  return normaliseSpec({
    title: name || 'Reference outfit',
    notes: 'No vision model configured — matched from the file name only. Set GEMINI_API_KEY for real photo analysis.',
    slots,
  });
}

/**
 * Match a reference outfit spec against the wardrobe.
 * Pure — takes the parsed spec so it can be unit-tested without any network.
 */
function matchSpec(spec, wardrobe = [], opts = {}) {
  const requests = spec.slots && spec.slots.length
    ? spec.slots
    : TARGET_SLOTS.map((slot) => ({ slot, garment: SLOT_LABEL[slot], color: '', material: '', formality: '' }));

  const matches = [];
  const used = new Set();

  for (const request of requests) {
    const slot = request.slot || null;
    let best = null;
    // Try the declared slot first, then widen so a missing category still fills.
    for (const candidateSlot of slot ? [slot, ...tax.requiredSlots(), ...TARGET_SLOTS] : TARGET_SLOTS) {
      const attempt = matchSlot(request, wardrobe.filter((i) => !used.has(i.id)), candidateSlot, opts);
      if (attempt.item && (!best || attempt.score > best.score)) best = attempt;
      if (best && best.score >= 70 && slot) break;
    }
    if (!best) {
      matches.push({
        request, slot, slotLabel: SLOT_LABEL[slot] || 'Piece',
        item: null, itemId: null, score: 0, exact: false, closeEnough: false,
        reason: `You do not own anything to fill the ${SLOT_LABEL[slot] || 'slot'}.`,
        alternatives: [], breakdown: [],
      });
      continue;
    }
    used.add(best.item.id);
    matches.push(best);
  }

  const filled = matches.filter((m) => m.item);
  const owned = matches.filter((m) => m.exact).length;
  const gaps = matches
    .filter((m) => !m.item || m.score < 62)
    .map((m) => ({
      slot: m.slot,
      slotLabel: m.slotLabel,
      missing: m.request.garment,
      color: m.request.color,
      material: m.request.material,
      reason: !m.item
        ? `Nothing in your wardrobe fills the ${m.slotLabel?.toLowerCase()} slot.`
        : `Closest you own is ${Math.round(m.score)}% — a different ${m.request.garment} would be closer.`,
    }));

  // A wearable plan needs the required slots filled.
  const requiredFilled = tax.requiredSlots().every((s) => matches.some((m) => m.slot === s && m.item));
  const avgScore = filled.length
    ? Math.round(filled.reduce((a, m) => a + m.score, 0) / filled.length)
    : 0;

  // Similarity is driven by the average per-slot match, with exact hits
  // counted as a bonus. Weighting the two the other way round produced the
  // nonsense of "79% average match" reporting as "32% similarity" whenever
  // nothing hit exactly.
  const exactRate = matches.length ? owned / matches.length : 0;
  const similarity = Math.round((avgScore / 100) * 75 + exactRate * 100 * 0.25);

  return {
    reference: { title: spec.title || 'Reference outfit', occasion: spec.occasion || '', notes: spec.notes || '' },
    matches,
    itemIds: filled.map((m) => m.itemId),
    items: filled.map((m) => m.item),
    gaps,
    exactCount: owned,
    wearable: requiredFilled,
    similarity,
    averageMatch: avgScore,
  };
}

module.exports = {
  normaliseSpec,
  matchSpec,
  matchSlot,
  attributeAffinity,
  specFromFilename,
  describeMatch,
  TARGET_SLOTS,
  SLOT_LABEL,
};
