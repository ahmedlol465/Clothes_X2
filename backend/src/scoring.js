/**
 * Compatibility scoring — the spec's full 11-factor model.
 *
 * The previous engine used 5 hardcoded factors with every value clamped into
 * 60..97, which meant every outfit scored between 78 and 92 and the number
 * carried almost no information. This module computes all eleven factors for
 * real, lets them spread across a genuine range, and lets the style-memory
 * loop re-weight them per user.
 *
 *   color_harmony · style_compatibility · occasion_fit · weather_match
 *   season_match · personal_preference · body_fit_preference · recent_usage
 *   wardrobe_availability · trend_compatibility · user_feedback
 *
 * Pure functions. No I/O. `scoreOutfit()` is the single entry point.
 */
'use strict';

const tax = require('./taxonomy');
const memory = require('./style-memory');

/** Spec defaults from common/vocabularies.ts MATCH_FACTOR_WEIGHTS. */
const BASE_WEIGHTS = {
  color_harmony: 0.16,
  style_compatibility: 0.13,
  occasion_fit: 0.14,
  weather_match: 0.12,
  season_match: 0.08,
  personal_preference: 0.14,
  body_fit_preference: 0.06,
  recent_usage: 0.06,
  wardrobe_availability: 0.05,
  trend_compatibility: 0.03,
  user_feedback: 0.03,
};

const FACTOR_LABELS = {
  color_harmony: 'Color Harmony',
  style_compatibility: 'Style Compatibility',
  occasion_fit: 'Occasion Fit',
  weather_match: 'Weather Match',
  season_match: 'Season Match',
  personal_preference: 'Personal Taste',
  body_fit_preference: 'Fit Preference',
  recent_usage: 'Recent Usage',
  wardrobe_availability: 'Wardrobe Availability',
  trend_compatibility: 'Trend Compatibility',
  user_feedback: 'Your Feedback',
};

/**
 * A factor that returns `hasSignal: false` is excluded from the weighted mean
 * and reported with `applied: false`.
 *
 * This matters a great deal. Before this, Personal Taste / Fit Preference /
 * User Feedback returned a flattering constant ~78 whenever the user had no
 * style profile and no ratings yet. That constant was ~40% of the total
 * weight, so it drowned out the factors that genuinely discriminate: three
 * outfits whose occasion fit ranged 51-92 all scored 79-80.
 *
 * Now those factors drop out until there is real evidence for them, the
 * remaining weights renormalise to 1, and the score actually means something.
 * As the user rates outfits and states preferences, they come back in.
 */
const FACTOR_DEFAULTS = {
  color_harmony: 82,
  style_compatibility: 82,
  occasion_fit: 80,
  weather_match: 82,
  season_match: 84,
  personal_preference: 75,
  body_fit_preference: 80,
  recent_usage: 84,
  wardrobe_availability: 46,
  trend_compatibility: 82,
  user_feedback: 75,
};

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : 0));
}

/**
 * Squash the raw weighted average through a logistic curve centred at 62.
 * Keeps scores in a believable 35..98 band while preserving real ordering —
 * a genuinely bad outfit can now score 41, which it never could before.
 */
function calibrate(raw) {
  return Math.round(100 / (1 + Math.exp(-(raw - 62) / 11)));
}

// ------------------------------------------------------------------ factors

/**
 * Style compatibility.
 *
 * The previous version penalised "any variety beyond two distinct style
 * labels" whenever a formal and a casual piece appeared together. That
 * misfired on correct outfits: a formal blazer over a smart-casual shirt is
 * exactly how a suit is supposed to work, and it was scoring 66 while a
 * matching set of casual basics scored 90.
 *
 * What actually predicts a clash is the SPREAD on the formality scale, not
 * the number of distinct labels. Layers legitimately bridge one or two levels;
 * a three-plus level spread (loungewear next to black tie) does not.
 */
function styleCompatibility(items) {
  if (!items || items.length < 2) return 82;
  const levels = items.map((i) => tax.formalityOf(i));
  const spread = Math.max(...levels) - Math.min(...levels);

  let score = 90;
  if (spread === 0) score += 5;
  else if (spread <= 2) score += 2; // layering — normal and correct
  else if (spread === 3) score -= 14;
  else score -= 30;

  // Mixing eras or design languages reads as "assembled", not "styled".
  const eras = new Set(
    items.map((i) => {
      const t = tax.normalize(`${i.style} ${i.name}`);
      if (/vintage|retro|70s|80s|90s/.test(t)) return 'vintage';
      if (/street|oversized|graphic|hype/.test(t)) return 'street';
      if (/modern|contemporary|minimal/.test(t)) return 'modern';
      if (/classic|timeless/.test(t)) return 'classic';
      return 'any';
    }),
  );
  if (eras.size > 2) score -= 8;

  // All one silhouette language is a genuine plus.
  const labels = new Set(items.map((i) => tax.normalize(i.style)).filter(Boolean));
  if (labels.size === 1) score += 4;
  return clamp(score);
}

