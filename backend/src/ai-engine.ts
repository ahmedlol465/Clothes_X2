/**
 * SmartWardrobe AI engine (§9 AI/ML pipeline).
 *
 *   USER REQUEST → CONTEXT ENGINE → WARDROBE FILTER → CANDIDATE OUTFITS
 *   → COMPATIBILITY ENGINE → PERSONALIZATION → RANKING → EXPLANATION
 *   → OUTFIT → USER FEEDBACK → LEARNING (StyleMemory)
 *
 * Rebuilt for the stylist release:
 *   • Scoring now runs the full 11-factor model from `src/scoring.js` instead
 *     of 5 hardcoded heuristics clamped into 60..97, and it reads the learned
 *     StyleMemory so ratings actually change what gets recommended.
 *   • `generateOutfits` uses a beam search over outfit slots rather than a
 *     cartesian product that stopped after 24 combinations — so it scales and
 *     it enforces rotation (you stop seeing the same three pieces).
 *   • `remixOutfit` produces the casual / cold / date / summer / formal variants.
 *   • `chatReply` is still fully offline: the rule-based fallback a user hits
 *     when no LLM key is configured is now genuinely useful.
 *
 * The Python FastAPI service (ai-service/) mirrors the older subset. The Node
 * backend uses this embedded copy so the app runs with `npm start` only.
 */
import * as tax from './taxonomy';
import * as scoring from './scoring';
import * as memoryStore from './style-memory';
import * as retrieval from './retrieval';
import {
  arabicSlot,
  categoryLabel,
  detectLanguage,
  localizedReply,
  normalizeArabic,
  type LanguageCode,
} from './language';

// ------------------------------------------------------------- compatibility

/**
 * Backwards-compatible entry point used by /ai/calculate-compatibility,
 * /outfits POST, /shop/before-you-buy and the compatibility breakdown screen.
 * `breakdown` entries keep their { label, value } shape and gain extra fields.
 */
function calculateCompatibility(items: any, ctx: any = {}) {
  return scoring.scoreOutfit(items, ctx);
}

function explainOutfit(items: any, ctx: any = {}, compat: any = null) {
  return scoring.explain(items, ctx, compat);
}

// ----------------------------------------------------------------- ranking

/** Number of candidates to keep per slot during the beam search. */
const BEAM_PER_SLOT = 10;
const BEAM_WIDTH = 8;
const MAX_COMBOS = 400;

/**
 * Rank candidate garments for one slot.
 * `focus` optionally biases toward a request (used by chat + retrieval).
 */
/**
 * Thermal responsibility per slot. A blazer carries most of the outfit's
 * insulation, so a wrong-climate blazer should disqualify the whole look;
 * a wrong-climate belt is a minor issue. Ranking every slot with the same
 * climate weight let a linen summer blazer top a snow outfit.
 */
const CLIMATE_WEIGHT = { outerwear: 0.55, shoes: 0.3, top: 0.28, bottom: 0.25, accessory: 0.15 };
const CLIMATE_FLOOR = 40; // below this the piece is actively wrong for the weather

/**
 * Season the weather is actually in. The calendar month is the wrong signal
 * when the caller pins a temperature (or the live weather disagrees with the
 * date): the audit found winter-labelled pieces recommended at 35C because
 * the season score only read today's date.
 */
function monthForWeather(weather: any = {}, fallback?: number) {
  const t = Number(weather?.tempC);
  if (weather?.tempC == null || !Number.isFinite(t)) return fallback ?? (new Date().getMonth() + 1);
  if (t >= 28) return 7; // summer
  if (t >= 21) return 5; // spring (mild, next to summer)
  if (t >= 12) return 10; // autumn
  return 1; // winter
}

const VARIETY_JITTER = 7;

function rankSlot(pool: any, slot: any, ctx: any = {}) {
  const { occasion = '', weather = {}, styleProfile = {}, memory = null, focus = '' } = ctx;
  // Absolute exclusions ("I never wear sneakers") are filtered, not scored.
  const inSlot = memoryStore.withoutAvoided(memory || memoryStore.empty(), pool)
    .filter((i) => tax.slotOf(i) === slot);
  const candidates = inSlot.length
    ? inSlot
    : pool.filter((i) => tax.slotOf(i) === slot);
  if (!candidates.length) return [];

  const target = tax.occasionTarget(occasion);
  const climateWeight = CLIMATE_WEIGHT[slot] ?? 0.25;

  const scored = candidates
    .map((item) => {
      let score = 0;
      if (target != null) score += Math.max(0, 1 - Math.abs(tax.formalityOf(item) - target) / 5) * 30;
      const climate = tax.weatherScore(item, weather);
      // Dressy occasions: pieces that read as sportswear or beachwear lose
      // out to anything dressier, even when the climate score favours them.
      if (target != null && target >= 4) {
        const f = tax.formalityOf(item);
        if (f <= 2) score -= 25;
        else if (f <= 3) score -= 8;
      }
      score += climate * climateWeight;
      score += memoryStore.itemAffinity(memory, item) * 24;
      if (focus) score += retrieval.lexicalScore(focus, item) * 26;
      // Rotation pressure: unworn pieces climb.
      const worn = Number(item.timesWorn || 0);
      score += worn === 0 ? 8 : Math.max(0, 6 - worn * 0.35);
      // Small random nudge so repeat requests don't return the same few
      // outfits. Off under test so specs stay deterministic.
      if (process.env.NODE_ENV !== 'test') score += Math.random() * VARIETY_JITTER;
      // Hard disqualification, but only while something wearable survives.
      return { item, score, climate };
    })
    .sort((a, b) => b.score - a.score);

  // Very cold: shorts and tank tops are out while anything else exists.
  if (Number(weather.tempC ?? 24) <= 10) {
    const bare = (c: any) => /short|tank|sleeveless|crop/.test(
      tax.normalize(`${c.item.subcategory || ''} ${c.item.legacy?.analysis?.subcategory || ''} ${c.item.name || ''}`));
    const covered = scored.filter((c) => !bare(c));
    if (covered.length) scored.splice(0, scored.length, ...covered);
  }
  const viable = scored.filter((c) => c.climate >= CLIMATE_FLOOR);
  const useable = viable.length ? viable : scored;
  return useable.slice(0, BEAM_PER_SLOT).map((c) => c.item);
}

/**
 * Beam search over outfit slots.
 *
 * Slot order matters: outerwear first (it constrains the silhouette), then
 * top, bottom, shoes, accessory. At each step we keep the best `BEAM_WIDTH`
 * partial outfits, scoring the partial combination so far.
 */
