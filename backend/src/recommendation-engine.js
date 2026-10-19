/**
 * Recommendation Engine — §3 RECOMMENDATION ENGINE CORE.
 *
 * One place that decides what the user is shown, in what order. It does not
 * re-implement anything that already exists; it orchestrates the modules that
 * do:
 *
 *   wardrobe + profile + weather + memory
 *            ↓
 *   HARD CONSTRAINTS      (archived, exclusions, avoided colours, learned avoid)
 *            ↓
 *   EXISTING GENERATION   (ai.generateOutfits → beam search → scoring.js)
 *            ↓
 *   EXISTING RETRIEVAL    (retrieval.rank → candidate relevance)
 *            ↓
 *   PERSONALIZED SCORING  (one weighted table, see SCORE_WEIGHTS)
 *            ↓
 *   DIVERSITY             (greedy overlap-penalised selection)
 *            ↓
 *   EXPLORATION           (context-seeded choice among near-equal candidates)
 *            ↓
 *   FINAL RANKING         (score desc, deterministic tie-break)
 *
 * ------------------------------------------------------------------
 * SCORING MODEL
 *
 * Every component is expressed on a 0–100 scale where higher is better, and
 * every component reports `hasSignal`. Components with no evidence are
 * excluded and their weight is renormalised over the ones that spoke — the
 * same convention `scoring.js` already uses, so a user with no profile is not
 * handed a flattering constant.
 *
 * | component            | weight | range | meaning                              |
 * |----------------------|--------|-------|--------------------------------------|
 * | compatibility        |  0.45  | 0-100 | scoring.js 11-factor outfit match    |
 * | retrieval_relevance  |  0.20  | 0-100 | retrieval.rank vs. best — ONLY when  |
 * |                      |        |       | the request carries a real query     |
 * | profile_match        |  0.15  | 0-100 | hit-rate of favourite colours/styles |
 * |                      |        |       | over the dimensions the profile uses |
 * | freshness            |  0.10  | 0-100 | rotation pressure from last-worn age |
 * | learned_affinity     |  0.10  | 0-100 | StyleMemory affinity on pieces with  |
 * |                      |        |       | an actual stored opinion             |
 *
 * Weights sum to 1.0 before renormalisation.
 *
 * WHY EACH COMPONENT EXISTS
 *   compatibility        — the product's existing answer to "do these pieces
 *                          work together?". Delegated wholesale; this module
 *                          never recomputes it.
 *   retrieval_relevance  — how well the pieces match an explicit *request*
 *                          (focus/search text passed via `retrievalQuery`).
 *                          The automatic Home path carries no query, so this
 *                          component is deliberately omitted there: treating
 *                          the default occasion word ("casual") as a query
 *                          only restated style/occasion fit at weight 0.20.
 *   profile_match        — explicit preferences deserve a visible, isolated
 *                          term. scoring.js folds profile+learned into one
 *                          `personal_preference` factor worth ~0.14; this
 *                          separates the declared half so ranking visibly
 *                          responds to favoriteColors/preferredStyles. Only
 *                          the dimensions the profile actually declares are
 *                          counted, so a colours-only profile can still reach
 *                          100% instead of being capped at 50%.
 *   freshness            — rotation. scoring.js has a coarse outfit-level
 *                          recent_usage factor built on timesWorn; this reads
 *                          how recently a piece was worn and averages only the
 *                          core pieces (top/bottom/outerwear) so basics that
 *                          are worn every day (shoes, belts) do not dominate.
 *   learned_affinity     — inferred preferences kept conceptually separate
 *                          from the explicit profile (never merged into it).
 *                          Averaged only over pieces the memory actually has
 *                          an opinion about, so missing opinions are neutral
 *                          rather than a second 0.5 pulled into the mean.
 *
 * KNOWN, DELIBERATE OVERLAP: profile_match and learned_affinity restate
 * signals that compatibility already carries at lower weight. That is an
 * amplification, not a second algorithm — the underlying measurements come
 * from the same helpers (scoring.personalPreference logic, memory.itemAffinity)
 * and the combined influence stays bounded because compatibility is capped at
 * 0.45 of the total.
 *
 * WEIGHTS ARE HEURISTICS. There is no evaluation dataset in this repository,
 * so these are initial configurable values chosen for plausible influence
 * shares, not empirically optimised numbers. They are exported as
 * `SCORE_WEIGHTS` so an evaluation pass can retune them in one place.
 *
 * DETERMINISM: no Math.random anywhere. Identical inputs (including `month`,
 * which defaults to the current month) produce identical output; the
 * exploration pick is seeded by a stable hash of the request context.
 */