function personalPreference(items, styleProfile = {}, mem = null) {
  if (!items || !items.length) return { value: 0, hasSignal: false };
  const favColors = (styleProfile.favoriteColors || []).map(tax.normalize).filter(Boolean);
  const favStyles = (styleProfile.preferredStyles || []).map(tax.normalize).filter(Boolean);
  const learned = Object.keys(mem?.colors || {}).length + Object.keys(mem?.styles || {}).length;
  const hasSignal = favColors.length > 0 || favStyles.length > 0 || learned > 0;
  if (!hasSignal) return { value: FACTOR_DEFAULTS.personal_preference, hasSignal: false };

  const layers = [];
  if (favColors.length || favStyles.length) {
    let hits = 0;
    let total = 0;
    for (const it of items) {
      total += 2;
      const c = tax.normalize(it.color);
      const s = tax.normalize(it.style);
      if (favColors.some((f) => c.includes(f) || tax.familyOf(c) === f)) hits += 1;
      if (favStyles.some((f) => s.includes(f))) hits += 1;
    }
    layers.push(74 + (hits / Math.max(1, total)) * 24);
  }
  // The learned opinion layer sits on top of the declared profile.
  if (learned > 0) {
    const affinity = items.reduce((a, it) => a + memory.itemAffinity(mem, it), 0) / items.length;
    layers.push(20 + affinity * 80);
  }
  return {
    value: layers.reduce((a, b) => a + b, 0) / layers.length,
    hasSignal: true,
  };
}

/**
 * Fit preference. Real signals are thin (sizes, cuts, "I like relaxed fits"),
 * so this only speaks when the profile actually declares a preference — and
 * reports `hasSignal: false` otherwise instead of inventing a score.
 */
function bodyFitPreference(items, styleProfile = {}) {
  if (!items || !items.length) return { value: 0, hasSignal: false };
  const fit = tax.normalize(styleProfile.fitPreference || styleProfile.fit);
  const notes = tax.normalize(styleProfile.notes);
  const hay = `${fit} ${notes}`;
  if (!/relaxed|oversized|loose|wide|tailored|fitted|slim|boxy|cropped/.test(hay)) {
    return { value: FACTOR_DEFAULTS.body_fit_preference, hasSignal: false };
  }

  let score = 78;
  const wear = tax.normalize(items.map((i) => `${i.style} ${i.name}`).join(' '));
  const relaxed = /relaxed|oversized|loose|wide/.test(hay);
  const fitted = /tailored|fitted|slim/.test(hay);
  const wearingRelaxed = /oversized|relaxed|wide[- ]?leg|boxy|loose/.test(wear);
  const wearingFitted = /slim|skinny|tailored|fitted|cropped/.test(wear);

  if (relaxed) score += wearingRelaxed ? 14 : wearingFitted ? -16 : 0;
  if (fitted) score += wearingFitted ? 14 : wearingRelaxed ? -16 : 0;

  // Length consistency matters more than size labels.
  const lengths = items
    .map((i) => {
      const t = tax.normalize(`${i.name} ${i.style}`);
      if (/mini|shorts|cropped/.test(t)) return 'short';
      if (/midi|maxi|long|ankle/.test(t)) return 'long';
      return 'regular';
    })
    .filter(Boolean);
  if (new Set(lengths).size > 2) score -= 10;
  return { value: clamp(score), hasSignal: true };
}

/**
 * Rotation pressure. Strongly boosts pieces that have been sitting unworn and
 * penalises the ones already on rotation — this is what stops the app from
 * recommending the same three things forever.
 */
function recentUsage(items) {
  if (!items || !items.length) return 80;
  const worn = items.map((i) => Number(i.timesWorn || 0));
  const maxWorn = Math.max(...worn, 1);
  const total = worn.reduce((a, b) => a + b, 0);
  const avg = total / worn.length;

  let score = 88;
  for (const w of worn) {
    if (w === 0) score += 8; // never worn — prime rotation candidate
    else if (w > maxWorn * 0.9) score -= 8; // the most-worn piece in the set
    else if (w > avg * 1.4) score -= 4;
  }
  return clamp(score);
}