function beamSearch(pool: any, ctx: any = {}) {
  const { weather = {}, occasion = '' } = ctx;
  const month = ctx.month ?? monthForWeather(weather);
  const scoreCtx = { occasion, weather, styleProfile: ctx.styleProfile, memory: ctx.memory, month };
  const anchor = ctx.anchor || null;

  let beams = [{ pieces: [], score: 0 }];
  const anchorSlot = anchor ? tax.slotOf(anchor) : null;

  for (const { slot, required } of tax.OUTFIT_SLOTS) {
    // Outerwear is only relevant when it is cold or the occasion is dressy -
    // unless the user explicitly asked for an outer layer, in which case
    // dropping it would answer a different question than the one asked.
    const needsOuter = slot === 'outerwear'
      && (anchorSlot === 'outerwear'
        || Number(weather.tempC ?? 24) <= 21
        // A dressy occasion wants a jacket only when it is not hot: a blazer
        // at 35C is the audit's top failure.
        || ((tax.occasionTarget(occasion) ?? 2) >= 4 && Number(weather.tempC ?? 24) <= 27));
    if (slot === 'outerwear' && !needsOuter) continue;

    // When the user names a garment, that garment is not a hint - it is a
    // requirement. Ranking alone used to drop it, so the reply would claim it
    // was "anchored" on a piece the outfit did not contain.
    const candidates = anchor && tax.slotOf(anchor) === slot
      ? [anchor]
      : rankSlot(pool, slot, ctx);
    if (!candidates.length) {
      if (required) continue; // tolerate an incomplete wardrobe
      continue;
    }

    const next = [];
    for (const beam of beams) {
      const bottom = beam.pieces.find((p) => tax.slotOf(p) === 'bottom');
      // Shoes keep to their side of the formality line (no dress shoes
      // under joggers, no sneakers under a suit) - unless every option
      // would break the rule, in which case the best mismatch still beats
      // bare feet.
      let usable = candidates;
      if (slot === 'shoes' && bottom) {
        const matched = candidates.filter((c) => tax.shoesMatchBottom(c, bottom));
        if (matched.length) usable = matched;
      }
      // Open shoes stay out of the cold and out of dressy occasions, while
      // any closed pair is available.
      if (slot === 'shoes') {
        const cold = Number(weather.tempC ?? 24) <= 12;
        const dressy = (tax.occasionTarget(occasion) ?? 2) >= 4;
        if (cold || dressy) {
          const closed = usable.filter((c) => !tax.isOpenShoe(c));
          if (closed.length) usable = closed;
        }
      }
      // Colours that fight (red with green, red with pink, 3+ loud colours):
      // skip them while a calmer option exists for this beam.
      const calm = usable.filter(
        (c) => !tax.colorClash([...beam.pieces, c]),
      );
      if (calm.length) usable = calm;
      for (const candidate of usable) {
        // Never pick the same garment twice.
        if (beam.pieces.some((p) => p.id === candidate.id)) continue;
        // A belt only goes with pants that take one - never with joggers
        // or sweats. The accessory slot is optional, so skip the pairing.
        if (slot === 'accessory' && bottom
          && tax.isBelt(candidate) && !tax.takesABelt(bottom)) continue;
        const pieces = [...beam.pieces, candidate];
        next.push({ pieces, score: scoring.scoreOutfit(pieces, scoreCtx).match });
        if (next.length >= MAX_COMBOS) break;
      }
      if (next.length >= MAX_COMBOS) break;
    }
    if (!next.length) continue;
    next.sort((a, b) => b.score - a.score);
    beams = next.slice(0, BEAM_WIDTH);
  }

  return beams;
}

/**
 * Generate up to `count` ranked outfits.
 *
 * Diversity pass: after ranking, each returned outfit is penalised for reusing
 * pieces already used by higher-ranked outfits, so the user gets five visibly
 * different suggestions rather than five variations of one look.
 */
function generateOutfits(wardrobe: any[] = [], opts: any = {}) {
  const occasion = opts.occasion || 'casual';
  const weather = opts.weather || { tempC: 24, condition: 'partly cloudy' };
  const styleProfile = opts.styleProfile || {};
  const memory = opts.memory || memoryStore.empty();
  const count = Math.min(8, Math.max(1, Number(opts.count) || 3));
  const excludeIds = new Set(opts.excludeIds || []);

  let pool = (Array.isArray(wardrobe) ? wardrobe : []).filter(
    (i) => i && !i.archived && !excludeIds.has(i.id),
  );
  if (!pool.length) return [];

  // Anchor: build every outfit around one specific piece when asked. A piece
  // the user has ruled out ("I never wear sneakers") is never an anchor, even
  // when the request names it — the exclusion wins.
  const requestedAnchor = opts.anchorItemId
    ? pool.find((i) => i.id === opts.anchorItemId)
    : null;
  const anchor =
    requestedAnchor && !memoryStore.isAvoided(memory, requestedAnchor)
      ? requestedAnchor
      : null;
  // Passed into the search, not just reordered in the pool - `rankSlot` scores
  // and re-sorts, so putting the anchor first was cosmetic and it could still
  // be left out of the result.
  const beams = beamSearch(pool, {
    occasion, weather, styleProfile, memory, focus: opts.focus, anchor,
  });
  if (!beams.length) return [];

  const month = opts.month ?? monthForWeather(weather);
  const scored = beams.map((b) => {
    const result = scoring.scoreOutfit(b.pieces, {
      occasion, weather, styleProfile, memory, month,
    });
    return { pieces: b.pieces, ...result };
  });

  // Greedy diversity: penalise outfits that reuse an already-shown garment.
  const ranked = [];
  const usedCounts = new Map();
  const working = [...scored].sort((a, b) => b.match - a.match);
  const pickedIds = new Set();

  while (working.length && ranked.length < count) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < working.length; i += 1) {
      const overlap = working[i].pieces.reduce(
        (a, p) => a + (usedCounts.get(p.id) || 0) * 7,
        0,
      );
      const val = working[i].match - overlap;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    const [chosen] = working.splice(bestIdx, 1);
    if (pickedIds.size && chosen.pieces.every((p) => pickedIds.has(p.id))) continue;
    ranked.push(chosen);
    for (const p of chosen.pieces) {
      usedCounts.set(p.id, (usedCounts.get(p.id) || 0) + 1);
      pickedIds.add(p.id);
    }
  }

  // Present best-first. The diversity pass deliberately trades a little score
  // for variety, so the selected set must be re-sorted before it is shown —
  // otherwise a 90 can appear above a 91 and the ranking looks broken.
  ranked.sort((a, b) => b.match - a.match);

  return ranked.map((c, idx) => toOutfit(c, occasion, idx));
}

function toOutfit(c, occasion, idx) {
  return {
    id: `gen-${Date.now()}-${idx}`,
    name: outfitName(c.pieces, occasion),
    occasion,
    match: c.match,
    breakdown: c.breakdown,
    explanation: scoring.explain(c.pieces, { occasion }, c),
    itemIds: c.pieces.map((p) => p.id),
    pieces: c.pieces.map((p) => p.name),
    items: c.pieces,
    image: c.pieces[0]?.image ?? c.pieces[0]?.imageUrl,
  };
}

// ------------------------------------------------------------------- naming

const NAME_RULES = [
  [/(blazer|suit|tux|trouser)/i, /formal|meeting|interview|wedding|business/i, 'Polished Evening Look'],
  [/(blazer|suit)/i, null, 'Sharp Layered Look'],
  [/(sneaker|tee|t-?shirt)/i, null, 'Effortless Everyday'],
  [/(sweater|knit|cardigan)/i, null, 'Soft Knit Layers'],
  [/(sandal|linen|short)/i, null, 'Light Summer Air'],
  [/(trouser|chino)/i, null, 'Clean Tailoring'],
  [/(dress|gown)/i, null, 'Evening Line'],
];

function outfitName(pieces = [], occasion = '') {
  const hay = pieces.map((p) => `${p.name} ${p.style} ${p.category}`).join(' ');
  for (const [itemRe, occRe, name] of NAME_RULES) {
    const re = itemRe as RegExp;
    if (!re.test(hay)) continue;
    if (occRe && !(occRe as RegExp).test(occasion)) continue;
    return name;
  }
  return 'Classic Minimalist Outfit';
}

// -------------------------------------------------------------------- remix

