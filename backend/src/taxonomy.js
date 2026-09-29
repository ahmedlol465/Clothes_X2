/**
 * Shared fashion taxonomy (§9 CONTEXT ENGINE).
 *
 * One place for colour theory, formality scales, occasion targets, season
 * logic, fabric warmth and category roles. Every scoring / retrieval / vision
 * module imports from here so the vocabulary can never drift between them.
 *
 * Pure data + pure functions. No I/O, no dependencies.
 */
'use strict';

// ------------------------------------------------------------------ colours

/** Ordered hue wheel in degrees. Used for analogous / complementary scoring. */
const HUE = {
  red: 0, burgundy: 350, maroon: 350, rust: 15, orange: 30, mustard: 45,
  yellow: 55, olive: 70, green: 130, emerald: 145, teal: 175, cyan: 185,
  'light blue': 205, blue: 220, navy: 225, indigo: 245, purple: 275,
  violet: 280, magenta: 315, pink: 335, multicolor: null,
};

/** Saturated colours compete with each other; neutrals always sit well. */
const NEUTRAL_COLORS = new Set([
  'white', 'black', 'grey', 'gray', 'beige', 'cream', 'ivory', 'ecru',
  'tan', 'khaki', 'charcoal', 'off-white', 'silver', 'gold', 'brown',
]);

/** Broad family, used by the learning loop and by gap analysis. */
const COLOR_FAMILY = {
  neutral: ['white', 'black', 'grey', 'gray', 'charcoal', 'silver'],
  warm: ['beige', 'cream', 'ivory', 'ecru', 'tan', 'khaki', 'brown', 'camel',
    'rust', 'orange', 'mustard', 'red', 'burgundy', 'maroon', 'gold'],
  cool: ['navy', 'blue', 'indigo', 'teal', 'cyan', 'purple', 'violet',
    'magenta', 'pink', 'green', 'emerald', 'olive'],
  bold: ['multicolor', 'rainbow', 'neon'],
};

function normalize(text) {
  return String(text || '').toLowerCase().trim();
}

/** Every colour word mentioned anywhere in a string ("Navy Blue Shirt"). */
function colorsIn(...parts) {
  const hay = normalize(parts.join(' '));
  const found = new Set();
  for (const key of Object.keys(HUE)) {
    if (key === 'multicolor') continue;
    if (hay.includes(key)) found.add(key);
  }
  // "off white" / "light grey" collapse onto their base colour.
  if (/\boff[-\s]?white\b/.test(hay)) found.add('white');
  if (/\blight\s+grey\b/.test(hay)) found.add('grey');
  if (/\bdark\s+blue\b/.test(hay)) found.add('navy');
  if (/multicolour/.test(hay)) found.add('multicolor');
  return [...found];
}

function isNeutral(color) {
  const c = normalize(color);
  if (NEUTRAL_COLORS.has(c)) return true;
  return COLOR_FAMILY.neutral.some((n) => c === n);
}

/** Family of a single colour word. Defaults to neutral so unknown items are safe. */
function familyOf(color) {
  const c = normalize(color);
  if (c === 'multicolor') return 'bold';
  for (const [family, list] of Object.entries(COLOR_FAMILY)) {
    if (list.some((n) => c === n || c.includes(n))) return family;
  }
  return 'neutral';
}

function hueOf(color) {
  const c = normalize(color);
  if (c === 'multicolor') return null;
  for (const [name, deg] of Object.entries(HUE)) {
    if (name === 'multicolor') continue;
    if (c.includes(name)) return deg;
  }
  return null;
}