/** Completeness: does this actually form a wearable outfit? */
function wardrobeAvailability(items) {
  const slots = new Set(items.map(tax.slotOf).filter(Boolean));
  if (!slots.size) return 40;
  const required = tax.requiredSlots();
  const filled = required.filter((s) => slots.has(s)).length / required.length;
  let score = 46 + filled * 46;
  if (slots.has('shoes')) score += 8; // shoes are what make it look deliberate
  if (slots.has('accessory')) score += 4;
  return clamp(score);
}

function weatherMatch(items, weather = {}) {
  if (!items || !items.length) return 80;
  const avg = items.reduce((a, it) => a + tax.weatherScore(it, weather), 0) / items.length;
  // One badly-wrong piece drags the whole outfit down.
  const worst = Math.min(...items.map((it) => tax.weatherScore(it, weather)));
  return clamp(avg * 0.75 + worst * 0.25);
}

function seasonMatch(items, month) {
  if (!items || !items.length) return 80;
  const m = month == null ? new Date().getMonth() + 1 : Number(month);
  return clamp(items.reduce((a, it) => a + tax.seasonScore(it, m), 0) / items.length);
}

// -------------------------------------------------------------------- entry

/**
 * Score an outfit.
 *
 * Only factors that report `hasSignal` take part in the weighted mean; the
 * remaining weights are redistributed across the ones that do. Factors with no
 * evidence are still returned in the breakdown with `applied: false`, so the
 * UI can show "no feedback yet" rather than inventing a number.
 *
 * @param {object[]} items        wardrobe items in the outfit
 * @param {object}   ctx
 * @param {string}   ctx.occasion
 * @param {object}   ctx.weather   { tempC, condition }
 * @param {object}   ctx.styleProfile
 * @param {object}   ctx.memory    StyleMemory record (optional)
 * @param {number}   ctx.month     1-12, defaults to today
 * @param {object}   ctx.weights   override the weight table
 * @returns {{ match:number, raw:number, breakdown:Array, weights:object }}
 */
/**
 * How complete an outfit is: the share of required slots (top, bottom, shoes)
 * that are filled.
 *
 * This is a gate rather than a weighted factor. "Are these pieces good
 * together?" and "is this even an outfit?" are different questions, and
 * averaging them together let a single scarf score 89 — higher than a
 * complete blazer-and-trousers look.
 */
function completeness(items) {
  const slots = new Set((items || []).map(tax.slotOf).filter(Boolean));
  const required = tax.requiredSlots();
  const filled = required.filter((s) => slots.has(s)).length;
  return { ratio: filled / required.length, filled, required: required.length };
}

/** Hard ceiling on the final score, driven by completeness. */
const COMPLETENESS_CAP = [
  { min: 1, cap: 100 },
  { min: 2 / 3, cap: 80 },
  { min: 1 / 3, cap: 62 },
  { min: 0, cap: 40 },
];