/**
 * Per-variant rules. A remix has to actually CHANGE the outfit — the earlier
 * version filtered with a ±3 formality tolerance, so "casual" happily kept a
 * Formal blazer and Formal Loafers and returned the suit unchanged.
 *
 *   maxFormality  drop anything dressier than this
 *   minFormality  drop anything less dressy than this
 *   requireWarmth must survive being scored at -5°C
 *   requireCool   must survive being scored at 34°C
 */
const REMIX_TARGETS = {
  casual: { occasion: 'casual', maxFormality: 2 },
  cold: { occasion: 'casual', requireWarmth: true },
  summer: { occasion: 'beach', maxFormality: 3, requireCool: true },
  date: { occasion: 'date night', minFormality: 2 },
  formal: { occasion: 'formal dinner', minFormality: 4 },
};

const REMIX_LABELS = {
  casual: 'Casual version',
  cold: 'Cold version',
  summer: 'Summer version',
  date: 'Date version',
  formal: 'Formal version',
};

const EXTREME_COLD = { tempC: -5, condition: 'snow' };
const EXTREME_HOT = { tempC: 34, condition: 'clear sky' };

function acceptsVariant(item, rule) {
  const level = tax.formalityOf(item);
  const slot = tax.slotOf(item);
  // Footwear finishes an outfit rather than setting its register: a casual look
  // in leather loafers is unremarkable, while a casual look with no shoes at
  // all cannot be worn. The ceiling is relaxed for shoes; the floor is not,
  // because sneakers really do sink a formal look.
  if (rule.maxFormality != null && slot !== 'shoes' && level > rule.maxFormality) return false;
  if (rule.minFormality != null && level < rule.minFormality) return false;
  // Climate rules apply only to pieces that carry real thermal load. Applying
  // them to shoes left the cold remix with no footwear at all, which is worse
  // than a slightly-chilly shoe: an incomplete outfit cannot be worn.
  const thermal = slot === 'outerwear' || slot === 'top' || slot === 'bottom';
  if (thermal) {
    if (rule.requireWarmth && tax.weatherScore(item, EXTREME_COLD) < 55) return false;
    if (rule.requireCool && tax.weatherScore(item, EXTREME_HOT) < 55) return false;
  }
  return true;
}

/**
 * Re-dress an existing outfit for a different context, keeping the pieces the
 * user already picked wherever they still work.
 *
 * Guarantees the result differs from the input where a different outfit
 * exists; when the original already fits the target context (a suit is a
 * perfectly good date-night outfit) it is returned as-is with a note saying
 * so, rather than pretending a regeneration happened.
 */
function remixOutfit(wardrobe, { itemIds = [], variant = 'casual', weather, styleProfile, memory }) {
  const rule = REMIX_TARGETS[variant];
  if (!rule) {
    throw new Error(`Unknown remix variant "${variant}". Use: ${Object.keys(REMIX_TARGETS).join('|')}`);
  }

  const live = (Array.isArray(wardrobe) ? wardrobe : []).filter((i) => !i.archived);
  // Dedupe on the garment, not the id: the wardrobe can hold two "White Shirt"
  // rows, and a remix of an outfit that listed one must not produce a pair.
  const original = [];
  const seen = new Set();
  for (const id of itemIds) {
    const item = live.find((i) => i.id === id);
    if (!item) continue;
    const key = tax.garmentKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    original.push(item);
  }
  const w = weather || { tempC: 24, condition: 'partly cloudy' };
  const mem = memory || memoryStore.empty();
  const ctx = {
    occasion: rule.occasion,
    weather: w,
    styleProfile: styleProfile || {},
    memory: mem,
  };

  const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  // Compare against the resolved, deduped originals — a raw `itemIds` list can
  // repeat a garment, which would make an unchanged remix look like a change.
  const originalIds = original.map((i) => i.id);
  // An item the user has ruled out outright never survives a remix, even if it
  // was in the outfit they handed us.
  const allowed = memoryStore.withoutAvoided(mem, live);
  const viable = original.filter((i) => acceptsVariant(i, rule) && !memoryStore.isAvoided(mem, i));

  // If strict filtering leaves nothing usable, go straight to a fresh search.
  if (!viable.length) {
    const fresh = generateOutfits(allowed, { ...ctx, count: 1, excludeIds: originalIds })[0]
      || generateOutfits(allowed, { ...ctx, count: 1 })[0];
    return finishRemix(fresh ? fresh.items : [], original, rule, ctx, variant, true);
  }

  // Keep the survivors, then top up any slot they left empty.
  const kept = [...viable];
  const haveSlots = new Set(kept.map(tax.slotOf));
  for (const { slot } of tax.OUTFIT_SLOTS) {
    if (haveSlots.has(slot)) continue;
    const pick = rankSlot(allowed.filter((i) => acceptsVariant(i, rule)), slot, ctx)
      .find((c) => !kept.some((k) => k.id === c.id));
    if (pick) {
      kept.push(pick);
      haveSlots.add(slot);
    }
  }

  // The remix should change something. If it did not, try to substitute.
  if (sameIds(kept.map((k) => k.id), originalIds)) {
    const fresh = generateOutfits(allowed, { ...ctx, count: 1 })[0];
    if (fresh && !sameIds(fresh.itemIds, originalIds)) {
      return finishRemix(fresh.items, original, rule, ctx, variant, true);
    }
    // Nothing better exists for this context — the original already fits.
    return finishRemix(kept, original, rule, ctx, variant, false,
      'Your original outfit already fits this context well.');
  }
  return finishRemix(kept, original, rule, ctx, variant, false, avoidedNote(kept, mem));
}

/**
 * If an excluded item only appears because every alternative was worse, say so
 * rather than quietly handing back something the user ruled out.
 */
function avoidedNote(items, mem) {
  const excluded = (items || []).filter((i) => memoryStore.isAvoided(mem, i)).map((i) => i.name);
  if (!excluded.length) return '';
  return `Includes ${excluded.join(' and ')} — you said you never wear ${excluded.length > 1 ? 'them' : 'it'}, but nothing else in this slot works here.`;
}

function finishRemix(items, original, rule, ctx, variant, wasRegenerated, note = '') {
  const result = scoring.scoreOutfit(items, ctx);
  return {
    outfit: {
      id: `remix-${variant}-${Date.now()}`,
      name: `${outfitName(items, rule.occasion)} · ${REMIX_LABELS[variant]}`,
      variant,
      occasion: rule.occasion,
      match: result.match,
      breakdown: result.breakdown,
      completeness: (result as any).completeness,
      explanation: scoring.explain(items, ctx, result),
      itemIds: items.map((p) => p.id),
      pieces: items.map((p) => p.name),
      items,
      image: items[0]?.image ?? items[0]?.imageUrl,
      keptFromOriginal: items.filter((k) => original.some((o) => o.id === k.id)).length,
      regenerated: !!wasRegenerated,
      ...(note ? { note } : {}),
    },
    variants: Object.keys(REMIX_TARGETS),
    labels: REMIX_LABELS,
  };
}

// --------------------------------------------------------------------- chat

/**
 * Turn a phrase into an occasion label, or null when it names none.
 *
 * Checked most-specific-first rather than by token length. "formal dinner"
 * used to resolve to "date night" because both matched and the enumeration
 * order happened to favour dinner.
 */
