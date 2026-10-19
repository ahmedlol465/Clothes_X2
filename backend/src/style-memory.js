/**
 * Style Memory — the learning loop (§9 USER FEEDBACK → LEARNING).
 *
 * The old implementation bumped one hardcoded `neutral_colors` row by ±0.01 and
 * nothing ever read it back. This module makes learning real:
 *
 *   1. Ratings on outfits move per-attribute preference scores (colour family,
 *      style, formality, fabric), not a single global number.
 *   2. Plain-language chat ("I hate these shoes", "more formal next time") is
 *      mined into the same preference store.
 *   3. Those preferences feed straight back into scoring via `factorWeights()`,
 *      so a user who consistently dislikes bold colours really does stop being
 *      shown bold outfits.
 *   4. Everything is confidence-weighted — one stray tap moves almost nothing;
 *      repeated consistent signals move a lot.
 *
 * Stored per user in the JSON store, so it survives restarts. Pure JS, no deps.
 */
'use strict';

const { familyOf, formalityOf, normalize, colorHarmony } = require('./taxonomy');

/** Learning rate for explicit 1-5 star ratings. */
const RATE_RATING = 0.09;
/** Learning rate for text mined out of chat — deliberately gentler. */
const RATE_CHAT = 0.04;

/** Preference scores never reach a hard 0 or 1: one bad outfit is not a verdict. */
const BOUNDS = { min: 0.02, max: 0.98 };

