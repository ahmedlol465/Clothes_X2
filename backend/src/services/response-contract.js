/**
 * Unified AI Stylist response contract helpers (Session 3).
 *
 * One place owns:
 *   - wardrobe id validation (owned + garment-deduped),
 *   - outfit normalization (canonical fields, completeness, provenance),
 *   - structured memory facets,
 *   - turn metadata (`meta` / contractVersion 2).
 *
 * Both `/ai/chat` and `/ai/chat/stream` call these helpers so the two paths
 * cannot drift apart again. The design document is
 * `AI_RESPONSE_CONTRACT_DESIGN.md` (§D, §B.3, §B.4).
 */
'use strict';

const crypto = require('crypto');
const tax = require('./taxonomy');
const memoryStore = require('./style-memory');

const CONTRACT_VERSION = 2;

const PROVENANCE = Object.freeze({
  llmIds: 'llm_ids',
  recovered: 'recovered_from_reply',
  generatedFallback: 'generated_fallback',
  ruleFallback: 'rule_fallback',
  generated: 'generated',
  match: 'match',
  remix: 'remix',
});

function asStringArray(value) {
  return Array.isArray(value) ? value.map(String).filter((s) => s.length) : [];
}

function clamp01(n) {
  const num = Number(n);
  return Math.min(1, Math.max(0, Number.isFinite(num) ? num : 0));
}

function asInt(n, fallback = 0) {
  const num = Number(n);
  return Number.isFinite(num) ? Math.round(num) : fallback;
}