const OCCASION_PRECEDENCE = [
  // "formal" is only an occasion when it modifies one. A bare "not too formal"
  // is the user steering away from formality, and must not be read as a request
  // for it — hence the qualifier below rather than a bare /formal/.
  [/formal (?:dinner|event|occasion|wear|attire|black ?tie)|black ?tie/, 'formal dinner'],
  [/wedding|gala|ceremony/, 'formal dinner'],
  [/interview|job interview|client/, 'formal dinner'],
  [/business|office|work|meeting|presentation/, 'meeting'],
  [/date ?night|\bdate\b|romantic/, 'date night'],
  [/evening|night out|going out|bar|pub|club|dinner|restaurant/, 'date night'],
  [/brunch|lunch|breakfast|coffee/, 'casual'],
  [/party|birthday|celebration/, 'party'],
  [/beach|swim|pool/, 'beach'],
  [/gym|workout|run|running|sport|training/, 'gym'],
  [/university|college|school|lecture|class|campus/, 'university casual'],
  [/travel|trip|flight|airport|capsule/, 'travel'],
  [/weekend|leisure|chill|relaxed|brunch|casual/, 'casual'],
  [/smart casual/, 'meeting'],
];

/** "less formal", "nothing too dressy" — an explicit walk-away from formality. */
const ANTI_FORMAL = /\b(?:less|not|no[nt]?)\b[^.?!]{0,20}\bformal|dress(?:ed)? down|laid[- ]back|more casual|toned down/i;

function detectOccasion(q = '') {
  const text = tax.normalize(q);
  const antiFormal = ANTI_FORMAL.test(q) || ANTI_FORMAL.test(text);
  for (const [re, occasion] of OCCASION_PRECEDENCE) {
    const rx = re as RegExp;
    if (rx.test(text)) {
      if (antiFormal && /formal|tie/.test(rx.source)) continue;
      return occasion;
    }
  }
  return null;
}

/**
 * Arabic occasion words, checked against the diacritic-folded text
 * (normalizeArabic maps ة→ه, أ→ا, ى→ي, ئ→ي — patterns are written folded).
 */
const ARABIC_OCCASIONS: Array<[RegExp, string]> = [
  [/فرح|زفاف|خطوبه|عرس/, 'formal dinner'],
  [/مقابله|انترويو|شغل|دوام|اجتماع/, 'meeting'],
  [/معاد|موعد|رومانسي/, 'date night'],
  [/خروجه|سهره|عشا|مطعم/, 'date night'],
  [/حفله|عيد ميلاد/, 'party'],
  [/بحر|شاطي|مصيف|حمام سباحه/, 'beach'],
  [/جيم|رياضه|تمرين|جري|نادي/, 'gym'],
  [/جامعه|محاضره|محاضرة|كليه|مدرسه|سكشن/, 'university casual'],
  [/سفر|رحله|طياره|مطار/, 'travel'],
  [/مشوار|قعده|كاجوال|عادي/, 'casual'],
];

function detectArabicOccasion(ar = '') {
  for (const [re, occasion] of ARABIC_OCCASIONS) {
    if (re.test(ar)) return occasion;
  }
  return null;
}

/** Natural-language reading of an occasion key, for offline replies. */
const OCCASION_PHRASE = {
  casual: 'an easy everyday look',
  'university casual': 'a campus look',
  meeting: 'work',
  'date night': 'an evening out',
  'formal dinner': 'something smarter',
  party: 'a party',
  beach: 'the beach',
  gym: 'the gym',
  travel: 'travelling',
};

function occasionPhrase(key) {
  return OCCASION_PHRASE[key] || key;
}

/**
 * A grammatical weather sentence.
 *
 * `weather.summary` is built for a widget ("Partly Cloudy 27°C"), so dropping
 * it into a sentence produced "It's Partly Cloudy 27°C. For casual: ...". The
 * offline stylist is the fallback the user actually reads when the free tier is
 * busy, so it has to sound written rather than assembled.
 */
function weatherLine(weather: any = {}) {
  const t = Number(weather.tempC);
  const feels = Number(weather.feelsLike);
  const cond = String(weather.condition || '').trim();
  const city = weather.city ? ` in ${weather.city}` : '';
  if (!Number.isFinite(t)) return cond ? `It's ${cond}${city}.` : '';
  const feelsPart = Number.isFinite(feels) && Math.abs(feels - t) >= 2
    ? ` (feels like ${Math.round(feels)}°)`
    : '';
  const condPart = cond ? ` and ${cond}` : '';
  return `It's ${Math.round(t)}°C${feelsPart}${condPart}${city}.`;
}

/**
 * Find a garment the user named directly, e.g. "show me my loafers" for
 * "Leather Loafers".
 *
 * Matching is on the head noun ("loafers" from "Leather Loafers") rather than
 * the whole name, because users say "my loafers", not "my leather loafers".
 * The colour words are excluded so this cannot outrank an explicit colour ask.
 */
function findNamedItem(q, wardrobe = []) {
  const COLOR_WORDS = /^(blue|white|beige|black|navy|brown|grey|gray|green|red|olive|cream|denim|khaki|tan|charcoal|indigo|leather|cotton|wool|linen|silk|suede|cashmere)$/;
  let best = null;
  for (const item of wardrobe) {
    const name = tax.normalize(item.name || '');
    if (name.length < 4) continue;
    const head = name.split(/\s+/).pop();
    // Too generic to anchor on: "shirt" alone matches almost any wardrobe.
    if (head.length < 5 || COLOR_WORDS.test(head)) continue;
    if (!new RegExp(`\\b${head}(s|es)?\\b`, 'i').test(q)) continue;
    if (!best || head.length > best.head.length) best = { item, head };
  }
  return best ? best.item : null;
}

/**
 * Offline stylist: intent routing + outfit attachment.
 *
 * This is the fallback whenever no LLM key is configured — and, in practice,
 * whenever the free tier is too busy to answer inside the time budget, which
 * is most of the time under load. It has to carry the product on its own, so
 * it leans on `scoring.explain()` for the reasoning rather than restating a
 * list of garment names. It is memory-aware (honours "less formal", "not these
 * shoes", "I haven't worn it") and always returns a real outfit built from the
 * user's own wardrobe.
 */