/** Shortest signed angular distance between two hues, in degrees (0..180). */
function hueDistance(a, b) {
  if (a == null || b == null) return null;
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Real colour-harmony score for a set of garments.
 *
 * Rewards: monochromatic tone, neutral anchors, analogous schemes, and the
 * classic "one bold piece against neutrals". Penalises: two or more saturated
 * hues fighting for attention, and true clashes (complementary at full chroma).
 */
function colorHarmony(items) {
  const colors = (items || []).map((i) => i.color).filter(Boolean);
  if (colors.length < 2) return 88;

  const families = colors.map(familyOf);
  const neutralCount = families.filter((f) => f === 'neutral').length;
  const saturated = colors.filter((c) => !isNeutral(c) && hueOf(c) != null);
  const hasBold = families.includes('bold') || /multicolor/i.test(colors.join(' '));

  // Monochrome: every colour in the same family.
  if (new Set(families).size === 1) {
    return neutralCount === colors.length ? 94 : 88;
  }

  let score = 82;
  // A neutral anchor is the single biggest harmony win in real styling.
  if (neutralCount >= 1) score += 8;
  if (neutralCount >= 2) score += 3;

  if (saturated.length) {
    const hues = saturated.map(hueOf);
    const dists = [];
    for (let i = 0; i < hues.length; i += 1) {
      for (let j = i + 1; j < hues.length; j += 1) {
        const d = hueDistance(hues[i], hues[j]);
        if (d != null) dists.push(d);
      }
    }
    if (dists.length) {
      const min = Math.min(...dists);
      const max = Math.max(...dists);
      if (min <= 25) score += 8; // analogous — deliberate tonal scheme
      else if (min >= 140) score -= 9; // complementary at full chroma — clash
      if (max > 170) score -= 4;
    }
    // Two or more loud colours need a neutral to sit against.
    if (saturated.length >= 2) score -= neutralCount === 0 ? 12 : 4;
    if (saturated.length >= 3) score -= 6;
  }

  if (hasBold) {
    // A print is fine as the single statement — never alongside another.
    score += neutralCount >= 2 ? 6 : -4;
  }
  return score;
}

// --------------------------------------------------------------- formality

/** Ordinal formality scale. Distance on this scale drives occasion fit. */
const FORMALITY_SCALE = {
  'loungewear': 0, 'sport': 0, 'gym': 0,
  casual: 1,
  'smart casual': 2, 'business casual': 3,
  formal: 4, 'business formal': 4,
  elegant: 5, 'black tie': 6,
};

/**
 * Formality level of a garment, 0..6.
 *
 * A label can legitimately name two levels at once — the seeded Oxford shirt
 * is tagged "Casual / Semi-Formal". Picking whichever token happened to be
 * declared first turned it into a plain Casual, which then created a fake
 * three-level formality spread against the Formal blazer it is meant to sit
 * under and dragged a correct suit outfit down.
 *
 * So: drop tokens subsumed by a longer match ("smart casual" wins over
 * "casual"), and when genuinely distinct levels remain, average them. A
 * hybrid garment sits between the levels it spans.
 */
function formalityOf(item = {}) {
  const hay = normalize(`${item.formality || ''} ${item.style || ''} ${item.occasion || ''}`);
  const matches = Object.entries(FORMALITY_SCALE)
    .filter(([name]) => hay.includes(name))
    .map(([name, level]) => ({ name, level }));

  if (!matches.length) return 2; // unknown → assume smart casual

  // Remove any match whose token appears inside another match's token.
  const maximal = matches.filter(
    (m) => !matches.some((other) => other !== m && other.name.includes(m.name)),
  );
  if (maximal.length === 1) return maximal[0].level;
  return maximal.reduce((a, m) => a + m.level, 0) / maximal.length;
}

/** Target formality level per occasion keyword. */
const OCCASION_FORMALITY = {
  gym: 0, sport: 0, workout: 0, run: 0, beach: 0,
  leisure: 1, weekend: 1, chill: 1, home: 0, pyjama: 0,
  travel: 2, trip: 2, flight: 2, airport: 2, casual: 2,
  university: 2, college: 2, school: 2, lecture: 2, class: 2,
  coffee: 2, brunch: 2, casualfriday: 2,
  meeting: 3, presentation: 3, work: 3, office: 3, business: 3,
  interview: 4, client: 4, dinner: 4, 'date night': 4, date: 4,
  evening: 4, birthday: 4, party: 5, wedding: 6, gala: 6, elegant: 5,
};

/**
 * Target formality for an occasion phrase. Handles multi-word occasions
 * ("formal dinner" → 4, not the 1 that "formal" alone would give).
 */
function occasionTarget(occasion) {
  const q = normalize(occasion);
  let best = null;
  let bestLen = 0;
  for (const [name, level] of Object.entries(OCCASION_FORMALITY)) {
    if (q.includes(name) && name.length > bestLen) {
      best = level;
      bestLen = name.length;
    }
  }
  return best;
}

/** Every occasion the phrase plausibly refers to, most specific first. */
function detectOccasions(phrase) {
  const q = normalize(phrase);
  const hits = [];
  for (const name of Object.keys(OCCASION_FORMALITY)) {
    if (q.includes(name)) hits.push(name);
  }
  // Longer, more specific keywords win (e.g. "date night" over "date").
  return [...new Set(hits)].sort((a, b) => b.length - a.length);
}

/** Occasion fit: 1.0 per level of distance from the target. */
function occasionFit(items, occasion = '') {
  const targets = detectOccasions(occasion);
  const target = occasionTarget(occasion);
  const levels = (items || []).map(formalityOf);
  if (!levels.length) return 80;
  if (target == null) {
    // No occasion stated: only reward internal consistency.
    const spread = Math.max(...levels) - Math.min(...levels);
    return 90 - Math.min(14, spread * 3);
  }
  const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
  const distance = Math.abs(avg - target);
  // Under-dressed reads as sloppy; over-dressed reads as trying too hard.
  const over = avg - target > 0;
  const penalty = distance * (over ? 9 : 11);
  return 92 - penalty - Math.min(10, Math.max(0, (distance - 1) * 4));
}

// ------------------------------------------------------------------ climate

/**
 * Fabric warmth: how much insulation a garment contributes, in "degrees".
 *
 * Evaluated FIRST-MATCH-WINS, garment type before material. The previous
 * table was additive, so a "Wool Blazer" matched both the wool rule and the
 * blazer rule and was charged 19 degrees of insulation — which made a suit
 * unwearable at a mild 24°C and let a set of casual basics outrank a correct
 * formal outfit. Real tailoring is far more wearable than its fibre suggests.
 */
const FABRIC_WARMTH = [
  [/(sherpa|fleece|down|parka|padded|puffer|cashmere|overcoat|greatcoat)/, 14],
  [/(jacket|coat|blazer|bomber|trench|blouson|windbreaker|anorak|peacoat)/, 7],
  [/(sweater|jumper|cardigan|hoodie|sweatshirt|knit|jersey|cable)/, 7],
  [/(corduroy|velvet|flannel|tweed|brocard)/, 6],
  [/(leather|suede|denim|chambray|twill|canvas|corduroy)/, 4],
  [/(wool|cashmere|mohair|merino)/, 9],
  [/(shirt|blouse|oxford|polo|chinos|trouser|chino|slacks)/, 2],
  [/(t-?shirt|tee|tank|camisole|shorts|skirt|dress|blouse)/, 0],
  [/(linen|seersucker|poplin|batiste|mesh|voile)/, -2],
  [/(silk|satin|chiffon)/, -3],
];

/**
 * How well an item copes with a temperature, 0-100.
 * `NakedTemp` is the temperature at which no insulation is wanted.
 */
const NAKED_TEMP = 26;
const WEATHER_SLOPE = 1.1;

function weatherScore(item, weather = {}) {
  const temp = Number(weather.tempC ?? 24);
  const hay = normalize(
    `${item.name || ''} ${item.style || ''} ${item.material || ''} ${item.category || ''}`,
  );
  const fabric = FABRIC_WARMTH.find(([re]) => re.test(hay));
  let warmth = fabric ? fabric[1] : 1;

  // Seasonal labels are the next strongest signal when present.
  const season = normalize(item.season || '');
  if (/winter|fall|aw \/ winter/.test(season)) warmth += 6;
  else if (/spring|summer|ss/.test(season)) warmth -= 4;
  else if (/all season/.test(season)) warmth -= 1;

  // Outerwear covers the torso, so it carries more thermal load than a shirt.
  if (/outerwear/.test(normalize(item.category || ''))) warmth += 2;
  if (/shoe|boot/.test(normalize(item.category || ''))) warmth += 1;

  const distance = Math.abs(warmth - (NAKED_TEMP - temp));
  // Superlinear falloff: a few degrees either way barely matters, but being
  // 18 degrees wrong is genuinely unwearable and must be priced accordingly.
  let score = 96 - distance * WEATHER_SLOPE - Math.max(0, distance - 12) * 0.6;

  const condition = normalize(weather.condition || weather.tags || '');
  // Wet weather is about material durability, not warmth.
  if (/rain|shower|drizzle|storm|snow|wet/.test(condition)) {
    if (/suede|velvet|silk|satin/.test(hay)) score -= 12;
    else if (/sneaker/.test(hay)) score -= 7;
    else if (/leather|loafer|boot/.test(hay)) score -= 5;
    // Only genuinely weatherproof gear earns the bonus — the old blanket "+4"
    // for "not suede" was handing a free pass to a linen blazer in a snowstorm.
    if (/raincoat|windbreaker|parka|anorak|gore-?tex|waterproof|impermeable|puffer|waxed/.test(hay)) score += 8;
  }
  // Bright sun punishes dark heavy wool and rewards open shoes.
  if (/sun|clear|hot/.test(condition) && temp >= 28) {
    if (/black|navy|charcoal/.test(normalize(item.color || '')) && warmth > 9) score -= 8;
    if (/sandal|loafer|flat|espadrille/.test(hay) && /shoe/i.test(normalize(item.category || ''))) score += 5;
  }
  return score;
}

// ------------------------------------------------------------------ season

const SEASONS = {
  winter: ['december', 'january', 'february'],
  spring: ['march', 'april', 'may'],
  summer: ['june', 'july', 'august'],
  autumn: ['september', 'october', 'november'],
};

function seasonOfMonth(month) {
  const i = Number(month) % 12;
  if (i <= 1 || i === 11) return 'winter';
  if (i <= 4) return 'spring';
  if (i <= 7) return 'summer';
  return 'autumn';
}

function seasonScore(item, month) {
  const label = normalize(item.season || '');
  if (!label || /all season|any season|all-season/.test(label)) return 86;
  const current = seasonOfMonth(month);
  if (label.includes(current)) return 96;
  // Adjacent seasons are a mild mismatch, opposite seasons a strong one.
  const order = ['winter', 'spring', 'summer', 'autumn'];
  const distance = Math.abs(order.indexOf(current) - order.indexOf(seasonInLabel(label)));
  return 92 - distance * 14;
}

function seasonInLabel(label) {
  for (const s of Object.keys(SEASONS)) if (label.includes(s)) return s;
  return 'winter';
}

// ---------------------------------------------------------------- categories

/** Slots an outfit should fill, in the order they should be filled. */
const OUTFIT_SLOTS = [
  { slot: 'outerwear', categories: ['Outerwear'], required: false },
  { slot: 'top', categories: ['Tops'], required: true },
  { slot: 'bottom', categories: ['Bottoms'], required: true },
  { slot: 'shoes', categories: ['Shoes'], required: true },
  { slot: 'accessory', categories: ['Accessories'], required: false },
];

/** Which slot does this item fill? Null when the category is unknown. */
function slotOf(item) {
  const cat = normalize(item.category || '');
  const found = OUTFIT_SLOTS.find((s) => s.categories.some((c) => cat.includes(c.toLowerCase())));
  return found ? found.slot : null;
}

/**
 * Identity of a garment, independent of the row it happens to live in.
 *
 * A wardrobe can hold two rows called "White Shirt"; a recommendation that
 * names it once must not produce a matching pair, so every list that could
 * double up is deduped on this rather than on `id`.
 */
function garmentKey(item) {
  return normalize(`${item.name || ''} ${item.color || ''} ${item.category || ''}`).trim();
}

function requiredSlots() {
  return OUTFIT_SLOTS.filter((s) => s.required).map((s) => s.slot);
}

// ------------------------------------------------------------------- trends

/**
 * Lightweight trend priors. Not a scrape — a stable, offline-friendly bias so
 * recommendations feel current without any network dependency.
 */
const TREND_PRIORS = {
  '90s': [/retro|vintage|wide[- ]?leg|flared|denim jacket/i],
  minimal: [/minimal|monochrome|tonal|clean/i],
  quietluxury: [/wool|cashmere|blazer|tailored|loafer/i],
  gorpcore: [/hiking|trail|chunky|technical|gore-tex/i],
  streetwear: [/oversized|hoodie|sneaker|graphic|street/i],
  smartcasual: [/blazer|chinos|polo|oxford|brogue/i],
};

function trendScore(items, occasion) {
  if (!items || !items.length) return 80;
  const hay = items.map((i) => `${i.name || ''} ${i.style || ''} ${i.material || ''}`).join(' ');
  let score = 82;
  const t = occasionTarget(occasion);
  // Polished archetypes suit dressier occasions; streetwear suits the rest.
  if (t != null && t >= 4) {
    if (TREND_PRIORS.quietluxury.some((re) => re.test(hay))) score += 8;
    if (TREND_PRIORS.streetwear.some((re) => re.test(hay))) score -= 6;
  } else if (t != null && t <= 1) {
    if (TREND_PRIORS.streetwear.some((re) => re.test(hay))
      || TREND_PRIORS.gorpcore.some((re) => re.test(hay))) score += 6;
  }
  if (TREND_PRIORS.minimal.some((re) => re.test(hay))) score += 3;
  return Math.min(97, score);
}

module.exports = {
  HUE,
  COLOR_FAMILY,
  NEUTRAL_COLORS,
  FORMALITY_SCALE,
  OCCASION_FORMALITY,
  OUTFIT_SLOTS,
  SEASONS,
  TREND_PRIORS,
  normalize,
  colorsIn,
  isNeutral,
  familyOf,
  hueOf,
  hueDistance,
  colorHarmony,
  formalityOf,
  occasionTarget,
  detectOccasions,
  occasionFit,
  weatherScore,
  seasonScore,
  seasonOfMonth,
  slotOf,
  garmentKey,
  requiredSlots,
  trendScore,
};