'use strict';

const tax = require('./taxonomy');
const scoring = require('./scoring');
const memoryStore = require('./style-memory');
const retrieval = require('./retrieval');
const ai = require('./ai-engine');

/** Component weights (initial heuristics — see module header). */
const SCORE_WEIGHTS = Object.freeze({
  compatibility: 0.45,
  retrieval_relevance: 0.2,
  profile_match: 0.15,
  freshness: 0.1,
  learned_affinity: 0.1,
});

const COMPONENT_MEANING = Object.freeze({
  compatibility: 'scoring.js 11-factor compatibility match for the whole outfit',
  retrieval_relevance: 'retrieval.rank relevance to an explicit request query, relative to the best-scoring piece in the pool (omitted when the request carries no query)',
  profile_match: 'share of pieces matching explicit favoriteColors / preferredStyles, measured over the dimensions the profile declares',
  freshness: 'rotation pressure from how recently each core piece (top/bottom/outerwear) was last worn',
  learned_affinity: 'StyleMemory inferred affinity, averaged over the pieces that carry a stored opinion (kept separate from the explicit profile)',
});

/** Candidates to request from the existing generator (it caps at 8 anyway). */
const MAX_CANDIDATES = 8;
/** Points subtracted per unit of overlap during diversity selection. */
const DIVERSITY_PENALTY = 14;
/** Exploration quality floor: never surface a weak candidate. */
const EXPLORATION_MIN_SCORE = 55;
/** Exploration band: candidate must be within this many points of the best. */
const EXPLORATION_BAND = 10;
/** A candidate must be less than this similar to a selected outfit to be explored. */
const EXPLORATION_NOVELTY = 0.5;
/** Exploration only makes sense once at least this many outfits are returned. */
const EXPLORATION_MIN_SELECTION = 2;

// ----------------------------------------------------------------- utilities

function clamp100(n) {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

function mean(list) {
  const nums = list.filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function normList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => tax.normalize(v)).filter(Boolean);
}

function clampCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(8, Math.max(1, Math.round(n)));
}

function normalizeWeather(weather) {
  const w = weather && typeof weather === 'object' ? weather : {};
  const tempC = Number(w.tempC);
  return {
    ...w,
    tempC: Number.isFinite(tempC) ? tempC : 24,
  };
}