function chatReply(message: any, ctx: any = {}) {
  const q = tax.normalize(message);
  const ar = normalizeArabic(message);
  const lang: LanguageCode = ctx.language || detectLanguage(message);
  const lr = (en: string, arText: string, arEg?: string) =>
    localizedReply(lang, en, arText, arEg);
  const wardrobe = (ctx.wardrobe || []).filter((i) => !i.archived);
  const weather = ctx.weather || { tempC: 24, condition: 'partly cloudy', summary: '24°C' };
  const styleProfile = ctx.styleProfile || {};
  const memory = ctx.memory || memoryStore.empty();

    const build = (occasion: any, extra: any = {}) =>
    generateOutfits(wardrobe, {
      occasion: occasion || 'casual',
      weather,
      styleProfile,
      memory,
      count: 1,
      ...extra,
    })[0] || null;

  const intro = lr(
    weatherLine(weather),
    `الجو ${weather.summary || `${weather.tempC}°C`}`,
  );

  // "Who are you / what can you do" — the user is still learning the tool.
  if (/(who are you|what can you do|how do you work|help me start|^help$)/.test(q)
      || /(مين انت|انت مين|بتعمل ايه|بتعرف تعمل ايه|عرفني بنفسك|ساعدني|مساعده|ازاي تشتغل)/.test(ar)) {
    return {
      text: lr(
        'I am your stylist. Tell me the occasion — university, work, a date, a trip — and I build a look from your own wardrobe, ranked by color, weather and how recently you wore each piece. Ask me to swap a piece, make it more formal, or pack for a trip.',
        'أنا ستيليستك الشخصي. قول لي المناسبة — جامعة، شغل، موعد، سفر — وأنا أبني لك إطلالة من ملابسك، مرتبة حسب الألوان والجو وآخر مرة لبست فيها كل قطعة. اطلب مني أبدّل قطعة، أو أخلي اللوك أرسمي، أو أجهز شنطة سفر.',
        'أنا الستيليست بتاعك. قولي المناسبة — جامعة، شغل، معاد، سفر — وهعملك لوك من اللي في دولابك، مرتب حسب الألوان والجو وامتى آخر مرة لبست كل حاجة. ممكن تقولي بدّل حاجة، أو رسمي أكتر، أو جهزلي شنطة سفر.',
      ),
      outfit: null,
      intent: 'chat',
    };
  }

  // "I haven't worn X" / "surprise me" → rotation.
  if (/(haven'?t worn|not worn|unworn|new (thing|piece)|something different|surprise me|rotate)/.test(q)
      || /(لم البس|ما لبستش|لم يرتدي|حاجه جديده|شيء جديد|فاجئني|غيره)/.test(ar)) {
    const ranked = generateOutfits(wardrobe, { occasion: detectOccasion(q) || 'casual', weather, styleProfile, memory, count: 3 });
    const unworn = ranked.find((o) => o.items.some((i) => !i.timesWorn));
    const chosen = unworn || ranked[0];
    const fresh = chosen?.items.find((i) => !i.timesWorn);
    return {
      text: chosen && fresh
        ? lr(
          `${intro} Your least-worn piece is the ${fresh.name} (never worn) — I built a look around it.`,
          `${intro}، وأقل قطعة ارتديتها هي ${fresh.name} (لم تُرتدَ!). بنيت لك إطلالة حولها:`,
          `${intro}، وأقل حاجة لبستها ${fresh.name} (ما لبستش!). عملت لك لوك حوالينها:`,
        )
        : lr(
          'You have worn everything at least once, so I mixed the pieces you reach for least.',
          'لقد ارتديت كل قطعة من قبل، لذا مزجت القطع التي تستخدمها أقل.',
          'لبست كل حاجة قبل كده، فدمجت القطع اللي بتستخدمها أقل.',
        ),
      outfit: chosen || null,
      intent: 'build_outfit',
    };
  }

  // "not these shoes" / "something else" → exclusion.
  if (/(hate|dislike|don'?t like|dont like|do not like|never (?:wear|wearing)|avoid|not these?|something else|change the (shoes?|top|bottom))/.test(q)
      || /(كرهت|مش بحب|ما بحبش|اتجنب|تجنب|ابعد|ما عايزش|مش عايز)/.test(ar)) {
    const englishTarget = q.match(/\b(shoes?|sneakers?|boots?|loafers|top|shirt|tee|jacket|blazer|pants?|jeans?)\b/);
    const arTarget = arabicSlot(message);
    const targetLabel = englishTarget
      ? englishTarget[0]
      : arTarget ? categoryLabel(lang, arTarget) : null;
    const excluded = englishTarget
      ? wardrobe.filter((i) => tax.normalize(`${i.category} ${i.name}`).includes(englishTarget[0].replace(/s$/, ''))).map((i) => i.id)
      : arTarget
        ? wardrobe.filter((i) => tax.slotOf(i) === arTarget).map((i) => i.id)
        : wardrobe.filter((i) => tax.slotOf(i) === 'shoes').slice(0, 1).map((i) => i.id);
    const outfit = build(detectOccasion(q) || 'casual', { excludeIds: excluded });
    return {
      text: outfit
        ? lr(
          `${intro} Swapped the ${targetLabel || 'shoes'} out — this works instead.`,
          `${intro} — استبدلت ${targetLabel || 'الحذاء'}. جرّب هذا بدلًا منه:`,
          `${intro} — بدّلت ${targetLabel || 'الشوز'}. ده هيشتغل بدل منه:`,
        )
        : lr(
          `Add a ${targetLabel || 'second'} option and I will show you the swap.`,
          `أضف خيارًا آخر${targetLabel ? ` بدل ${targetLabel}` : ''} وسأريك البديل.`,
          `ضيف حاجة تانية${targetLabel ? ` بدل ${targetLabel}` : ''} وهوريك البديل.`,
        ),
      outfit,
      intent: 'remix',
    };
  }

  // Formality shifts.
  if (/(less formal|more casual|casual version|relaxed|laid ?back|toned down)/.test(q)
      || /(كاجوال|مريح|استرخاء|اقل رسميه|أقل رسمية|غير رسمي)/.test(ar)) {
    return {
      text: lr(
        `${intro} Here is the relaxed version, same palette.`,
        `${intro} — هذه النسخة الأكثر عفوية، بنفس الألوان:`,
        `${intro} — دي النسخة الكاجوال، بنفس الألوان:`,
      ),
      outfit: build('casual'),
      intent: 'remix',
    };
  }
  if (/(more formal|dress (it )?up|sharper|smarter|business)/.test(q)
      || /(رسمي|شيك|مقابلة|مقابله|عمل|اجتماع|بدله|بدلة)/.test(ar)) {
    return {
      text: lr(
        `${intro} Dressed up — a blazer and smarter shoes dial the formality in.`,
        `${intro} — إطلالة أكثر رسمية. الجاكيتات والأحذية الأنيقة ترفع مستوى الرسمية:`,
        `${intro} — لوك رسمي أكتر. الجاكيت والشوز الشيك بيرفعوا الرسمية:`,
      ),
      outfit: build('formal dinner'),
      intent: 'remix',
    };
  }

  // Weather-led.
  if (/(weather|hot|cold|rain|snow|temperature|what do i wear today)/.test(q)
      || /(جو|طقس|حر|برد|مطر|ثلج|درجه الحراره|درجة الحرارة)/.test(ar)) {
    const outfit = build(detectOccasion(q) || 'casual');
    const hot = Number(weather.tempC) >= 26;
    const cold = Number(weather.tempC) <= 14;
    const advice = lr(
      hot ? 'keep it light and breathable' : cold ? 'layer up' : 'a mid-layer is enough',
      hot ? 'اختر قطعًا خفيفة ومسامية' : cold ? 'ارتدِ طبقات' : 'طبقة متوسطة تكفي',
      hot ? 'خفف اللبس واختار حاجة تتنفس' : cold ? 'البس طبقات' : 'طبقة واحدة متوسطة كافية',
    );
    return {
      text: lr(
        outfit
          ? `${intro} ${advice.charAt(0).toUpperCase()}${advice.slice(1)} — ${outfit.explanation}`
          : `${intro} ${advice.charAt(0).toUpperCase()}${advice.slice(1)}.`,
        `${weather.summary} في ${weather.city || 'منطقتك'} — ${advice}. ${outfit ? 'جرّب:' : ''}`,
      ),
      outfit,
      intent: 'build_outfit',
    };
  }

  // Travel / packing.
  if (/(travel|trip|pack|flight|dubai|capsule)/.test(q)
      || /(سفر|رحله|رحلة|طيران|حقيبه|كبسوله)/.test(ar)) {
    const days = Number((q.match(/(\d+)\s*(day|night)/) || [])[1]) || 5;
    const outfit = build('travel');
    const list = packingList(wardrobe, { days });
    return {
      text: lr(
        `${intro} Pack ${list.items.length} pieces for ${days} days — that gives you about ${list.outfitsEstimate} combinations without repeating anything.`,
        `${intro}. احزم ${list.items.length} قطعة لـ ${days} أيام — هذا يمنحك نحو ${list.outfitsEstimate} تركيبة دون تكرار.`,
        `${intro}. احزم ${list.items.length} حاجة لـ ${days} أيام — ده هياديك حوالي ${list.outfitsEstimate} تركيبة من غير تكرار.`,
      ),
      outfit,
      intent: 'build_outfit',
      packing: list,
    };
  }

  // Colour advice — answered from his own palette, not a generic blog post.
  if (/(colou?rs? (work|go|match|suit)|colou?r combin|what colou?rs?|which colou?rs?)/.test(q)
      || /(الوان|اللون|يليق|يلائم|تناسق|انساق)/.test(ar)) {
    const favorites = (styleProfile.favoriteColors || []).filter(Boolean);
    const paletteTip = favorites.length
      ? lr(
        `Your saved favourites are ${favorites.join(', ')} — pieces in those colours already anchor most of your wardrobe.`,
        `ألوانك المفضلة المحفوظة هي ${favorites.join('، ')} — القطع بهذه الألوان تشكل أساس معظم خزانتك.`,
        `ألوانك المفضلة عندك ${favorites.join('، ')} — أغلب دولابك متبني عليهم أصلاً.`,
      )
      : lr(
        'Neutrals (white, beige, navy, grey) pair with almost everything; one strong colour per outfit keeps it clean.',
        'الألوان المحايدة (أبيض، بيج، كحلي، رمادي) تتناسق مع كل شيء تقريباً؛ ولون قوي واحد في الإطلالة يحافظ على بساطتها.',
        'الألوان المحايدة (أبيض، بيج، كحلي، رمادي) بتمشي مع أي حاجة تقريباً؛ ولون جامد واحد في اللوك يخليه نضيف.',
      );
    return {
      text: `${intro} ${paletteTip}`,
      outfit: null,
      intent: 'chat',
    };
  }

  // Shopping / budget — route him to the gap-based shopping list.
  if (/(what should i buy|worth buying|shopping|budget|cheap|expensive)/.test(q)
      || /(اشتري|اشترى|فلوس|رخيص|غالي|سعر|ميزانيه|تسوق|شوبينج)/.test(ar)) {
    return {
      text: lr(
        'Check Smart Shopping on your profile — it lists the gaps in your wardrobe, so you buy what unlocks the most outfits instead of duplicates.',
        'راجع Smart Shopping في ملفك — يعرض الفجوات في خزانتك، فتشتري ما يفتح أكثر إطلالات بدل القطع المكررة.',
        'بص على Smart Shopping في البروفايل — بيجيبلك الفاضي في دولابك، عشان تشتري اللي يفتحلك لوكيات جديدة مش حاجة عندك زيها.',
      ),
      outfit: null,
      intent: 'chat',
    };
  }

  // Positive feedback on the last suggestion.
  if (/(love it|like it|nice|great look|looks good|perfect|amazing|awesome)/.test(q)
      || /(حلو|جميل|جامد|عظيم|تمام|عجبني|برفكت|تحفه)/.test(ar)) {
    return {
      text: lr(
        'Glad it landed. Want a variation — more casual, or a different pair of shoes?',
        'سعيد أنها عجبتك. هل تريد نسخة أخرى — أكثر عفوية، أو حذاء مختلف؟',
        'جامد إنها عجبتك. تحب نسخة تانية — كاجوال أكتر، أو شوز مختلف؟',
      ),
      outfit: null,
      intent: 'chat',
    };
  }

  // Anchored request: the user named a garment or a colour, so the reply must
  // actually contain it. The verb gate used to require an explicit
  // "wear/put/show", which meant "what about my navy shirt?" fell through to the
  // generic branch and answered with an outfit containing no navy at all.
  const colorWord = q.match(/\b(blue|white|beige|black|navy|brown|grey|gray|green|red|olive|cream|denim|khaki|tan|charcoal|indigo)\b/)
    || (() => {
      const arColors: Array<[RegExp, string]> = [
        [/ازرق|نيفي/, 'blue'], [/ابيض/, 'white'], [/بيج/, 'beige'],
        [/اسود/, 'black'], [/بني|بنى/, 'brown'], [/رمادي/, 'grey'],
        [/اخضر/, 'green'], [/احمر/, 'red'], [/كحلي/, 'navy'],
      ];
      for (const [re, color] of arColors) if (re.test(ar)) return [color];
      return null;
    })();
  const colorWanted = colorWord
    && (/(wear|put|with|around|find|show|has|about|got|own|any)/.test(q)
      || /( البس|ابلش|لون|لوني|ألوان|الوان|مع|حول)/.test(ar));
  const byColor = colorWanted
    ? wardrobe.find((i) => tax.normalize(i.color).includes(colorWord[0]))
    : null;
  const named = findNamedItem(q, wardrobe);

  // Both signals present - "my navy shirt". Prefer the garment that is actually
  // that colour, then the colour alone. A colour is a stronger signal than a
  // bare noun like "shirt", which would otherwise anchor on whichever shirt the
  // wardrobe happened to list first.
  const candidateAnchor = (byColor && named) ? (findNamedItem(q, [byColor]) || byColor) : (byColor || named);
  // "I never wear sneakers" names a garment in order to exclude it, so an
  // avoided piece must not become the anchor of the outfit.
  const anchor = candidateAnchor && !memoryStore.isAvoided(memory, candidateAnchor)
    ? candidateAnchor
    : null;

  if (anchor) {
    const outfit = build(detectOccasion(q) || 'casual', { anchorItemId: anchor.id });
    return {
      text: outfit
        ? lr(
          `${intro} Built around your ${anchor.name} — ${outfit.explanation}`,
          `بنيت الإطلالة حول ${anchor.name} — بنسبة ${outfit.match}%:`,
          `عملت اللوك حوالين ${anchor.name} — بنسبة ${outfit.match}%:`,
        )
        : lr(
          `I can start from the ${anchor.name}, but I need a bottom and shoes to complete the look.`,
          `${anchor.name} هي الأساس. أضف جزءًا سفليًا وحذاءً لإكمال الإطلالة.`,
          `${anchor.name} هي الأساس. ضيف بنطلون وشوز عشان تكمل اللوك.`,
        ),
      outfit,
      intent: 'build_outfit',
    };
  }
  if (colorWanted) {
    return {
      text: lr(
        `${intro} You do not own anything in ${colorWord[0]}. I could suggest what to add — want that?`,
        `لا تملك أي قطعة بلون ${colorWord[0]}. هل تريد أن أقترح ما تضيفه؟`,
        `معندكش حاجة بلون ${colorWord[0]}. تحب أقترح تضيف إيه؟`,
      ),
      outfit: null,
      intent: 'learn',
    };
  }

  // Occasion-led (covers "date", "interview", "university", ...).
  const occasion = detectOccasion(q) || detectArabicOccasion(ar);
  if (occasion || /(what.*wear|dress me|build me|suggest|outfit|recommend|help me)/.test(q)
      || /(اعمل|ابني|جهز|اقترح|لوك|اطلاله|إطلالة|ملابس|لبس)/.test(ar)) {
    const use = occasion || 'casual';
    const outfit = build(use);
    return {
      text: outfit
        ? lr(
          `${intro} For ${occasionPhrase(use)}, ${outfit.explanation}`,
          `${intro}. لـ ${use}: ${outfit.pieces.join(' + ')} — بنسبة ${outfit.match}%.`,
        )
        : lr(
          'Add a few pieces and I will build looks from what you own.',
          'أضف بعض القطع وسأبني لك إطلالات مما تملكه.',
          'ضيف حاجات وهعمل لك لوكيات من اللي عندك.',
        ),
      outfit,
      intent: 'build_outfit',
      occasion: use,
    };
  }

  // Greetings and acknowledgements. Answering "hello" with a random outfit is
  // worse than saying hello back — the user has not asked for anything yet.
  if (/^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|cool|nice|great|awesome|perfect|bye|goodbye|cheers|good (morning|afternoon|evening|night))\b/.test(q)
      || /^(اهلا|ازيك|هاي|مرحبا|سلام|صباح|مساء|تمام|شكرا|ماشي|اوك|اوكي)\b/.test(ar)) {
    return {
      text: lr(
        `${intro} Tell me where you are headed — university, work, a date, a trip — and I will build it from what you own.`,
        `${intro} — قول لي رايح فين — جامعة، شغل، موعد، سفر — وأنا أعملها من اللي عندك.`,
      ),
      outfit: null,
      intent: 'chat',
    };
  }

  // Fallback: still return something wearable rather than a dead end.
  const outfit = build(occasion || 'casual');
  const note = memory.facts?.[0]?.text;
  return {
    // `explanation` already opens with the pieces, so listing them again here
    // just made the sentence repeat itself.
    text: outfit
      ? lr(
        `${note ? `${cap(note)} — and yes, ` : ''}${outfit.explanation}`,
        `${note ? `${cap(note)} — ونعم، ` : ''}${outfit.pieces.join(' + ')} هي أقوى إطلالة لديك بنسبة ${outfit.match}%.`,
        `${note ? `${cap(note)} — وأيوه، ` : ''}${outfit.pieces.join(' + ')} هو أقوى لوك عندك بنسبة ${outfit.match}%.`,
      )
      : lr(
        'Tell me the occasion — university, date, work, travel — and I will build it from your wardrobe.',
        'أخبرني بالمناسبة — جامعة، موعد، عمل، سفر — وسأبنيها من خزانة ملابسك.',
        'قولي المناسبة — جامعة، موعد، شغل، سفر — وهعملها من اللي عندك.',
      ),
    outfit,
    intent: 'chat',
  };
}

function cap(s) {
  return String(s).replace(/\b\w/, (c) => c.toUpperCase());
}

// ------------------------------------------------------------- other tools

/**
 * Analyse an uploaded garment.
 *
 * This used to be a filename regex table with a fabricated confidence of
 * `0.82 + Math.random() * 0.12`. That is worse than no analysis: it reported a
 * confident "Blue / Denim / Casual" for a photo of a green coat named
 * `IMG_4821.jpg`, and the random number meant the same upload could not be
 * reproduced. It also had no way to say "this is not clothing" — a photo of a
 * water bottle was quietly filed as a belt.
 *
 * The real pipeline runs a local fashion-CLIP model over the image for category
 * and attributes, measures colour off the segmented garment pixels, and rejects
 * anything that does not look like clothing. See `src/clothing-vision/`.
 *
 * When no image bytes are available it falls back to the filename heuristic, but
 * labels the result as unverified and marks `color`/`category` as guesses, so a
 * client can tell the difference instead of trusting a number it cannot check.
 *
 * Non-clothing and unreadable images return `{ success: false }` with an
 * `error_type` — never a forced clothing result.
 */
async function analyzeClothing(input: any = {}) {
  const overrides = {};
  for (const key of ['category', 'color', 'style', 'pattern', 'material', 'season', 'formality']) {
    if (input[key]) overrides[key] = input[key];
  }

  const bytes = imageBytesOf(input);
  if (bytes) {
    const { analyzeClothingImage } = require('./clothing-vision');
    try {
      const result = await analyzeClothingImage(bytes, overrides);
      if (result.success) return result;
      // Preserve the rejection contract. A caller must not receive a clothing
      // guess for an image we just proved is not clothing.
      return { ...result, hint: result.hint || undefined };
    } catch (e: any) {
      // Vision disabled or the model missing must not block adding a piece
      // manually: fall through to the filename guess (marked unverified).
      if (e?.code !== 'CLOTHING_VISION_UNAVAILABLE') throw e;
    }
  }

  return {
    ...filenameGuess(input),
    success: true,
    source: 'filename',
    verified: false,
    note: 'No image data was provided, so these attributes were guessed from the filename. '
      + 'Send the image bytes for a real analysis.',
    confidence: 0.3,
    uncertain: ['category', 'color', 'style', 'pattern', 'material', 'season'],
  };
}

/**
 * Pull image bytes out of whatever the request body managed to hand us.
 *
 * Accepts raw base64, a data URL, an already-decoded Buffer, or a
 * `/storage/<file>` reference to something uploaded earlier.
 */
function imageBytesFor(input: any = {}) {
  const direct = imageBytesOf(input);
  if (direct) return direct;

  const fromBase64 = (value) => {
    const b64 = String(value).replace(/^data:[^;]+;base64,/, '').trim();
    if (!b64) return null;
    try {
      const buf = Buffer.from(b64, 'base64');
      return buf.length ? buf : null;
    } catch {
      return null;
    }
  };

  const source = input.dataUrl || input.imageBase64;
  if (source) {
    const buf = fromBase64(source);
    if (buf) return buf;
  }

  const url = input.imageUrl || input.image;
  if (url && /^\/storage\//.test(String(url))) {
    // Resolved by the caller, which owns the storage root. Passed through here
    // as a marker rather than silently analysing the wrong file.
    return null;
  }
  return null;
}

/** Pull image bytes out of whatever the route managed to hand us. */
function imageBytesOf(input: any = {}) {
  if (Buffer.isBuffer(input.bytes)) return input.bytes;
  if (Buffer.isBuffer(input.image)) return input.image;
  if (Buffer.isBuffer(input.buffer)) return input.buffer;
  if (Buffer.isBuffer(input.data) && input.data.length) return input.data;
  return null;
}

/**
 * The old filename table, kept only as the no-image fallback. It is deliberately
 * reported as unverified, because everything it returns is a guess about a
 * string rather than a reading of a garment.
 */
function filenameGuess(input: any = {}) {
  const name = String(input.filename || input.name || 'uploaded garment').toLowerCase();
  const guess = (re, val, fb) => (re.test(name) ? val : fb);
  const category = guess(/shoe|sneaker|loafer|boot/, 'Shoes',
    guess(/jean|trouser|chino|short|skirt|pant|denim/, 'Bottoms',
      guess(/jacket|blazer|coat|hoodie|sweater|knit/, 'Outerwear',
        guess(/belt|scarf|watch|bag|hat|sunglass|tie/, 'Accessories', 'Tops'))));
  const color = guess(/white/, 'White', guess(/black/, 'Black',
    guess(/navy|blue|indigo/, 'Blue', guess(/beige|cream|tan|khaki/, 'Beige',
      guess(/brown/, 'Brown', guess(/grey|gray|charcoal/, 'Grey',
        guess(/green|olive/, 'Green', guess(/red|burgundy/, 'Red', 'White'))))))));
  const style = /suit|blazer|trouser|loafer|oxford/.test(name) ? 'Formal'
    : /denim|jean|sneaker|tee/.test(name) ? 'Casual' : 'Smart Casual';
  const season = /sweater|jacket|coat|wool|suede/.test(name) ? 'Autumn / Winter'
    : /linen|short|tee/.test(name) ? 'Spring / Summer' : 'All Season';
  const pattern = /stripe/.test(name) ? 'Striped' : /check|plaid/.test(name) ? 'Checked' : /floral/.test(name) ? 'Floral' : 'Plain';
  const material = /denim|jean/.test(name) ? 'Denim' : /leather/.test(name) ? 'Leather'
    : /wool|knit|sweater/.test(name) ? 'Wool Blend' : /silk/.test(name) ? 'Silk'
    : /linen/.test(name) ? 'Linen' : 'Cotton';
  return {
    category: input.category || category,
    color: input.color || color,
    style: input.style || style,
    pattern: input.pattern || pattern,
    material: input.material || material,
    season: input.season || season,
    formality: input.formality || (style === 'Formal' ? 'Formal' : style === 'Casual' ? 'Casual' : 'Smart Casual'),
  };
}

/**
 * Wardrobe gap analysis.
 *
 * Real gaps only: a missing category that actually blocks occasions the user
 * already has clothes for, plus occasion coverage and rotation health.
 */
function wardrobeGap(wardrobe = []) {
  const live = wardrobe.filter((i) => !i.archived);
  const byCategory = live.reduce((acc, i) => {
    acc[i.category] = (acc[i.category] || 0) + 1;
    return acc;
  }, {});
  const gaps = [];

  const has = (re) => live.some((i) => re.test(`${i.name} ${i.style} ${i.formality}`));
  const count = (re) => live.filter((i) => re.test(`${i.category} ${i.name}`)).length;

  if (!has(/blazer/i) && byCategory.Tops) {
    gaps.push({
      gap: 'No versatile blazer', suggestion: 'Navy Blazer',
      reason: 'One blazer layers with every top and bottom you already own.',
      unlocks: ['work', 'formal dinner', 'date night'],
    });
  }
  if (!has(/formal/i) && live.some((i) => /shirt|top/i.test(i.category))) {
    gaps.push({
      gap: 'No formal top', suggestion: 'White Formal Shirt',
      reason: 'Your tops are all casual, so dressier occasions are uncovered.',
      unlocks: ['interview', 'wedding'],
    });
  }
  if (count(/shoe|boot/i) < 3) {
    gaps.push({
      gap: 'Shoe rotation is thin', suggestion: 'Black Oxford Shoes',
      reason: 'Three or more pairs unlock distinct formality levels per outfit.',
      unlocks: ['formal dinner', 'office'],
    });
  }
  if (!live.some((i) => /outerwear|jacket|coat|blazer/i.test(`${i.category} ${i.name}`))) {
    gaps.push({
      gap: 'No outer layer', suggestion: 'Trench Coat',
      reason: 'Without one, nothing works below 18°C and the winter half of the year is unusable.',
      unlocks: ['cold weather', 'travel'],
    });
  }

  // Occasion coverage: which contexts currently produce a wearable outfit?
  const contexts = ['casual', 'university', 'work', 'formal dinner', 'date night', 'travel', 'gym'];
  const coverage = contexts.map((occasion) => {
    const outfits = generateOutfits(live, { occasion, weather: { tempC: 22 }, count: 1 });
    return { occasion, covered: outfits.length > 0, match: outfits[0]?.match ?? 0 };
  });
  for (const c of coverage.filter((x) => !x.covered)) {
    gaps.push({
      gap: `No outfit for ${c.occasion}`, suggestion: 'Add a versatile piece',
      reason: 'Your wardrobe cannot currently build a complete look for this context.',
      unlocks: [c.occasion],
    });
  }

  const unworn = live.filter((i) => !i.timesWorn);
  return {
    gaps: gaps.slice(0, 6),
    totalItems: live.length,
    byCategory,
    coverage,
    health: {
      unworn: unworn.length,
      rotationScore: live.length ? Math.round(((live.length - unworn.length) / live.length) * 100) : 0,
      paletteHarmony: live.length >= 2 ? Math.round(tax.colorHarmony(live.slice(0, 8))) : 0,
    },
  };
}

/** Style profile derived from wardrobe composition. */
function styleProfileFromWardrobe(wardrobe = [], feedback = []) {
  const live = wardrobe.filter((i) => !i.archived);
  const top = (values) => {
    const counts = values.filter(Boolean).reduce((acc: any, v) => {
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts as any).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  };
  const avgFormality = live.length
    ? live.reduce((a, i) => a + tax.formalityOf(i), 0) / live.length
    : 2;
  return {
    preferredStyles: top(live.map((i) => i.style)),
    favoriteColors: top(live.map((i) => i.color)),
    dominantFormality: ['Loungewear', 'Casual', 'Smart Casual', 'Business Casual', 'Formal', 'Elegant', 'Black Tie'][
      Math.round(avgFormality)
    ] || 'Casual',
    totalItems: live.length,
    feedbackCount: feedback.length,
  };
}

/**
 * Packing list.
 *
 * Picks a minimal set that still covers every required slot, then reports the
 * real number of distinct outfits those pieces can produce.
 */
function packingList(wardrobe: any[] = [], trip: any = {}) {
  const days = Math.min(21, Math.max(1, Number(trip.days) || 5));
  const live = (Array.isArray(wardrobe) ? wardrobe : []).filter((i) => !i.archived);
  if (!live.length) {
    return { destination: trip.destination || 'Trip', days, items: [], outfitsEstimate: 0, message: 'Add clothes to your wardrobe first.' };
  }

  // One of every slot first, then fill toward the day target.
  const chosen = [];
  const slots = new Set();
  for (const { slot } of tax.OUTFIT_SLOTS) {
    const pick = live
      .filter((i) => !chosen.includes(i) && tax.slotOf(i) === slot)
      .sort((a, b) => (b.timesWorn || 0) - (a.timesWorn || 0))[0];
    if (pick) {
      chosen.push(pick);
      slots.add(slot);
    }
  }
  const target = Math.min(live.length, Math.max(4, Math.ceil(days * 1.5)));
  const rest = live
    .filter((i) => !chosen.includes(i))
    .sort((a, b) => (b.timesWorn || 0) - (a.timesWorn || 0));
  while (chosen.length < target && rest.length) chosen.push(rest.shift());

  // Real combination maths from the slots actually covered.
  const perSlot = tax.OUTFIT_SLOTS.map(({ slot }) => chosen.filter((i) => tax.slotOf(i) === slot).length);
  let outfitsEstimate = 1;
  for (const n of perSlot) {
    if (n > 0) outfitsEstimate *= n;
    else outfitsEstimate = 0;
  }
  // Outerwear multiplies rather than adds: any layer works with any base.
  const layers = chosen.filter((i) => tax.slotOf(i) === 'outerwear').length;
  const bases = perSlot[1] * Math.max(1, perSlot[2]) * Math.max(1, perSlot[3]);
  outfitsEstimate = Math.max(bases, outfitsEstimate) * Math.max(1, layers + 1);

  return {
    destination: trip.destination || 'Trip',
    days,
    items: chosen,
    outfitsEstimate,
    slotsFilled: [...slots],
    complete: tax.requiredSlots().every((s) => chosen.some((i) => tax.slotOf(i) === s)),
    message: `${chosen.length} pieces cover ${outfitsEstimate} outfits across ${days} days without repeating a look.`,
  };
}

export {
  calculateCompatibility,
  generateOutfits,
  imageBytesFor,
  filenameGuess as filenameAnalysis,
  remixOutfit,
  outfitName,
  explainOutfit,
  chatReply,
  detectOccasion,
  analyzeClothing,
  wardrobeGap,
  styleProfileFromWardrobe,
  packingList,
  REMIX_TARGETS,
  REMIX_LABELS,
};