function scoreOutfit(items, ctx = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];

  // No pieces is not "average" — it is zero. Anything else lets an empty
  // outfit outscore a real but mediocre one.
  if (!list.length) {
    return {
      match: 0,
      raw: 0,
      breakdown: Object.keys(BASE_WEIGHTS).map((key) => ({
        key,
        label: FACTOR_LABELS[key],
        value: 0,
        weight: BASE_WEIGHTS[key],
        applied: false,
        contribution: 0,
      })),
      weights: { ...BASE_WEIGHTS },
    };
  }

  const mem = ctx.memory || memory.empty();
  const { occasion = '', weather = {}, styleProfile = {}, month } = ctx;

  const signals = {
    color_harmony: { value: tax.colorHarmony(list), hasSignal: true },
    style_compatibility: { value: styleCompatibility(list), hasSignal: true },
    occasion_fit: { value: tax.occasionFit(list, occasion), hasSignal: true },
    weather_match: { value: weatherMatch(list, weather), hasSignal: true },
    season_match: { value: seasonMatch(list, month), hasSignal: list.some((i) => tax.normalize(i.season || '').length) },
    personal_preference: personalPreference(list, styleProfile, mem),
    body_fit_preference: bodyFitPreference(list, styleProfile),
    recent_usage: { value: recentUsage(list), hasSignal: true },
    wardrobe_availability: { value: wardrobeAvailability(list), hasSignal: true },
    trend_compatibility: { value: tax.trendScore(list, occasion), hasSignal: true },
    user_feedback: memory.feedbackScore(mem, list),
  };

  const table = ctx.weights || memory.factorWeights(mem, BASE_WEIGHTS);
  // Renormalise over the factors that actually spoke.
  const activeKeys = new Set(Object.entries(signals).filter(([, s]) => s.hasSignal).map(([k]) => k));
  const effectiveWeights = normaliseWeights(
    Object.fromEntries(Object.entries(table).filter(([k]) => activeKeys.has(k))),
  );

  let raw = 0;
  let weightTotal = 0;
  const breakdown = Object.entries(signals).map(([key, signal]) => {
    const weight = effectiveWeights[key] || 0;
    const applied = signal.hasSignal && weight > 0;
    const contribution = applied ? signal.value * weight : 0;
    if (applied) {
      raw += contribution;
      weightTotal += weight;
    }
    return {
      key,
      label: FACTOR_LABELS[key],
      value: Math.round(clamp(signal.value)),
      weight: Number(weight.toFixed(4)),
      applied,
      contribution: Math.round(contribution * 10) / 10,
    };
  });

  breakdown.sort((a, b) => {
    if (a.applied !== b.applied) return a.applied ? -1 : 1;
    return b.contribution - a.contribution;
  });

  const complete = completeness(list);
  const ceiling = COMPLETENESS_CAP.find((t) => complete.ratio >= t.min).cap;
  const calibrated = calibrate(raw);

  return {
    match: Math.min(calibrated, ceiling),
    raw: Math.round(raw * 10) / 10,
    calibrated,
    // Present when the gate actually held the score back.
    ...(ceiling < calibrated ? { cappedBy: 'completeness', ceiling } : {}),
    completeness: {
      ratio: Number(complete.ratio.toFixed(2)),
      filled: complete.filled,
      required: complete.required,
    },
    breakdown,
    weights: Object.fromEntries(Object.entries(effectiveWeights).map(([k, v]) => [k, Number(v.toFixed(4))])),
  };
}

/** Guarantee the weights sum to exactly 1 after the learning boosts. */
function normaliseWeights(weights) {
  const entries = Object.entries(weights).filter(([, v]) => v > 0);
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  const out = {};
  for (const [k, v] of entries) out[k] = v / total;
  return out;
}

/**
 * Human-readable explanation built from the strongest and weakest factors,
 * so the "Why this outfit?" copy is derived from the actual arithmetic.
 */
function explain(items, ctx = {}, result = null) {
  const scored = result || scoreOutfit(items, ctx);
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return 'No pieces selected yet.';

  const names = list.map((i) => i.name).join(' + ');
  const colors = [...new Set(list.map((i) => i.color).filter(Boolean))];
  const palette = colors.length ? colors.join(' / ') : 'a neutral palette';

  const strongest = scored.breakdown.slice(0, 2);
  const weakest = scored.breakdown[scored.breakdown.length - 1];

  const reasons = [];
  const occasion = tax.detectOccasions(ctx.occasion)[0];
  const temp = ctx.weather?.tempC;

  // Lead with the biggest genuine strength.
  if (strongest[0]?.key === 'color_harmony') {
    reasons.push(`${palette} reads as one deliberate palette`);
  } else if (strongest[0]?.key === 'occasion_fit') {
    reasons.push(`the formality lands right for ${occasion || 'the occasion'}`);
  } else if (strongest[0]?.key === 'personal_preference') {
    reasons.push('every piece matches the style you keep gravitating to');
  } else if (strongest[0]?.key === 'weather_match') {
    reasons.push('the fabrics suit the temperature');
  } else {
    reasons.push(`${strongest[0]?.label.toLowerCase() || 'the mix'} is the strongest signal here`);
  }

  if (temp != null) {
    reasons.push(temp >= 26 ? 'lightweight layers handle the warmth' : 'layering handles the temperature');
  }
  if (scored.breakdown.some((b) => b.key === 'recent_usage' && b.value >= 92)) {
    reasons.push('it rotates in something you have not worn in a while');
  }
  if (weakest && weakest.value < 62) {
    reasons.push(`the one compromise is ${weakest.label.toLowerCase()} at ${weakest.value}%`);
  }

  return `${names} — ${reasons.join(', and ')}. Overall match ${scored.match}%.`;
}

module.exports = {
  scoreOutfit,
  explain,
  normaliseWeights,
  BASE_WEIGHTS,
  FACTOR_LABELS,
};