function clamp01(n) {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Move a preference score, held just short of a hard 0 or 1. */
function bump(current, delta) {
  const next = (typeof current === 'number' ? current : 0.5) + delta;
  return Math.min(BOUNDS.max, Math.max(BOUNDS.min, next));
}

/** A fresh memory record with neutral priors — no opinion about anything yet. */
function empty(userId = 'anonymous') {
  return {
    userId,
    colors: {},
    styles: {},
    occasions: {},
    fabrics: {},
    // Occasions the user has explicitly asked to wear less / more of.
    adjustments: {},
    // Hard exclusions the user has stated in absolute terms ("I never wear
    // sneakers"). Soft preferences average out over several mentions; this
    // does not, so it is kept separately and filtered rather than scored.
    avoid: [],
    facts: [],
    // Per-item rating history: { [itemId]: { rating, at } } — powers item-level
    // user_feedback scoring without re-reading the whole feedback table.
    itemRatings: {},
    totals: { ratings: 0, chats: 0 },
    updatedAt: null,
  };
}

/** Read the stored memory, upgrading older/partial records. */
function read(db, userId) {
  const raw = (db && Array.isArray(db.styleMemories)
    ? db.styleMemories.find((m) => m.userId === userId)
    : null);
  if (!raw) return empty(userId);
  return { ...empty(userId), ...raw, totals: { ...empty().totals, ...(raw.totals || {}) } };
}

function write(db, memory) {
  memory.updatedAt = new Date().toISOString();
  if (!Array.isArray(db.styleMemories)) db.styleMemories = [];
  const idx = db.styleMemories.findIndex((m) => m.userId === memory.userId);
  if (idx >= 0) db.styleMemories[idx] = memory;
  else db.styleMemories.push(memory);
  return memory;
}

// ------------------------------------------------------------------ learning

function keyOf(key) {
  return String(key || '').trim().toLowerCase();
}

/**
 * Learn from an explicit rating on an outfit.
 * `rating` 1-5: 4-5 pulls preferences toward the outfit, 1-3 pushes away.
 */
function learnRating(memory, { items = [], rating = 5 }) {
  const r = clampScore(rating);
  const direction = r >= 4 ? 1 : r <= 2 ? -1 : 0;
  if (!direction) return memory;
  // Confidence in the signal scales with how decisive the rating was.
  const strength = direction > 0 ? (r - 3) / 2 : (3 - r) / 3; // 0..1
  const rate = RATE_RATING * strength;

  for (const item of items) {
    const colorKey = keyOf(familyOf(item.color));
    memory.colors[colorKey] = bump(memory.colors[colorKey], direction * rate);

    const styleKey = keyOf(item.style);
    memory.styles[styleKey] = bump(memory.styles[styleKey], direction * rate);

    const fabricKey = keyOf(item.material);
    memory.fabrics[fabricKey] = bump(memory.fabrics[fabricKey], direction * rate * 0.6);

    if (item.id) {
      const prev = memory.itemRatings[item.id];
      const weight = prev ? 0.6 : 1; // repeat ratings count a little less
      memory.itemRatings[item.id] = {
        rating: prev ? prev.rating * (1 - weight) + r * weight : r,
        at: new Date().toISOString(),
      };
    }
  }
  memory.totals.ratings += 1;
  return memory;
}

/**
 * Signed preference delta one explicit rating carries, per colour/style key.
 * This is the exact quantity `learnRating` adds (fabric moves at 0.6×). Ratings
 * 4–5 are positive, 1–2 negative, 3 neutral, with magnitude scaling by how
 * decisive the rating was — the existing §9 scale, factored out so a *change*
 * of rating can be expressed as one subtraction.
 */
function ratingSignal(rating) {
  const r = clampScore(rating);
  const direction = r >= 4 ? 1 : r <= 2 ? -1 : 0;
  if (!direction) return 0;
  const strength = direction > 0 ? (r - 3) / 2 : (3 - r) / 3; // 0..1
  return direction * RATE_RATING * strength;
}

/**
 * Apply one outfit rating with REPLACE semantics (§ Phase 1).
 *
 * `previous` is the user's prior rating of the *same* outfit (null on the very
 * first rating). The colour/style/fabric maps are moved by
 * `ratingSignal(new) − ratingSignal(previous)`, so changing 5 → 1 nets exactly
 * the effect of a lone 1: the old contribution is removed before the new one is
 * added, never summed. In the unclamped range this is provably identical to
 * learning the current rating on a fresh memory.
 *
 * Per-item ratings are a latest-opinion cache, mirroring "the user's current
 * rating of this look": a decisive (4–5 / 1–2) rating replaces the item's entry,
 * a neutral (3) rating clears it, matching `learnRating`'s "a neutral rating
 * moves nothing" rule.
 *
 * Deliberately separate from `learnRating` (which stays additive for the
 * day-scoped `/outfits/:id/feedback` and favourite events); only the
 * persistence-backed star control goes through here. Returns the mutated memory.
 */
function applyRating(memory, { items = [], rating, previous = null } = {}) {
  if (!memory || typeof memory !== 'object') return memory;
  if (!memory.colors) memory.colors = {};
  if (!memory.styles) memory.styles = {};
  if (!memory.fabrics) memory.fabrics = {};
  if (!memory.itemRatings) memory.itemRatings = {};
  if (!memory.totals) memory.totals = { ratings: 0, chats: 0 };
  if (typeof memory.totals.ratings !== 'number') memory.totals.ratings = 0;

  const next = ratingSignal(rating);
  const prev = previous == null ? 0 : ratingSignal(previous);
  const delta = next - prev;
  const decisive = next !== 0;
  const wasDecisive = prev !== 0;
  const at = new Date().toISOString();

  for (const item of items) {
    if (!item) continue;
    if (delta !== 0) {
      const colorKey = keyOf(familyOf(item.color));
      memory.colors[colorKey] = bump(memory.colors[colorKey], delta);

      const styleKey = keyOf(item.style);
      memory.styles[styleKey] = bump(memory.styles[styleKey], delta);

      const fabricKey = keyOf(item.material);
      memory.fabrics[fabricKey] = bump(memory.fabrics[fabricKey], delta * 0.6);
    }
    if (item.id) {
      if (decisive) memory.itemRatings[item.id] = { rating: clampScore(rating), at };
      else delete memory.itemRatings[item.id];
    }
  }

  // Count decisive ratings only, and count a *change* once: a 1 replacing a 5
  // is still one signal, not two.
  if (decisive && !wasDecisive) memory.totals.ratings += 1;
  else if (!decisive && wasDecisive) memory.totals.ratings = Math.max(0, memory.totals.ratings - 1);

  return memory;
}

const NEGATIVE_PATTERNS = [
  /\b(hate|dislike|don'?t like|do not like|never wear|avoid|no more)\b/i,
  /\b(too|not)\s+(formal|casual|boring|loud|bright|plain|basic|warm|heavy)\b/i,
];
const POSITIVE_PATTERNS = [
  /\b(love|loves|like|great|nice|perfect|obsessed|go-to|favourite|favorite)\b/i,
  /\b(always|usually|only ever|my go-to)\b/i,
];

/** Garment nouns that are opinions in their own right, not colours. */
const ITEM_WORDS =
  'sneakers?|loafers?|boots?|heels?|blazers?|jackets?|jeans?|trousers?|tshirts?|t-?shirts?|shirts?|tops?|coats?|suits?|shorts?|dresses?|shoes?';
const ITEM_SCAN = new RegExp(`\\b(?:${ITEM_WORDS})\\b`, 'gi');
// Non-global twin for `.test()` — the `g` flag makes `test()` stateful, so
// reusing the scan regex as a predicate would skip matches on alternate calls.
const ITEM_TEST = new RegExp(`\\b(?:${ITEM_WORDS})\\b`, 'i');

/** Real hues the scoring layer can reason about. */
const COLOR_WORDS = [
  'black', 'white', 'navy', 'blue', 'beige', 'brown', 'grey', 'gray', 'green',
  'red', 'olive', 'cream', 'denim', 'burgundy', 'khaki', 'tan', 'pink', 'purple',
  'orange', 'yellow', 'maroon', 'teal', 'mustard', 'camel', 'coral', 'rust',
];
const COLOR_SCAN = new RegExp(`\\b(?:${COLOR_WORDS.join('|')})\\b`, 'gi');

/** "colours", "shades", "tones" — a category word on its own, never a hue. */
const COLOR_NOUN = /\bcolou?rs?\b|\bshades?\b|\btones?\b|\bpalettes?\b/i;

/** Adjectives that only mean something in front of a colour noun. */
const COLOR_MOOD =
  'bright|dark|light|pale|bold|loud|neon|pastel|muted|earthy|neutral|monochrome|colourful|colorful|dull|washed';
const COLOR_MOOD_SCAN = new RegExp(`\\b(?:${COLOR_MOOD})\\b`, 'gi');

/** "hate THESE SHOES" / "always wear navy" — what the opinion attaches to. */
const TARGET_PATTERNS = [
  /\b(?:hate|dislike|avoid|never wear|don'?t like)\s+(?:these|those|my|that|the)?\s*([a-z ]{3,40})/i,
  /\b(?:love|loves|like|obsessed with|always wear|usually wear)\s+(?:these|those|my|that|the)?\s*([a-z ]{3,40})/i,
];

/**
 * Split a message into independently-scored clauses.
 *
 * Sentiment has to be judged per clause, not per message. "I always wear navy.
 * I hate bright colours and never wear sneakers" is a single message with a
 * positive and a negative half; scored globally it taught the engine that navy
 * was disliked, which is worse than learning nothing at all.
 */
function clausesOf(text) {
  return String(text)
    .split(/(?<=[.!?;])\s+|\n+|\s*,\s*(?:but|although)\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 2);
}

function sentimentOf(clause) {
  const negative = NEGATIVE_PATTERNS.some((re) => re.test(clause));
  const positive = POSITIVE_PATTERNS.some((re) => re.test(clause));
  if (!negative && !positive) return 0;
  if (negative && positive) return -1; // mixed: keep the conservative read
  return negative ? -1 : 1;
}

/**
 * Reduce a captured phrase to the thing the opinion is actually about.
 * "these bright colours and never wear sneakers" → "bright colours".
 */
function targetPhrase(raw) {
  return String(raw || '')
    .split(/\s+(?:and|but|or|because|so)\s+/i)[0]
    .replace(/\b(?:these|those|my|that|the|really|very|always|usually)\b/gi, ' ')
    .replace(/[\s,.;!?]+/g, ' ')
    .trim();
}

/**
 * Mine a free-text chat message into preferences.
 *
 * Deliberately conservative — it only fires on explicit sentiment, every value
 * it writes is capped so a single rant never dominates the profile, and each
 * clause is judged on its own (see `clausesOf`).
 */
function learnChat(memory, message) {
  const text = String(message || '');
  if (!text.trim()) return memory;

  let learned = 0;
  const parts = clausesOf(text);

  // Formality nudges are requests, not opinions, so they don't need sentiment:
  // "Can you make it more formal next time?" carries no praise or complaint.
  for (const clause of parts) {
    const up = /\b(?:more|dressier)\s+formal|dress\s*(?:it)?\s*up|sharper|smarter|turn\s+it\s+up/i.test(clause);
    const down = /\bless\s+formal|more\s+casual|relaxed|laid[- ]back|toned?\s+down/i.test(clause);
    if (!up && !down) continue;
    const key = up ? 'formal' : 'casual';
    memory.occasions[key] = bump(memory.occasions[key], (up ? 1 : -1) * RATE_CHAT);
    recordFact(memory, up ? 'wants more formal looks' : 'wants more casual looks');
    learned += 1;
  }

  // Absolute exclusions are instructions, not opinions, so they run before the
  // sentiment gate too: "stop showing me linen" carries no praise or complaint.
  for (const clause of parts) {
    const never = clause.match(
      /\b(?:never|don'?t want|do not want|stop|avoid)\b\s*(?:wearing|wear|show(?:ing)?|putting|using)?\s*(?:me\s+)?(?:any\s+)?([a-z][a-z -]{2,30})/i,
    );
    if (!never) continue;
    // "jeans or t-shirts" is two exclusions, not one phrase to be truncated.
    const excluded = never[1]
      .split(/\s+or\s+/i)
      .map((p) => targetPhrase(p))
      .filter((p) => p.length >= 3)
      // "avoid bright colours" is a mood, not a garment — the sentiment pass
      // records it as a fact, and storing it here would exclude nothing.
      .filter((p) => !COLOR_NOUN.test(p) || ITEM_TEST.test(p));
    for (const phrase of excluded) {
      if (memory.avoid.includes(phrase)) continue;
      memory.avoid.unshift(phrase);
      memory.avoid = memory.avoid.slice(0, 10);
      recordFact(memory, `never wears ${phrase}`);
      learned += 1;
    }
  }

  for (const clause of parts) {
    const direction = sentimentOf(clause);
    if (direction === 0) continue;
    const verb = direction > 0 ? 'likes' : 'avoids';
    let fired = false;

    // 1. The noun the sentiment attached to: "hate THESE SHOES", "love that navy".
    let targetSeen = false;
    for (const re of TARGET_PATTERNS) {
      const m = clause.match(re);
      if (!m) continue;
      const phrase = targetPhrase(m[1]);
      if (phrase.length < 3) continue;
      recordFact(memory, `${verb} ${phrase}`);
      targetSeen = true;
      fired = true;
    }

    // 2. Real hues. "I always wear navy" — the exact word and its family move
    //    together (readers match either), and the hue is a colour opinion, never
    //    a style one: "navy" must not leak into `styles` where it is unreadable.
    for (const word of clause.match(COLOR_SCAN) || []) {
      const key = keyOf(word);
      const fam = familyOf(word);
      memory.colors[key] = bump(memory.colors[key], direction * RATE_CHAT * 0.8);
      if (fam && fam !== key) {
        memory.colors[fam] = bump(memory.colors[fam], direction * RATE_CHAT * 0.8);
      }
      fired = true;
    }

    // 3. Garment nouns are style opinions, never colours: "never wear sneakers".
    for (const word of clause.match(ITEM_SCAN) || []) {
      const key = keyOf(word);
      memory.styles[key] = bump(memory.styles[key], direction * RATE_CHAT * 0.7);
      fired = true;
    }

    // 4. "colours are too bright for me" — a mood with no hue behind it.
    if (!targetSeen && COLOR_NOUN.test(clause)) {
      for (const mood of clause.toLowerCase().match(COLOR_MOOD_SCAN) || []) {
        recordFact(memory, `${verb} ${mood} colours`);
        fired = true;
      }
    }

    // 5. A stated "never wear X" is a fact worth surfacing on the DNA card.
    if (/\bnever wear (?:sneakers?|jeans?|t-?shirts?)\b/i.test(clause)) {
      recordFact(memory, 'never wears sneakers on dressy occasions');
      fired = true;
    }

    if (fired) learned += 1;
  }

  if (learned) memory.totals.chats += 1;
  return memory;
}

function recordFact(memory, text) {
  const fact = String(text).slice(0, 120);
  if (memory.facts.some((f) => f.text === fact)) return;
  memory.facts.unshift({ text: fact, at: new Date().toISOString(), confidence: 0.6 });
  memory.facts = memory.facts.slice(0, 20);
}

/** Confidence that this memory has seen enough signal to be trusted. */
function confidence(memory) {
  const n = (memory.totals?.ratings || 0) + (memory.totals?.chats || 0);
  return clamp01(n / 12);
}

// ------------------------------------------------------------------ reading

/** Average preference for a map, 0..1. Falls back to a neutral 0.5. */
function preferenceOf(map = {}, key) {
  const v = map[keyOf(key)];
  return typeof v === 'number' ? clamp01(v) : 0.5;
}

/**
 * Preference for one colour, 0..1.
 *
 * Reads the exact colour word first, then falls back to its family. Chat has
 * historically written raw colour words ("navy"), ratings write family keys
 * ("blue"); both must be honoured, and an exact hit beats the family so a
 * within-family disagreement ("I love navy, hate royal blue") stays visible.
 */
function colorPreference(memory = {}, color) {
  const word = keyOf(color);
  if (word && typeof memory.colors?.[word] === 'number') {
    return clamp01(memory.colors[word]);
  }
  return preferenceOf(memory.colors, familyOf(color));
}

/** Does the memory hold a colour opinion (exact word or family) for this colour? */
function hasColorOpinion(memory = {}, color) {
  const word = keyOf(color);
  if (word && typeof memory.colors?.[word] === 'number') return true;
  const fam = familyOf(color);
  return !!fam && typeof memory.colors?.[fam] === 'number';
}

/**
 * Build a word matcher for a phrase that tolerates plurals, so a stated
 * "t-shirts" still catches the wardrobe row called "White T-Shirt".
 */
function avoidMatcher(phrase) {
  const words = normalize(phrase).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return new RegExp(
    `\\b${words
      .map((w) => {
        const safe = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return /(?:s|es)$/.test(w) && w.length > 3 ? `${safe.slice(0, -1)}s?` : safe;
      })
      .join('\\s+')}\\b`,
  );
}

/**
 * Has the user ruled this item out in absolute terms?
 *
 * "I never wear sneakers" is not a preference to average against other signals
 * — it is an exclusion, so it is checked as a word match against the garment's
 * own description rather than as a score.
 */
function isAvoided(memory, item = {}) {
  const avoid = memory.avoid || [];
  if (!avoid.length) return false;
  const text = normalize(
    `${item.name || ''} ${item.style || ''} ${item.color || ''} ${item.material || ''}`,
  );
  return avoid.some((phrase) => {
    const p = normalize(phrase).trim();
    if (!p) return false;
    if (p.includes(' ')) return text.includes(p);
    const re = avoidMatcher(p);
    return !!re && re.test(text);
  });
}

/** Drop avoided items, unless that would leave nothing to work with. */
function withoutAvoided(memory, items = []) {
  const kept = items.filter((i) => !isAvoided(memory, i));
  return kept.length ? kept : items;
}

/**
 * Agreement between a stated formality lean and one item, 0..1.
 * Stays at a neutral 0.5 until the user has actually asked for more or less
 * formal looks, so it can't tilt outfits for someone who never said anything.
 */
function formalityAffinity(memory, item = {}) {
  const lean = memory.occasions?.formal;
  if (typeof lean !== 'number' || Math.abs(lean - 0.5) < 0.02) return 0.5;
  const stated = (lean - 0.5) * 2; // -1 "more casual" .. +1 "more formal"
  const level = ((formalityOf(item) ?? 3) - 3) / 3; // 0..6 centred on business casual
  return clamp01(0.5 + stated * level * 0.5);
}

/** Has the user actually stated a formality lean worth scoring against? */
function hasFormalityOpinion(memory = {}) {
  const lean = memory.occasions?.formal;
  return typeof lean === 'number' && Math.abs(lean - 0.5) > 0.02;
}

/**
 * Does this memory hold an opinion that actually applies to this item?
 *
 * A stored preference only moves the score when it matches something concrete
 * in the item: its rated id, an exact/family colour it shares, its style, its
 * fabric, or a stated formality lean. A memory full of "navy" opinions must
 * not nudge an all-beige outfit — the learned-affinity component falls out and
 * its weight is renormalised over the components that did speak.
 */
function hasOpinionFor(memory, item = {}) {
  if (!memory) return false;
  if (item.id && memory.itemRatings?.[item.id]) return true;
  const word = keyOf(item.color);
  if (word && typeof memory.colors?.[word] === 'number') return true;
  const fam = familyOf(item.color);
  if (fam && typeof memory.colors?.[fam] === 'number') return true;
  const style = keyOf(item.style);
  if (style && typeof memory.styles?.[style] === 'number') return true;
  const fabric = keyOf(item.material);
  if (fabric && typeof memory.fabrics?.[fabric] === 'number') return true;
  const lean = memory.occasions?.formal;
  return typeof lean === 'number' && Math.abs(lean - 0.5) > 0.02;
}

/**
 * How much the user likes an item overall, 0..1.
 *
 * Blends only the colour, style, fabric and formality opinions the item
 * actually carries. The old version always averaged all four sub-signals and
 * defaulted every missing one to 0.5, so a single strong opinion was diluted
 * back toward the middle and every item drifted to ~50. With no relevant
 * opinion at all the item stays neutral at 0.5 — the caller decides whether to
 * count it (see `hasOpinionFor`).
 */
function itemAffinity(memory, item = {}) {
  const parts = [];

  if (hasColorOpinion(memory, item.color)) {
    parts.push(colorPreference(memory, item.color));
  }
  const styleKey = keyOf(item.style);
  if (styleKey && typeof memory?.styles?.[styleKey] === 'number') {
    parts.push(preferenceOf(memory.styles, item.style));
  }
  const fabricKey = keyOf(item.material);
  if (fabricKey && typeof memory?.fabrics?.[fabricKey] === 'number') {
    parts.push(preferenceOf(memory.fabrics, item.material));
  }
  if (hasFormalityOpinion(memory)) {
    parts.push(formalityAffinity(memory, item));
  }

  if (!parts.length) return 0.5;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/**
 * Adjusted factor weights.
 *
 * Base weights come from the spec's 11-factor table. Two things move them:
 *   • USER_FEEDBACK gains weight the more ratings we have.
 *   • PERSONAL_PREFERENCE gains weight the more opinions we have mined.
 * The mass is taken from the purely-static factors (trend, availability) so
 * the weights always sum to 1.
 */
function factorWeights(memory, base = {}) {
  const conf = confidence(memory);
  const opinions = Object.keys(memory.colors || {}).length + Object.keys(memory.styles || {}).length;

  const w = { ...base };
  const feedbackBoost = Math.min(0.09, 0.03 + (memory.totals?.ratings || 0) * 0.012 + (memory.totals?.chats || 0) * 0.004);
  const prefBoost = Math.min(0.07, opinions * 0.008 + conf * 0.02);

  w.user_feedback = (w.user_feedback || 0.03) + feedbackBoost;
  w.personal_preference = (w.personal_preference || 0.14) + prefBoost;
  // Donors: the two factors with the least user-specific signal.
  const donate = (w.trend_compatibility || 0.03) * 0.5 + (w.wardrobe_availability || 0.05) * 0.5;
  w.trend_compatibility = (w.trend_compatibility || 0.03) - donate * 0.5;
  w.wardrobe_availability = (w.wardrobe_availability || 0.05) - donate * 0.5;
  return w;
}

/**
 * Per-item feedback score, 0..100 — how well past ratings match this outfit.
 *
 * Reports `hasSignal: false` when nothing here has been rated, so the scoring
 * layer can exclude it from the weighted mean instead of injecting a constant.
 */
function feedbackScore(memory, items = []) {
  const rated = items.map((i) => memory.itemRatings?.[i.id]).filter(Boolean);
  if (!rated.length) return { value: 75, hasSignal: false };
  const avg = rated.reduce((a, r) => a + (r.rating || 3), 0) / rated.length;
  // Rescale 1..5 onto 20..100 so it behaves like the other factors.
  return { value: 20 + ((avg - 1) / 4) * 80, hasSignal: true };
}

/** Compact natural-language digest injected into the stylist prompt. */
function digest(memory) {
  const lines = [];
  const top = (map, n) =>
    Object.entries(map)
      .filter(([, v]) => typeof v === 'number' && Math.abs(v - 0.5) > 0.05)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${k} ${v > 0.6 ? '✓' : '✗'}`);

  const liked = top(memory.colors, 4).filter((s) => s.endsWith('✓'));
  const disliked = top(memory.colors, 3).filter((s) => s.endsWith('✗'));
  const styles = top(memory.styles, 3).filter((s) => s.endsWith('✓'));
  if (liked.length) lines.push(`Likes: ${liked.map((s) => s.slice(0, -2)).join(', ')}`);
  if (disliked.length) lines.push(`Dislikes: ${disliked.map((s) => s.slice(0, -2)).join(', ')}`);
  if (styles.length) lines.push(`Favoured styles: ${styles.map((s) => s.slice(0, -2)).join(', ')}`);
  const lean = memory.occasions?.formal;
  if (typeof lean === 'number' && Math.abs(lean - 0.5) > 0.05) {
    lines.push(`Formality: ${lean > 0.5 ? 'leans dressier' : 'leans more relaxed'} than default`);
  }
  if (memory.facts?.length) lines.push(`Notes: ${memory.facts.slice(0, 4).map((f) => f.text).join('; ')}`);
  if (memory.avoid?.length) lines.push(`Never wears: ${memory.avoid.slice(0, 3).join(', ')}`);
  lines.push(`Confidence: ${Math.round(confidence(memory) * 100)}% from ${memory.totals.ratings} ratings, ${memory.totals.chats} chat signals`);
  return lines.join('\n') || 'No learned preferences yet.';
}

/**
 * "Style DNA" — the card the insights screen renders.
 *
 * Values are a blend of what the wardrobe actually contains and what the
 * learning loop believes, so the card is meaningful before a single rating is
 * given and gets sharper as feedback arrives.
 */
function styleDna(memory, wardrobe = []) {
  const FREQ = 0.45; // how much raw wardrobe composition matters vs. opinion

  /** Blend wardrobe frequency with learned opinion, then normalise to %. */
  const blend = (counts, prefMap) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const scored = Object.entries(counts).map(([label, count]) => {
      const freq = count / total;
      const opinion = preferenceOf(prefMap, label);
      // Opinion is centred at 0.5, so a neutral user keeps the wardrobe shape.
      const opinionSignal = (opinion - 0.5) * 2 * (1 - FREQ);
      return { label, value: Math.max(0, FREQ * freq + opinionSignal), raw: Number(opinion.toFixed(3)) };
    });
    const sum = scored.reduce((a, s) => a + s.value, 0) || 1;
    return scored
      .map((s) => ({ label: s.label, value: Math.round((s.value / sum) * 100), raw: s.raw }))
      .sort((a, b) => b.value - a.value);
  };

  const tally = (values) =>
    values.filter(Boolean).reduce((acc, v) => {
      const k = String(v).trim();
      if (k) acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

  const colorCounts = tally(wardrobe.map((i) => i.color));
  const styleCounts = tally(wardrobe.map((i) => i.style));

  // Aggregate families make the palette card readable next to the raw hexes.
  const familyCounts = {};
  for (const [color, count] of Object.entries(colorCounts)) {
    const fam = familyOf(color);
    familyCounts[fam] = (familyCounts[fam] || 0) + count;
  }

  const FORMALITY_LABELS = ['Loungewear', 'Casual', 'Smart Casual', 'Business Casual', 'Formal', 'Elegant', 'Black Tie'];
  const levelCounts = {};
  for (const item of wardrobe) {
    const level = formalityOf(item);
    const label = FORMALITY_LABELS[level];
    levelCounts[label] = (levelCounts[label] || 0) + 1;
  }

  const harmony = wardrobe.length >= 2 ? Math.round(colorHarmony(wardrobe.slice(0, 6))) : 80;

  return {
    confidence: Number(confidence(memory).toFixed(2)),
    palette: blend(familyCounts, memory.colors),
    paletteDetail: blend(colorCounts, memory.colors),
    styles: blend(styleCounts, memory.styles),
    formalitySpread: Object.entries(levelCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        label,
        value: Math.round((count / Math.max(1, wardrobe.length)) * 100),
      })),
    paletteHarmony: harmony,
    notes: (memory.facts || []).slice(0, 6).map((f) => f.text),
    ratings: memory.totals.ratings,
    signals: memory.totals.chats,
    updatedAt: memory.updatedAt,
  };
}

/** Convenience: learn from a chat turn and return the persisted memory. */
function record(db, userId, { rating, items, message } = {}) {
  const memory = read(db, userId);
  if (rating != null) learnRating(memory, { items, rating });
  if (message) learnChat(memory, message);
  return write(db, memory);
}

module.exports = {
  empty,
  read,
  write,
  learnRating,
  applyRating,
  ratingSignal,
  learnChat,
  confidence,
  itemAffinity,
  colorPreference,
  hasOpinionFor,
  formalityAffinity,
  isAvoided,
  withoutAvoided,
  factorWeights,
  feedbackScore,
  digest,
  styleDna,
  record,
  clampScore,
};