/** Stable FNV-1a hash — the deterministic exploration seed. */
function stableHash(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ------------------------------------------------------- hard constraints

/**
 * Does this garment carry an explicitly avoided colour?
 *
 * Matching mirrors how favoriteColors are matched elsewhere (substring on the
 * normalised colour, plus taxonomy colour extraction so "Navy Blue Shirt" is
 * caught by an avoided "Blue").
 */
function isColorAvoided(item, avoided) {
  if (!avoided.length) return false;
  const color = tax.normalize(item.color);
  const found = tax.colorsIn(item.color || '', item.name || '');
  return avoided.some((target) => (color && color.includes(target)) || found.includes(target));
}

/**
 * HARD CONSTRAINTS — applied before anything is generated or scored.
 *
 * | id | rule                                            | source                          |
 * |----|-------------------------------------------------|---------------------------------|
 * | H1 | archived / deleted items never recommended      | soft-delete sets `archived`; retrieval.rank + generateOutfits already filter it |
 * | H2 | caller exclusions (excludeIds)                  | existing retrieval/generation option |
 * | H3 | invalid rows rejected (no id, or no name+category) | every downstream module assumes `id` and a categorisable garment |
 * | H4 | explicit profile avoidedColors excluded         | StyleProfile.avoidedColors (written by PATCH /users/me/style-profile) |
 * | H5 | StyleMemory "never wear X" exclusions           | style-memory.js isAvoided/withoutAvoided |
 * | H6 | items with an unknown category can never fill a required slot | taxonomy.slotOf → generateOutfits beam search |
 * | H7 | the same garment may appear once per outfit     | generateOutfits / garmentKey dedupe |
 *
 * RELAXATION (documented, deliberate): H4/H5 are dropped only when honouring
 * them would leave a *required* slot (top/bottom/shoes) with zero candidates
 * or the whole pool empty. Recommending nothing at all is worse than
 * recommending the avoided piece, and the relaxation is reported in
 * `meta.constraints.relaxedSlots` so it is never silent. Optional slots
 * (outerwear, accessory) are never relaxed — losing a scarf costs nothing.
 */
function applyHardConstraints(wardrobe, opts = {}, memory = memoryStore.empty()) {
  const excluded = new Set(Array.isArray(opts.excludeIds) ? opts.excludeIds : []);
  const avoided = normList(opts.styleProfile && opts.styleProfile.avoidedColors);
  const constraints = {
    archived: 0,
    excluded: 0,
    invalid: 0,
    avoidedColor: 0,
    memoryAvoided: 0,
    relaxedSlots: [],
    relaxedToFullPool: false,
  };

  const live = [];
  const source = Array.isArray(wardrobe) ? wardrobe : [];
  for (const item of source) {
    if (!item || typeof item !== 'object') {
      constraints.invalid += 1;
    } else if (item.archived) {
      constraints.archived += 1;
    } else if (item.id && excluded.has(item.id)) {
      constraints.excluded += 1;
    } else if (!item.id || (!item.name && !item.category)) {
      constraints.invalid += 1;
    } else {
      live.push(item);
    }
  }
  if (!live.length) return { pool: [], constraints, liveCount: 0 };

  // H5 — learned absolute exclusions, same semantics as withoutAvoided().
  const afterMemory = live.filter((i) => !memoryStore.isAvoided(memory, i));
  let pool = afterMemory.length ? afterMemory : live;
  constraints.memoryAvoided = afterMemory.length ? live.length - afterMemory.length : 0;

  // H4 — explicit avoided colours, with per-required-slot relaxation.
  const afterColor = pool.filter((i) => !isColorAvoided(i, avoided));
  if (afterColor.length === pool.length) {
    constraints.avoidedColor = 0;
  } else if (!afterColor.length) {
    constraints.relaxedToFullPool = true;
  } else {
    const keptBySlot = new Map();
    for (const item of afterColor) {
      const slot = tax.slotOf(item);
      if (!slot) continue;
      keptBySlot.set(slot, (keptBySlot.get(slot) || 0) + 1);
    }
    const dropped = pool.filter((i) => isColorAvoided(i, avoided));
    const droppedBySlot = new Map();
    for (const item of dropped) {
      const slot = tax.slotOf(item);
      if (!slot) continue;
      if (!droppedBySlot.has(slot)) droppedBySlot.set(slot, []);
      droppedBySlot.get(slot).push(item);
    }
    const restored = [];
    for (const slot of tax.requiredSlots()) {
      if ((keptBySlot.get(slot) || 0) === 0 && droppedBySlot.get(slot)?.length) {
        restored.push(...droppedBySlot.get(slot));
        constraints.relaxedSlots.push(slot);
      }
    }
    pool = [...afterColor, ...restored];
    constraints.avoidedColor = dropped.length - restored.length;
  }

  return { pool, constraints, liveCount: live.length };
}

// -------------------------------------------------------- retrieval signal

/**
 * Existing two-stage retrieval, mapped to `{ scores: Map<itemId, raw>, max }`.
 *
 * Reuses `retrieval.rank()` — embeddings when the model is up, lexical
 * otherwise — so the engine adds no model loading of its own and inherits the
 * module's vector cache. The component value is each piece's share of the
 * best score in the pool, which puts retrieval's 0..1 blend onto a real 0-100
 * scale without inventing a magic cut-off.
 *
 * Returns `null` when retrieval produced no usable signal (for example a
 * query no piece relates to); the component then drops out and the remaining
 * weights renormalise.
 */
async function buildRetrievalMap(pool, query, { weather, occasion } = {}) {
  const q = String(query || '').trim() || 'outfit';
  let scores = null;

  try {
    const ranked = await retrieval.rank(q, pool, {
      weather,
      occasion,
      limit: Math.max(1, pool.length),
    });
    scores = new Map();
    for (const entry of ranked || []) {
      if (!entry || !entry.item) continue;
      scores.set(entry.item.id, Math.max(0, Number(entry.score) || 0));
    }
  } catch {
    scores = null;
  }

  if (!scores || !scores.size) {
    // Fall back to the lexical half of the same module — never a second engine.
    try {
      scores = new Map();
      for (const item of pool) {
        scores.set(item.id, Math.max(0, Number(retrieval.lexicalScore(q, item)) || 0));
      }
    } catch {
      return null;
    }
  }

  const max = Math.max(0, ...scores.values());
  if (!max) return null;
  return { scores, max };
}

// ------------------------------------------------------- component signals

function compatibilitySignal(outfit) {
  const match = Number(outfit.match);
  return {
    value: clamp100(match),
    hasSignal: Array.isArray(outfit.items) && outfit.items.length > 0 && Number.isFinite(match),
  };
}

function retrievalSignal(items, ctx) {
  const map = ctx.retrievalMap;
  if (!map || !map.max || !items.length) return { value: 0, hasSignal: false };
  const scores = items.map((i) => map.scores.get(i.id)).filter((v) => typeof v === 'number');
  if (!scores.length) return { value: 0, hasSignal: false };
  return { value: clamp100((mean(scores) / map.max) * 100), hasSignal: true };
}

/**
 * Explicit preference hit-rate. Deliberately reads only the declared profile:
 * learned StyleMemory opinions are a separate component, so "what I said I
 * like" and "what I seem to like" stay distinguishable in the breakdown.
 *
 * The denominator counts only the dimensions the profile actually declares.
 * The previous version always added two checks per piece (colour + style), so a
 * colours-only profile could never score above 50 — every piece was silently
 * charged for a style opinion the user never gave. Now a declared colours-only
 * profile is judged on colour alone.
 */
function profileMatchSignal(items, styleProfile = {}) {
  const favColors = normList(styleProfile.favoriteColors);
  const favStyles = normList(styleProfile.preferredStyles);
  const useColor = favColors.length > 0;
  const useStyle = favStyles.length > 0;
  if (!useColor && !useStyle) return { value: 0, hasSignal: false };
  if (!items.length) return { value: 0, hasSignal: false };

  let hits = 0;
  let total = 0;
  for (const item of items) {
    const color = tax.normalize(item.color);
    const style = tax.normalize(item.style);
    if (useColor && color) {
      total += 1;
      if (favColors.some((f) => color.includes(f) || tax.familyOf(color) === f)) hits += 1;
    }
    if (useStyle && style) {
      total += 1;
      if (favStyles.some((f) => style.includes(f))) hits += 1;
    }
  }
  return { value: total ? (hits / total) * 100 : 0, hasSignal: true };
}

/** Days since last wear, parsed from the label the runtime actually stores. */
function daysSinceWorn(item) {
  const label = tax.normalize(item.lastWornLabel);
  if (!label) return null;
  if (/unworn|never/.test(label)) return 999;
  if (/\btoday\b/.test(label)) return 0;
  if (/yesterday/.test(label)) return 1;
  const days = label.match(/(\d+)\s*day/);
  if (days) return Number(days[1]);
  const weeks = label.match(/(\d+)\s*week/);
  if (weeks) return Number(weeks[1]) * 7;
  const months = label.match(/(\d+)\s*month/);
  if (months) return Number(months[1]) * 30;
  return null;
}

/**
 * Per-garment rotation pressure, 0–100, from how long ago the piece was worn.
 *   worn today → 0, a few days ago → 40–70, 10+ days / never → 100
 * Unknown labels stay neutral (60) rather than guessing.
 *
 * Deliberately recency-only. The old formula blended in `timesWorn`, which
 * scoring.js's `recent_usage` already reads, so every heavily-worn piece was
 * penalised twice — worst for basics (shoes, belts) that are worn daily but
 * are not what the user is choosing between.
 */
function freshnessOf(item) {
  const days = daysSinceWorn(item);
  return days == null ? 60 : clamp100(100 - Math.max(0, 10 - days) * 10);
}

/** Slots whose rotation actually matters; shoes/belts are worn too often to judge. */
const FRESHNESS_SLOTS = new Set(['top', 'bottom', 'outerwear']);

function freshnessSignal(items) {
  if (!items.length) return { value: 0, hasSignal: false };
  const core = items.filter((i) => FRESHNESS_SLOTS.has(tax.slotOf(i)));
  // If nothing lands in a core slot, fall back to whatever pieces exist rather
  // than reporting no signal at all.
  return { value: mean((core.length ? core : items).map(freshnessOf)), hasSignal: true };
}

function learnedAffinitySignal(items, memory) {
  if (!items.length) return { value: 0, hasSignal: false };
  // The memory must actually speak to *this* outfit. A stored "navy" opinion
  // activating on an all-beige look was the whole 50-pinning bug: irrelevant
  // preferences fall out and the remaining weights renormalise.
  const applies = items.filter((i) => memoryStore.hasOpinionFor(memory, i));
  if (!applies.length) return { value: 0, hasSignal: false };
  // Average only the pieces the memory has an opinion about. Including the
  // rest pulled every value toward a neutral 50 regardless of the strength of
  // the opinion that is actually stored.
  return { value: mean(applies.map((i) => memoryStore.itemAffinity(memory, i) * 100)), hasSignal: true };
}

// ------------------------------------------------------------ final scoring

/**
 * Score one candidate outfit.
 *
 * @param {object} outfit  candidate produced by ai.generateOutfits()
 * @param {object} ctx     { styleProfile, memory, retrievalMap }
 * @returns {{score:number, raw:number, ceiling:number, components:object}}
 */
function scoreCandidate(outfit, ctx = {}) {
  const items = Array.isArray(outfit.items) ? outfit.items.filter(Boolean) : [];
  const signals = {
    compatibility: compatibilitySignal(outfit),
    retrieval_relevance: retrievalSignal(items, ctx),
    profile_match: profileMatchSignal(items, ctx.styleProfile),
    freshness: freshnessSignal(items),
    learned_affinity: learnedAffinitySignal(items, ctx.memory),
  };

  const activeWeight = Object.entries(signals)
    .filter(([, s]) => s.hasSignal)
    .reduce((sum, [key]) => sum + SCORE_WEIGHTS[key], 0) || 1;

  let raw = 0;
  const components = {};
  for (const key of Object.keys(SCORE_WEIGHTS)) {
    const signal = signals[key];
    const weight = signal.hasSignal ? SCORE_WEIGHTS[key] / activeWeight : 0;
    components[key] = {
      meaning: COMPONENT_MEANING[key],
      value: Math.round(clamp100(signal.value)),
      weight: Number(weight.toFixed(4)),
      applied: signal.hasSignal,
    };
    if (signal.hasSignal) raw += clamp100(signal.value) * weight;
  }

  // The same completeness ceiling scoring.js applies: re-ranking must not let
  // a one-piece candidate outrank a complete outfit just because its colours
  // are nice. The table itself lives in scoring.js (single source of truth).
  const complete = scoring.completeness(items);
  const ceiling = scoring.COMPLETENESS_CAP.find((t) => complete.ratio >= t.min).cap;
  const score = Math.round(Math.min(raw, ceiling));

  return {
    score,
    raw: Math.round(raw),
    ceiling,
    components,
    completeness: complete,
  };
}

// ----------------------------------------------------------------- diversity

function usedOf(outfit) {
  const used = { ids: new Set(), colors: new Set(), styles: new Set() };
  addUsed(used, outfit);
  return used;
}

function addUsed(used, outfit) {
  for (const item of outfit.items || []) {
    used.ids.add(item.id);
    used.colors.add(tax.familyOf(item.color));
    used.styles.add(tax.normalize(item.style));
  }
}

/**
 * Overlap of a candidate against what has already been selected, 0..1.
 * 50% item reuse, 25% colour-family reuse, 25% style reuse — item reuse is
 * what readers notice first ("same jeans again"), palette and silhouette
 * language are the softer versions of the same complaint.
 */
function similarityTo(outfit, used) {
  const items = (outfit.items || []).filter(Boolean);
  if (!items.length || !used.ids.size) return 0;
  const itemOverlap = items.filter((i) => used.ids.has(i.id)).length / items.length;
  const colorOverlap = items.filter((i) => used.colors.has(tax.familyOf(i.color))).length / items.length;
  const styleOverlap = items.filter((i) => used.styles.has(tax.normalize(i.style))).length / items.length;
  return 0.5 * itemOverlap + 0.25 * colorOverlap + 0.25 * styleOverlap;
}

function idsKey(scored) {
  return (scored.outfit.itemIds || []).slice().sort().join('|');
}

function byScoreThenIds(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  return idsKey(a).localeCompare(idsKey(b));
}

function isSameOutfit(a, b) {
  return idsKey(a) === idsKey(b);
}

/**
 * Greedy diversity selection.
 *
 * Candidates are ranked by `score − DIVERSITY_PENALTY × overlap-with-selected`,
 * so the top pick is always the best outfit, and each subsequent pick trades a
 * little score for visible variety. Deterministic: ties keep the higher-scored
 * candidate because the pool is walked in score order with a strict `>`.
 */
function selectDiverse(scored, count) {
  const selected = [];
  const remaining = [...scored];
  const used = { ids: new Set(), colors: new Set(), styles: new Set() };

  while (remaining.length && selected.length < count) {
    let bestIdx = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      if (selected.some((s) => isSameOutfit(s, candidate))) continue;
      const value = candidate.score - DIVERSITY_PENALTY * similarityTo(candidate.outfit, used);
      if (value > bestVal) {
        bestVal = value;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const [chosen] = remaining.splice(bestIdx, 1);
    selected.push(chosen);
    addUsed(used, chosen.outfit);
  }
  return selected;
}

// ---------------------------------------------------------------- exploration

/**
 * Deterministic exploration.
 *
 * Choice: among candidates that are (a) not already selected, (b) within
 * EXPLORATION_BAND of the best score and above EXPLORATION_MIN_SCORE, and
 * (c) not a near-duplicate of anything selected, pick index
 * `stableHash(context) % qualified.length`.
 *
 * Same request → same pick (no Math.random). A different occasion / temperature
 * / count / month surfaces a different reasonable candidate, so the engine does
 * not show the same safest three forever. Hard constraints are untouched
 * (candidates already passed them) and the quality floor plus the swap guard
 * mean exploration can never introduce an obviously bad recommendation.
 */
function applyExploration(selected, scored, seedKey) {
  if (selected.length < EXPLORATION_MIN_SELECTION) {
    return { selected, applied: false, reason: 'too_few_slots' };
  }
  const selectedIds = new Set(selected.map((s) => s.outfit.id));
  const best = scored.length ? scored[0].score : 0;
  const floor = Math.max(EXPLORATION_MIN_SCORE, best - EXPLORATION_BAND);

  const qualified = scored.filter((candidate) => {
    if (selectedIds.has(candidate.outfit.id)) return false;
    if (candidate.score < floor) return false;
    return selected.every(
      (s) => similarityTo(candidate.outfit, usedOf(s.outfit)) < EXPLORATION_NOVELTY,
    );
  });
  if (!qualified.length) return { selected, applied: false, reason: 'no_qualified_candidate' };

  const pick = qualified[stableHash(seedKey) % qualified.length];

  let worstIdx = 0;
  for (let i = 1; i < selected.length; i += 1) {
    if (selected[i].score < selected[worstIdx].score) worstIdx = i;
  }
  if (pick.score < selected[worstIdx].score) {
    return { selected, applied: false, reason: 'swap_would_degrade_score' };
  }

  const next = selected.filter((_, i) => i !== worstIdx);
  next.push(pick);
  return {
    selected: next,
    applied: true,
    in: pick.outfit.id,
    out: selected[worstIdx].outfit.id,
    seed: seedKey,
  };
}

// -------------------------------------------------------------------- engine

/**
 * Produce ranked recommendations.
 *
 * @param {object[]} wardrobe  raw wardrobe (archived rows included — the
 *                             engine owns the filtering)
 * @param {object}   opts
 * @param {string}   opts.occasion
 * @param {object}   opts.weather      { tempC, condition }
 * @param {object}   opts.styleProfile explicit user preferences
 * @param {object}   opts.memory       StyleMemory record (learned preferences)
 * @param {number}   opts.count        how many outfits to return (1..8)
 * @param {string}   opts.focus        free-text request, optional
 * @param {string}   opts.retrievalQuery  explicit request text for the
 *                                     retrieval component, optional. When
 *                                     neither `focus` nor `retrievalQuery` is
 *                                     given, retrieval is not run: the default
 *                                     occasion is not a request, and scoring it
 *                                     as one just restated style/occasion fit.
 * @param {string[]} opts.excludeIds
 * @param {string}   opts.anchorItemId
 * @param {number}   opts.month        1..12, defaults to the current month
 * @returns {Promise<{outfits: object[], meta: object}>}
 */
async function recommend(wardrobe, opts = {}) {
  const occasion = opts.occasion || 'casual';
  const weather = normalizeWeather(opts.weather);
  const styleProfile = opts.styleProfile && typeof opts.styleProfile === 'object'
    ? opts.styleProfile
    : {};
  const memory = opts.memory || memoryStore.empty();
  const month = Number.isFinite(Number(opts.month))
    ? Number(opts.month)
    : new Date().getMonth() + 1;
  const requested = clampCount(opts.count);
  const focus = String(opts.focus || '').trim();
  // Only a genuine request drives retrieval. The occasion default is not one.
  const retrievalQuery = focus || String(opts.retrievalQuery || '').trim();

  const { pool, constraints, liveCount } = applyHardConstraints(wardrobe, opts, memory);
  const meta = {
    engine: 'recommendation-engine',
    occasion,
    requested,
    weights: { ...SCORE_WEIGHTS },
    components: { ...COMPONENT_MEANING },
    pool: {
      source: Array.isArray(wardrobe) ? wardrobe.length : 0,
      live: liveCount,
      usable: pool.length,
    },
    constraints,
    generated: 0,
    returned: 0,
  };

  // Fail safe: nothing wearable is a valid answer, not an exception.
  if (!pool.length) {
    meta.reason = 'empty_wardrobe';
    return { outfits: [], meta };
  }

  let candidates = [];
  try {
    candidates = ai.generateOutfits(pool, {
      occasion,
      weather,
      styleProfile,
      memory,
      month,
      count: MAX_CANDIDATES,
      focus,
      anchorItemId: opts.anchorItemId,
      excludeIds: opts.excludeIds || [],
    }) || [];
  } catch (e) {
    meta.reason = 'generation_failed';
    meta.error = String(e && e.message ? e.message : e).slice(0, 160);
    return { outfits: [], meta };
  }
  meta.generated = candidates.length;
  if (!candidates.length) {
    meta.reason = 'no_candidates';
    return { outfits: [], meta };
  }

  const retrievalMap = retrievalQuery
    ? await buildRetrievalMap(pool, retrievalQuery, { weather, occasion })
    : null;
  meta.retrieval = retrievalMap ? 'ok' : (retrievalQuery ? 'unavailable' : 'not_requested');

  const ctx = { styleProfile, memory, retrievalMap, occasion, weather, month };
  const scored = candidates
    .map((outfit) => ({ outfit, ...scoreCandidate(outfit, ctx) }))
    .sort(byScoreThenIds);
  meta.activeComponents = Object.entries(scored[0].components)
    .filter(([, c]) => c.applied)
    .map(([k]) => k);

  const seedKey = `${occasion}|${weather.tempC}|${requested}|${month}|${focus}`;
  const selected = selectDiverse(scored, requested);
  const exploration = applyExploration(selected, scored, seedKey);
  meta.exploration = {
    applied: exploration.applied,
    reason: exploration.reason || null,
    in: exploration.in || null,
    out: exploration.out || null,
    seed: exploration.seed || seedKey,
  };

  const final = [...exploration.selected].sort(byScoreThenIds);

  // >>> TEMPORARY DIAGNOSTIC BLOCK (profile_match audit) — READ-ONLY, opt-in
  // Active only when opts.diagnostic === true. Pure observation: it reads the
  // already-computed values and appends them to meta.__diagnostic / stdout.
  // It never writes to any score, weight, filter, candidate or ranking.
  // Placed here (before finish()) so outfit.match still holds the generator
  // value, which scoreCandidate() needs for the optional A/B re-score.
  // To remove: delete from this marker down to the matching "<<< END".
  if (opts.diagnostic === true) {
    const diagPreferredStyles = Array.isArray(styleProfile.preferredStyles)
      ? styleProfile.preferredStyles : [];
    const diagFavoriteColors = Array.isArray(styleProfile.favoriteColors)
      ? styleProfile.favoriteColors : [];
    const diagCompare = opts.diagnosticCompare && typeof opts.diagnosticCompare === 'object'
      ? { ...styleProfile, ...opts.diagnosticCompare }
      : null;
    const selectedSet = new Set(exploration.selected);

    meta.__diagnostic = scored.map((c, idx) => {
      const diagItems = (Array.isArray(c.outfit.items) ? c.outfit.items : [])
        .filter(Boolean)
        .map((it) => ({ id: it.id, style: it.style ?? null, color: it.color ?? null }));
      const pm = c.components.profile_match;
      const row = {
        rank: idx + 1,
        itemIds: c.outfit.itemIds,
        pieces: diagItems,
        styleProfile: {
          preferredStyles: diagPreferredStyles,
          favoriteColors: diagFavoriteColors,
        },
        profile_match: {
          value: pm.value,
          weight: pm.weight,
          applied: pm.applied,
          weightedContribution: pm.applied
            ? Number((clamp100(pm.value) * pm.weight).toFixed(2))
            : 0,
        },
        finalScore: c.score,
        raw: c.raw,
        ceiling: c.ceiling,
        generatorMatch: Number(c.outfit.match),
        returned: selectedSet.has(c),
      };
      if (diagCompare) {
        const alt = scoreCandidate(c.outfit, { ...ctx, styleProfile: diagCompare });
        const apm = alt.components.profile_match;
        row.__compare = {
          preferredStyles: Array.isArray(diagCompare.preferredStyles)
            ? diagCompare.preferredStyles : [],
          profile_match: {
            value: apm.value,
            weight: apm.weight,
            applied: apm.applied,
            weightedContribution: apm.applied
              ? Number((clamp100(apm.value) * apm.weight).toFixed(2))
              : 0,
          },
          finalScore: alt.score,
          deltaScore: alt.score - c.score,
        };
      }
      return row;
    });
    // eslint-disable-next-line no-console
    console.log('[reco-diagnostic] ' + JSON.stringify({
      preferredStyles: diagPreferredStyles,
      favoriteColors: diagFavoriteColors,
      candidates: meta.__diagnostic,
    }));
  }
  // <<< TEMPORARY DIAGNOSTIC BLOCK — remove everything between markers

  const outfits = final.map((entry) => finish(entry, ctx));
  meta.returned = outfits.length;
  meta.candidates = scored.map((c) => ({
    itemIds: c.outfit.itemIds,
    score: c.score,
    raw: c.raw,
    ceiling: c.ceiling,
  }));

  return { outfits, meta };
}

/**
 * Publish the ranking while preserving the 11-factor compatibility score.
 *
 * The generator scores each candidate's compatibility (`outfit.match`, the
 * value the 11-factor breakdown explains). This engine re-ranks with its own
 * weighted components, so it ships the scores separately on the same outfit:
 *
 *   compatibilityScore — the explained 11-factor score the UI displays.
 *   rankingScore       — the engine's ordering score. Internal only: it drives
 *                        the list order and must never be shown as the Match %.
 *   match              — the legacy compatibility field, kept as an alias of
 *                        `compatibilityScore` so every consumer that reads
 *                        `match` still gets the number the UI shows (the same
 *                        value the fallback `generateOutfits` path serves).
 */
function finish(entry, ctx) {
  const outfit = entry.outfit;
  const compatibility = clamp100(Number(outfit.compatibilityScore ?? outfit.match));
  outfit.compatibilityScore = compatibility;
  outfit.rankingScore = entry.score;
  // `match` precedes the two-score split and meant "compatibility". Keep it an
  // alias of the displayed number rather than leaking the ranking score.
  outfit.match = compatibility;
  if (Array.isArray(outfit.breakdown) && Array.isArray(outfit.items)) {
    try {
      outfit.explanation = scoring.explain(
        outfit.items,
        {
          occasion: ctx.occasion,
          weather: ctx.weather,
          styleProfile: ctx.styleProfile,
          month: ctx.month,
        },
        // Quote the number the UI displays: the ranking must never read as a
        // compatibility percentage in prose.
        { breakdown: outfit.breakdown, match: compatibility },
      );
    } catch {
      // Keep the generator's explanation rather than failing the request.
    }
  }
  return outfit;
}

module.exports = {
  recommend,
  applyHardConstraints,
  scoreCandidate,
  similarityTo,
  freshnessOf,
  SCORE_WEIGHTS,
  COMPONENT_MEANING,
  DIVERSITY_PENALTY,
  EXPLORATION_BAND,
  EXPLORATION_MIN_SCORE,
};