function normalizeArabic(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

const ARABIC_CATEGORIES = [
  [/(شوز|حذاء|احذيه|جزمت|جزامه|بوت|sneaker|shoe|boot)/, 'shoes'],
  [/(توب|قميص|تيشيرت|تي شيرت|بلوز|كنزه|سويتر|هودي|shirt|tee|top)/, 'top'],
  [/(جاكيت|بلازر|معطف|بالطو|outerwear|jacket|blazer|coat)/, 'outerwear'],
  [/(بنطال|بنطلون|جينز|سروال|pant|jean|bottom)/, 'bottom'],
  [/(تنوره|فستان|skirt|dress)/, 'dress'],
  [/(جورب|sock)/, 'socks'],
];

const CATEGORY_LABELS = {
  en: {
    shoes: 'shoes',
    top: 'top',
    outerwear: 'jacket',
    bottom: 'bottoms',
    dress: 'dress',
    socks: 'socks',
    item: 'item',
  },
  ar: {
    shoes: 'الحذاء',
    top: 'القطعة العلوية',
    outerwear: 'الجاكيت',
    bottom: 'الجزء السفلي',
    dress: 'الفستان',
    socks: 'الجوارب',
    item: 'القطعة',
  },
  'ar-EG': {
    shoes: 'الشوز',
    top: 'التوب',
    outerwear: 'الجاكيت',
    bottom: 'البنطلون',
    dress: 'الفستان',
    socks: 'الجوارب',
    item: 'القطعة',
  },
};

function isArabicLanguage(lang) {
  return lang === 'ar' || lang === 'ar-EG';
}

function localizedText(lang, en, ar, arEg) {
  if (lang === 'ar-EG') return arEg || ar || en;
  if (lang === 'ar') return ar || en;
  return en;
}

function categoryLabel(lang, category) {
  const labels = CATEGORY_LABELS[lang] || CATEGORY_LABELS.en;
  const aliases = {
    jacket: 'outerwear',
    blazer: 'outerwear',
    coat: 'outerwear',
    shirt: 'top',
    tee: 'top',
    pants: 'bottom',
    jeans: 'bottom',
    sneakers: 'shoes',
    boots: 'shoes',
    loafers: 'shoes',
  };
  const normalized = aliases[category] || category;
  return labels[normalized] || labels.item;
}

function editFollowUp(lang, category = 'item') {
  const label = categoryLabel(lang, category);
  return localizedText(
    lang,
    `Swapped the ${label} — kept the rest of the look.`,
    `تم استبدال ${label} مع الإبقاء على بقية الإطلالة.`,
    `بدّلت ${label} وخليت باقي اللوك زي ما هو.`,
  );
}

function ambiguousFollowUp(lang) {
  return localizedText(
    lang,
    "I'm not sure which look you mean — here's a fresh suggestion. Tell me what to change.",
    'لست متأكدًا من الإطلالة التي تقصدها — إليك اقتراحًا جديدًا. أخبرني بما تريد تغييره.',
    'مش فاهم قصدك أي لوك — ده اقتراح جديد. قولي أغير إيه.',
  );
}

function suggestionsForTurn({ intent = 'chat', hasOutfit = false, lang = 'en' } = {}) {
  if (isArabicLanguage(lang)) {
    const eg = lang === 'ar-EG';
    if (intent === 'modify_item') {
      return eg
        ? ['خليه أدفى', 'جرّب لون تاني', 'بدّل حاجة تانية']
        : ['اجعلها أكثر دفئًا', 'جرّب لونًا آخر', 'بدّل قطعة أخرى'];
    }
    if (intent === 'modify_outfit') {
      return eg
        ? ['خليه كاجوال أكتر', 'خليه للسهرة', 'بدّل الشوز']
        : ['اجعلها أكثر عفوية', 'اجعلها مناسبة للسهرة', 'بدّل الحذاء'];
    }
    if (intent === 'explain' || intent === 'opinion') {
      return eg
        ? ['اعمل نسخة تانية', 'خليه أهدى', 'قارن بلوك تاني']
        : ['أنشئ نسخة أخرى', 'اجعلها أكثر هدوءًا', 'قارنها بإطلالة أخرى'];
    }
    if (!hasOutfit) {
      return eg
        ? ['اعمل لوك للنهار', 'اقترح حاجات ناقصني', 'أيه الألوان اللي تليق؟']
        : ['ابنِ إطلالة اليوم', 'اقترح قطعًا ناقصة', 'ما الألوان المناسبة؟'];
    }
    return eg
      ? ['خليه رسمي أكتر', 'بدّل الشوز', 'إيه الألوان اللي بتتصلح؟']
      : ['اجعلها أكثر رسمية', 'بدّل الحذاء', 'ما الألوان المتناسقة؟'];
  }
  if (intent === 'modify_item') {
    return ['Make it warmer', 'Try another color', 'Change another piece'];
  }
  if (intent === 'modify_outfit') {
    return ['Make it more casual', 'Make it date-ready', 'Swap the shoes'];
  }
  if (intent === 'explain' || intent === 'opinion') {
    return ['Show another option', 'Make it more toned down', 'Compare with another look'];
  }
  if (!hasOutfit) {
    return ['Build today’s outfit', 'Suggest pieces I’m missing', 'Which colors work together?'];
  }
  return ['Make it more formal', 'Swap the shoes', 'Which colors work together?'];
}

function newRequestId() {
  return `req_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Filter proposed wardrobe ids to the live wardrobe and dedupe by garment.
 *
 * Mirrors the dedupe rule already used by `buildOutfitFromIds`/`remixOutfit`:
 * the wardrobe can hold two rows of the same garment, and one mention must not
 * produce a matching pair.
 *
 * @returns {{requested:string[], valid:string[], dropped:string[]}}
 */
function validateItemIds(ids, wardrobe = []) {
  const requested = [...new Set(asStringArray(ids))];
  const live = (Array.isArray(wardrobe) ? wardrobe : []).filter((i) => i && !i.archived);
  const byId = new Map(live.map((item) => [item.id, item]));

  const valid = [];
  const seen = new Set();
  for (const id of requested) {
    const item = byId.get(id);
    if (!item) continue;
    const key = tax.garmentKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(id);
  }
  const validSet = new Set(valid);
  return {
    requested,
    valid,
    dropped: requested.filter((id) => !validSet.has(id)),
  };
}

/** Detailed completeness gate derived from the outfit's own garments. */
function completenessFromItems(items = []) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const required = tax.requiredSlots();
  if (!required.length) return null;
  const slots = new Set(list.map(tax.slotOf).filter(Boolean));
  const filled = required.filter((slot) => slots.has(slot)).length;
  return {
    ratio: Number((filled / required.length).toFixed(2)),
    filled,
    required: required.length,
  };
}

function normaliseDetail(value) {
  if (!value || typeof value !== 'object') return null;
  const ratio = Number(value.ratio);
  if (!Number.isFinite(ratio)) return null;
  return {
    ratio: Number(ratio.toFixed(2)),
    filled: Number.isFinite(Number(value.filled)) ? asInt(value.filled) : 0,
    required: Number.isFinite(Number(value.required)) ? asInt(value.required) : 0,
  };
}

/**
 * Resolve the public `completeness` number plus the additive detail object.
 *
 * Older producers send `{ratio,filled,required}` here. The Flutter model casts
 * it as a number, so the public field is normalized and the original object is
 * preserved additively as `completenessDetail` (§D.4).
 */
function resolveCompleteness(outfit = {}) {
  const raw = outfit.completeness;
  const fromObject = normaliseDetail(raw);
  const computed = fromObject || completenessFromItems(outfit.items);

  let ratio = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) ratio = clamp01(raw);
  else if (fromObject) ratio = clamp01(fromObject.ratio);
  else if (computed) ratio = clamp01(computed.ratio);

  return { ratio, detail: computed };
}

function defaultGrounding(itemIds, provenance) {
  const recovered = [
    PROVENANCE.llmIds,
    PROVENANCE.recovered,
    PROVENANCE.match,
    PROVENANCE.remix,
    PROVENANCE.ruleFallback,
  ].includes(provenance);
  return {
    recoveredItemIds: recovered ? [...itemIds] : [],
    usedFallback: false,
    allOwned: true,
  };
}

/**
 * Canonicalise one outfit from any producer (§D.1/D.2).
 *
 * Legacy fields are preserved verbatim; additive fields are filled in. The
 * input is never mutated.
 */
function normalizeOutfit(outfit, opts = {}) {
  if (!outfit || typeof outfit !== 'object') return null;

  const items = Array.isArray(outfit.items) ? outfit.items : [];
  const itemIds = Array.isArray(outfit.itemIds)
    ? asStringArray(outfit.itemIds)
    : items.map((i) => i && i.id).filter(Boolean).map(String);
  const pieces = Array.isArray(outfit.pieces)
    ? asStringArray(outfit.pieces)
    : items.map((i) => i && i.name).filter(Boolean).map(String);

  const match = asInt(outfit.match, asInt(outfit.compatibilityScore, 0));
  const compatibilityScore = outfit.compatibilityScore != null
    ? asInt(outfit.compatibilityScore, match)
    : match;
  const rankingScore = outfit.rankingScore != null ? asInt(outfit.rankingScore, 0) : null;

  const completeness = resolveCompleteness({ ...outfit, items });

  const provenance = opts.provenance || outfit.provenance || PROVENANCE.generated;
  const groundingInput = opts.grounding || outfit.grounding || defaultGrounding(itemIds, provenance);
  const grounding = {
    recoveredItemIds: asStringArray(groundingInput.recoveredItemIds || []),
    usedFallback: groundingInput.usedFallback === true,
    allOwned: groundingInput.allOwned !== false,
  };

  const occasion = outfit.occasion != null
    ? String(outfit.occasion)
    : (opts.occasion != null ? String(opts.occasion) : undefined);

  return {
    ...outfit,
    id: outfit.id != null ? String(outfit.id) : '',
    name: outfit.name != null ? String(outfit.name) : 'Untitled look',
    ...(occasion !== undefined ? { occasion } : {}),
    match,
    compatibilityScore,
    rankingScore,
    breakdown: Array.isArray(outfit.breakdown) ? outfit.breakdown : [],
    // Full factor detail carried alongside breakdown so every consumer (not
    // just Flutter's fromJson re-derivation) can see weight, applied and
    // contribution for each factor without re-parsing breakdown.
    factors: Array.isArray(outfit.breakdown)
      ? outfit.breakdown.map((b) => ({
          label: b.label,
          value: Number(b.value ?? 0),
          weight: Number(b.weight ?? 0),
          applied: b.applied === true,
        }))
      : [],
    explanation: outfit.explanation != null ? String(outfit.explanation) : '',
    itemIds,
    pieces,
    items,
    ...(outfit.image != null
      ? { image: String(outfit.image) }
      : (items[0] && items[0].image ? { image: String(items[0].image) } : {})),
    completeness: completeness.ratio,
    completenessDetail: completeness.detail,
    provenance,
    grounding,
  };
}

/**
 * Structured taste summary (§B.3).
 *
 * `prefers`/`dislikes`/`notes` deliberately match the keys
 * `AppState._describeDna` already reads. `digest` stays a string elsewhere.
 */
function memoryFacets(memory) {
  const mem = memory || {};
  const numeric = (map) => Object.entries(map && typeof map === 'object' ? map : {})
    .filter(([, v]) => typeof v === 'number');

  const likes = numeric(mem.colors)
    .filter(([, v]) => v > 0.6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k);
  const dislikes = numeric(mem.colors)
    .filter(([, v]) => v < 0.4)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([k]) => k);
  const favouredStyles = numeric(mem.styles)
    .filter(([, v]) => v > 0.6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  const lean = mem.occasions?.formal;
  const formalityLean = typeof lean === 'number' && Math.abs(lean - 0.5) > 0.05
    ? (lean > 0.5 ? 'dressier' : 'relaxed')
    : null;

  const notes = (Array.isArray(mem.facts) ? mem.facts : [])
    .map((f) => (f && typeof f === 'object' ? f.text : f))
    .filter(Boolean)
    .slice(0, 6)
    .map(String);

  return {
    prefers: likes,
    dislikes,
    favouredStyles,
    formalityLean,
    avoid: asStringArray(mem.avoid).slice(0, 6),
    notes,
    confidence: memoryStore.confidence(mem),
    totals: {
      ratings: asInt(mem.totals?.ratings),
      chats: asInt(mem.totals?.chats),
    },
  };
}

/**
 * Processing metadata for one turn (§B.4).
 *
 * Pass `requestId`/`generatedAt` from the route so the early `meta` event and
 * the final `done` envelope share the same values.
 */
function baseMeta(opts = {}) {
  const validation = opts.itemIdValidation || {};
  const requested = asStringArray(validation.requested);
  const valid = asStringArray(validation.valid);
  const dropped = Array.isArray(validation.dropped)
    ? asStringArray(validation.dropped)
    : requested.filter((id) => !valid.includes(id));

  return {
    contractVersion: CONTRACT_VERSION,
    requestId: opts.requestId || newRequestId(),
    generatedAt: opts.generatedAt || new Date().toISOString(),
    engine: String(opts.engine || 'rules'),
    degraded: opts.degraded === true,
    language: opts.language || 'en',
    itemIdValidation: { requested, valid, dropped },
  };
}

/**
 * Deterministic intent classifier for the streaming path (no annotation call).
 * Open question §H.3 allows a rules-derived stream intent.
 *
 * Returns one of:
 *   'explain'     user wants to know why an outfit works
 *   'opinion'     user wants a rating or critique
 *   'modify_item' user wants to change a single item (e.g. "change the shoes")
 *   'modify_outfit' user wants to modify the previous outfit as a whole (e.g. "remix", "make it formal")
 *   'correction'  user is rejecting or correcting a previous suggestion
 *   'new_outfit'  user wants a brand-new look
 *   'learn'       user is stating a durable preference
 *   'ambiguous'   user references something ("that", "it") without clear action
 *   'chat'        general conversation
 */
function inferIntent(message = '') {
  const q = String(message || '').toLowerCase();
  const ar = normalizeArabic(message);

  if (/\b(why|explain|how does|reason|what makes)\b/.test(q)
      || /(^|\s)(ليه|ليش|لماذا|ازاي|إزاي|كيف|السبب|اشرح|شرح)(\s|$)|بتناسب/.test(ar)) {
    return 'explain';
  }
  if (/\b(what do you think|thoughts|opinion|rate|suit me)\b/.test(q)
      || /(رايك|رأيك|تقييم|قيّم|قيم|تقيم|يناسبني|تحكم)/.test(ar)) {
    return 'opinion';
  }

  if (detectSingleItemChange(message)) return 'modify_item';

  if (/\b(remix|something else|dress (it )?up|sharper)\b/.test(q)
      || /\b(less formal|more casual|casual version|relaxed|laid ?back|toned down|more formal|dress up|business|smarter)\b/.test(q)
      || /(بدل|بدّل|غير|غيّر|استبدل|خلي|حوّل)/.test(ar)
        && /(كاجوال|رسمي|شيك|دافي|صيفي|سهرة|عمل|مقابلة|مريح|فضفاض|لوك|اطلاله|إطلالة)/.test(ar)) {
    return 'modify_outfit';
  }

  if (/\b(hate|don'?t like|dont like|never wear|reject|do not like|dislike|not these)\b/.test(q)
      || /(مش عاجبني|ما عجبنيش|كرهت|لا أحب|ما أحبش|مش بحب|لا أرتدي|ما بلبسش|خطأ|غلط|غير مناسب)/.test(ar)) {
    return 'correction';
  }

  if (/\b(outfit|wear|dress me|suggest|recommend|build|look|what should|something for)\b/.test(q)
      || /(اعمل|ابني|جهز|اقترح|دلني|أريد|عايز|محتاج|ابعتلي|وريني|outfit|اطلاله|إطلالة|لوك|ملابس|لبس)/.test(ar)) {
    return 'new_outfit';
  }

  if (/\b(prefer|avoid|love|only wear)\b/.test(q)
      || /(أفضّل|افضل|بحب|أحب|أكره|اكره|اتجنب|أتجنب|دائما|دايما)/.test(ar)) {
    return 'learn';
  }

  if (/\b(that|it|this|the one|previous|last)\b/.test(q)
      || /(ده|دي|ذلك|السابق|اللي فات|الاخير|الأخير)/.test(ar)) {
    return 'ambiguous';
  }

  return 'chat';
}

function detectSingleItemChange(message = '') {
  const q = String(message || '').toLowerCase();
  const match = q.match(/\b(change|swap|replace|different|switch)\b\s+(the\s+)?(shoes?|sneakers?|boots?|loafers?|top|shirt|tee|jacket|blazer|pants?|jeans?|bottom|outerwear|coat|dress|skirt|socks?)\b/);
  if (match) return match[match.length - 1];

  const ar = normalizeArabic(message);
  const wantsChange = /(بدل|بدّل|غيّر|غير|استبدل|خلي|حوّل|اجعل)/.test(ar);
  if (!wantsChange) return null;
  for (const [pattern, category] of ARABIC_CATEGORIES) {
    if (pattern.test(ar)) return category;
  }
  return null;
}

function emptyConstraints() {
  return { colors: [], styles: [], avoid: [] };
}

module.exports = {
  CONTRACT_VERSION,
  PROVENANCE,
  newRequestId,
  validateItemIds,
  completenessFromItems,
  normalizeOutfit,
  memoryFacets,
  baseMeta,
  inferIntent,
  detectSingleItemChange,
  emptyConstraints,
  normalizeArabic,
  ARABIC_CATEGORIES,
  isArabicLanguage,
  categoryLabel,
  editFollowUp,
  ambiguousFollowUp,
  suggestionsForTurn,
};
