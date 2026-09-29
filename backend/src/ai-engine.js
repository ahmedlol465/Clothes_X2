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
'use strict';

const tax = require('./taxonomy');
const scoring = require('./scoring');
const memoryStore = require('./style-memory');
const retrieval = require('./retrieval');

// ------------------------------------------------------------- compatibility

/**
 * Backwards-compatible entry point used by /ai/calculate-compatibility,
 * /outfits POST, /shop/before-you-buy and the compatibility breakdown screen.
 * `breakdown` entries keep their { label, value } shape and gain extra fields.
 */
function calculateCompatibility(items, ctx = {}) {
  return scoring.scoreOutfit(items, ctx);
}

function explainOutfit(items, ctx = {}, compat = null) {
  return scoring.explain(items, ctx, compat);
}

// ----------------------------------------------------------------- ranking

/** Number of candidates to keep per slot during the beam search. */
const BEAM_PER_SLOT = 6;
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

function rankSlot(pool, slot, ctx = {}) {
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
      score += climate * climateWeight;
      score += memoryStore.itemAffinity(memory, item) * 24;
      if (focus) score += retrieval.lexicalScore(focus, item) * 26;
      // Rotation pressure: unworn pieces climb.
      const worn = Number(item.timesWorn || 0);
      score += worn === 0 ? 8 : Math.max(0, 6 - worn * 0.35);
      // Hard disqualification, but only while something wearable survives.
      return { item, score, climate };
    })
    .sort((a, b) => b.score - a.score);

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
function beamSearch(pool, ctx = {}) {
  const { weather = {}, occasion = '' } = ctx;
  const month = ctx.month ?? (new Date().getMonth() + 1);
  const scoreCtx = { occasion, weather, styleProfile: ctx.styleProfile, memory: ctx.memory, month };

  let beams = [{ pieces: [], score: 0 }];

  for (const { slot, required } of tax.OUTFIT_SLOTS) {
    // Outerwear is only relevant when it is cold or the occasion is dressy.
    const needsOuter = slot === 'outerwear'
      && (Number(weather.tempC ?? 24) <= 21 || (tax.occasionTarget(occasion) ?? 2) >= 4);
    if (slot === 'outerwear' && !needsOuter) continue;

    let candidates = rankSlot(pool, slot, ctx);
    if (!candidates.length) {
      if (required) continue; // tolerate an incomplete wardrobe
      continue;
    }

    const next = [];
    for (const beam of beams) {
      for (const candidate of candidates) {
        // Never pick the same garment twice.
        if (beam.pieces.some((p) => p.id === candidate.id)) continue;
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
function generateOutfits(wardrobe = [], opts = {}) {
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

  // Anchor: build every outfit around one specific piece when asked.
  const anchor = opts.anchorItemId ? pool.find((i) => i.id === opts.anchorItemId) : null;
  if (anchor) pool = [anchor, ...pool.filter((i) => i.id !== anchor.id)];

  const beams = beamSearch(pool, { occasion, weather, styleProfile, memory, focus: opts.focus });
  if (!beams.length) return [];

  const month = opts.month ?? (new Date().getMonth() + 1);
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
    image: c.pieces[0]?.image,
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
    if (!itemRe.test(hay)) continue;
    if (occRe && !occRe.test(occasion)) continue;
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
      completeness: result.completeness,
      explanation: scoring.explain(items, ctx, result),
      itemIds: items.map((p) => p.id),
      pieces: items.map((p) => p.name),
      items,
      image: items[0]?.image,
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
    if (re.test(text)) {
      if (antiFormal && /formal|tie/.test(re.source)) continue;
      return occasion;
    }
  }
  return null;
}

/**
 * Offline stylist: intent routing + outfit attachment.
 *
 * This is the fallback whenever no LLM key is configured, so it has to carry
 * the product on its own. It is memory-aware (honours "less formal", "not
 * these shoes", "I haven't worn it") and always returns a real outfit built
 * from the user's own wardrobe.
 */
function chatReply(message, ctx = {}) {
  const q = tax.normalize(message);
  const wardrobe = (ctx.wardrobe || []).filter((i) => !i.archived);
  const weather = ctx.weather || { tempC: 24, condition: 'partly cloudy', summary: '24°C' };
  const styleProfile = ctx.styleProfile || {};
  const memory = ctx.memory || memoryStore.empty();

  const build = (occasion, extra = {}) =>
    generateOutfits(wardrobe, {
      occasion: occasion || 'casual',
      weather,
      styleProfile,
      memory,
      count: 1,
      ...extra,
    })[0] || null;

  const intro = `It's ${weather.summary || `${weather.tempC}°C`}`;

  // "I haven't worn X" / "surprise me" → rotation.
  if (/(haven'?t worn|not worn|unworn|new (thing|piece)|something different|surprise me|rotate)/.test(q)) {
    const ranked = generateOutfits(wardrobe, { occasion: detectOccasion(q) || 'casual', weather, styleProfile, memory, count: 3 });
    const unworn = ranked.find((o) => o.items.some((i) => !i.timesWorn));
    const chosen = unworn || ranked[0];
    const fresh = chosen?.items.find((i) => !i.timesWorn);
    return {
      text: chosen && fresh
        ? `${intro} and your least-worn piece is the ${fresh.name} (never worn). I built a look around it:`
        : 'You have worn everything at least once, so I mixed the pieces you reach for least.',
      outfit: chosen || null,
      intent: 'build_outfit',
    };
  }

  // "not these shoes" / "something else" → exclusion.
  if (/(hate|don'?t like|dont like|not these?|something else|change the (shoes?|top|bottom))/.test(q)) {
    const target = q.match(/\b(shoes?|sneakers?|boots?|loafers?|top|shirt|tee|jacket|blazer|pants?|jeans?)\b/);
    const excluded = target
      ? wardrobe.filter((i) => tax.normalize(`${i.category} ${i.name}`).includes(target[0].replace(/s$/, ''))).map((i) => i.id)
      : wardrobe.filter((i) => tax.slotOf(i) === 'shoes').slice(0, 1).map((i) => i.id);
    const outfit = build(detectOccasion(q) || 'casual', { excludeIds: excluded });
    return {
      text: outfit
        ? `${intro} — swapped the ${target ? target[0] : 'shoes'} out. This works instead:`
        : `Add a ${target ? target[0] : 'second'} option and I will show you the swap.`,
      outfit,
      intent: 'remix',
    };
  }

  // Formality shifts.
  if (/(less formal|more casual|casual version|relaxed|laid ?back|toned down)/.test(q)) {
    return {
      text: `${intro} — here is the relaxed version, same palette:`,
      outfit: build('casual'),
      intent: 'remix',
    };
  }
  if (/(more formal|dress (it )?up|sharper|smarter|business)/.test(q)) {
    return {
      text: `${intro} — dressed up. Blazers and smarter shoes dial the formality in:`,
      outfit: build('formal dinner'),
      intent: 'remix',
    };
  }

  // Weather-led.
  if (/(weather|hot|cold|rain|snow|temperature|what do i wear today)/.test(q)) {
    const outfit = build(detectOccasion(q) || 'casual');
    const advice = Number(weather.tempC) >= 26
      ? 'keep it light and breathable'
      : Number(weather.tempC) <= 14 ? 'layer up' : 'a mid-layer is enough';
    return {
      text: `${weather.summary} in ${weather.city || 'your area'} — ${advice}. ${outfit ? `Try:` : ''}`,
      outfit,
      intent: 'build_outfit',
    };
  }

  // Travel / packing.
  if (/(travel|trip|pack|flight|dubai|capsule)/.test(q)) {
    const days = Number((q.match(/(\d+)\s*(day|night)/) || [])[1]) || 5;
    const outfit = build('travel');
    const list = packingList(wardrobe, { days });
    return {
      text: `${intro}. Pack ${list.items.length} pieces for ${days} days — that gives you about ${list.outfitsEstimate} combinations without repeating anything.`,
      outfit,
      intent: 'build_outfit',
      packing: list,
    };
  }

  // Colour-led.
  const colorWord = q.match(/\b(blue|white|beige|black|navy|brown|grey|gray|green|red|olive|cream|denim|khaki|tan|charcoal|indigo)\b/);
  if (colorWord && /(wear|put|with|around|find|show|has)/.test(q)) {
    const anchor = wardrobe.find((i) => tax.normalize(i.color).includes(colorWord[0]));
    if (anchor) {
      const outfit = build(detectOccasion(q) || 'casual', { anchorItemId: anchor.id });
      return {
        text: outfit
          ? `Anchored on the ${anchor.name} — ${outfit.match}% match built around it:`
          : `The ${anchor.name} is the anchor. Add a bottom and shoes to complete it.`,
        outfit,
        intent: 'build_outfit',
      };
    }
    return {
      text: `You do not own anything in ${colorWord[0]}. I could suggest what to add — want that?`,
      outfit: null,
      intent: 'learn',
    };
  }

  // Occasion-led (covers "date", "interview", "university", ...).
  const occasion = detectOccasion(q);
  if (occasion || /(what.*wear|dress me|build me|suggest|outfit|recommend|help me)/.test(q)) {
    const use = occasion || 'casual';
    const outfit = build(use);
    return {
      text: outfit
        ? `${intro}. For ${use}: ${outfit.pieces.join(' + ')} — ${outfit.match}% match.`
        : 'Add a few pieces and I will build looks from what you own.',
      outfit,
      intent: 'build_outfit',
      occasion: use,
    };
  }

  // Fallback: still return something wearable rather than a dead end.
  const outfit = build(occasion || 'casual');
  const note = memory.facts?.[0]?.text;
  return {
    text: outfit
      ? `${note ? `${cap(note)} — and yes, ` : ''}${outfit.pieces.join(' + ')} is your strongest ${outfit.match}% look right now. ${outfit.explanation}`
      : 'Tell me the occasion — university, date, work, travel — and I will build it from your wardrobe.',
    outfit,
    intent: 'chat',
  };
}

function cap(s) {
  return String(s).replace(/\b\w/, (c) => c.toUpperCase());
}

// ------------------------------------------------------------- other tools

/** Heuristic clothing analysis from upload filename + hints. */
function analyzeClothing(input = {}) {
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
    confidence: 0.82 + Math.random() * 0.12,
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
    const counts = values.filter(Boolean).reduce((acc, v) => {
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
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
function packingList(wardrobe = [], trip = {}) {
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

module.exports = {
  calculateCompatibility,
  generateOutfits,
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
