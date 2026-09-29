/**
 * Two-stage wardrobe retrieval (§9 WARDROBE FILTER).
 *
 * The old stylist prompt did `wardrobe.slice(0, 40)` — with a 300-item
 * wardrobe the LLM simply could not see 87% of the user's clothes. Retrieval
 * fixes that properly:
 *
 *   Stage 1 (free, local): score every item against the request, then keep a
 *   category-balanced shortlist so the LLM always sees tops, bottoms, shoes,
 *   outerwear and accessories — never 40 white shirts.
 *
 *   Stage 2 (the LLM): pick from that shortlist.
 *
 * Scoring uses local sentence embeddings from `@xenova/transformers` when they
 * are installed AND the model loads. Both are optional: if the dependency is
 * missing, the model fails to download, or EMBEDDINGS=off, we fall back to a
 * scored lexical matcher that needs nothing at all. Callers never have to care
 * which one is active — `status()` reports it.
 */
'use strict';

const tax = require('./taxonomy');

const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIM = 384;

/** Runtime state — lazily initialised, never required at module load. */
const state = {
  attempted: false,
  ready: false,
  disabled: /^(off|0|false|no)$/i.test(String(process.env.EMBEDDINGS || '')),
  pipeline: null,
  error: null,
  // itemId -> { hash, vector }
  vectors: new Map(),
  // text -> vector
  textCache: new Map(),
};

const TOKEN_RE = /[a-z0-9]+/g;

/** Cheap, stable hash used to invalidate cached vectors when an item changes. */
function fingerprint(item) {
  return tax.normalize(
    `${item.name} ${item.color} ${item.style} ${item.category} ${item.material} ${item.season} ${item.pattern}`,
  );
}

function tokens(text) {
  return tax.normalize(text).match(TOKEN_RE) || [];
}

/** Words that carry no retrieval signal. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'with', 'for', 'to', 'in', 'on', 'at',
  'my', 'me', 'i', 'is', 'it', 'that', 'this', 'wear', 'wearing', 'worn', 'pair',
  'piece', 'item', 'clothes', 'clothing', 'outfit', 'look', 'style', 'something',
  'please', 'can', 'you', 'do', 'have', 'has', 'what', 'should', 'would', 'like',
]);

// ---------------------------------------------------------------- embeddings

async function init() {
  if (state.attempted) return state.ready;
  state.attempted = true;
  if (state.disabled) {
    state.error = 'disabled via EMBEDDINGS=off';
    return false;
  }
  try {
    // Optional dependency — a missing package must never break the server.
    const { pipeline, env } = require('@xenova/transformers');
    if (env?.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
    }
    state.pipeline = await pipeline('feature-extraction', EMBED_MODEL, {
      quantized: true,
    });
    state.ready = true;
  } catch (e) {
    state.ready = false;
    state.error = e.code === 'MODULE_NOT_FOUND'
      ? '@xenova/transformers not installed'
      : String(e.message || e).slice(0, 160);
  }
  return state.ready;
}

/** Fire-and-forget warm-up so the first real request is not the slow one. */
function warmup() {
  return init().catch(() => false);
}

async function embed(text) {
  if (!(await init())) return null;
  const key = String(text);
  if (state.textCache.has(key)) return state.textCache.get(key);
  try {
    const out = await state.pipeline(key, { pooling: 'mean', normalize: true });
    const vec = Array.from(out.data);
    state.textCache.set(key, vec);
    if (state.textCache.size > 500) state.textCache.delete(state.textCache.keys().next().value);
    return vec;
  } catch (e) {
    state.error = String(e.message || e).slice(0, 160);
    return null;
  }
}

/** Embed every wardrobe item, reusing vectors for unchanged items. */
async function embedWardrobe(wardrobe = []) {
  if (!(await init())) return new Map();
  const out = new Map();
  const pending = [];
  for (const item of wardrobe) {
    const hash = fingerprint(item);
    const cached = state.vectors.get(item.id);
    if (cached && cached.hash === hash) {
      out.set(item.id, cached.vector);
      continue;
    }
    pending.push(item);
  }
  for (const item of pending) {
    const vec = await embed(itemText(item));
    if (!vec) continue;
    state.vectors.set(item.id, { hash: fingerprint(item), vector: vec });
    out.set(item.id, vec);
  }
  return out;
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ------------------------------------------------------------------ lexical

/**
 * Scored lexical match. Used alone when embeddings are unavailable, and always
 * blended in with embeddings so exact attributes (a specific colour word) are
 * never lost to a fuzzy vector neighbour.
 */
function lexicalScore(query, item) {
  const qTokens = tokens(query).filter((t) => !STOPWORDS.has(t));
  const fields = {
    name: item.name,
    color: item.color,
    style: item.style,
    category: item.category,
    material: item.material,
    season: item.season,
    pattern: item.pattern,
    brand: item.brand,
  };

  let score = 0;
  let matched = 0;
  for (const t of qTokens) {
    let hit = false;
    for (const [field, value] of Object.entries(fields)) {
      const v = tax.normalize(value);
      if (!v) continue;
      // Weighted field importance: a colour word should not outrank the name.
      const weight = field === 'name' ? 1 : field === 'color' ? 0.85 : 0.6;
      if (v.includes(t)) {
        score += weight;
        hit = true;
      }
    }
    if (hit) matched += 1;
  }

  const coverage = qTokens.length ? matched / qTokens.length : 0;
  return qTokens.length ? score / qTokens.length * 0.5 + coverage * 0.5 : 0;
}

/** Bonus when the query explicitly names a slot the item fills. */
function slotBonus(query, item) {
  const q = tax.normalize(query);
  const slot = tax.slotOf(item);
  if (!slot) return 0;
  const cues = {
    top: ['top', 'shirt', 'tee', 't-shirt', 'blouse', 'sweater', 'knit'],
    bottom: ['bottom', 'pants', 'trousers', 'jeans', 'chinos', 'skirt', 'shorts'],
    shoes: ['shoes', 'sneakers', 'boots', 'loafers', 'heels', 'footwear'],
    outerwear: ['jacket', 'coat', 'blazer', 'outerwear', 'layer'],
    accessory: ['accessory', 'accessories', 'belt', 'scarf', 'watch', 'bag'],
  };
  return (cues[slot] || []).some((c) => q.includes(c)) ? 1 : 0;
}

/** Items matching the requested climate — always worth including. */
function climateBonus(item, weather = {}) {
  return Math.max(0, (tax.weatherScore(item, weather) - 70) / 30);
}

/**
 * Context-affinity bonus: items the request implies but does not name.
 * e.g. "something formal" pulls formal pieces even without the word appearing.
 */
function contextBonus(item, { occasion = '', weather = {} } = {}) {
  let bonus = 0;
  const target = tax.occasionTarget(occasion);
  if (target != null) {
    const level = tax.formalityOf(item);
    bonus += Math.max(0, 1 - Math.abs(level - target) / 5) * 0.6;
  }
  bonus += climateBonus(item, weather) * 0.4;
  return bonus;
}

function itemText(item) {
  return tax.normalize(
    `${item.name || ''} ${item.color || ''} ${item.style || ''} ${item.category || ''} ` +
    `${item.material || ''} ${item.pattern || ''} ${item.season || ''}`,
  );
}

// ------------------------------------------------------------------ ranking

/**
 * Rank the wardrobe against a request.
 *
 * @param {string}   query          what the user asked for
 * @param {object[]} wardrobe
 * @param {object}   opts
 * @param {object}   opts.weather
 * @param {string}   opts.occasion
 * @param {number}   opts.limit     max items to return
 * @param {string[]} opts.slots     restrict to these slots
 * @param {string[]} opts.excludeIds
 * @returns {Promise<Array<{item,score,semantic,lexical,context}>>}
 */
async function rank(query, wardrobe = [], opts = {}) {
  const { weather = {}, occasion = '', limit = 24, slots = null, excludeIds = [] } = opts;
  const excluded = new Set(excludeIds);

  let pool = wardrobe.filter((i) => i && !i.archived && !excluded.has(i.id));
  if (slots && slots.length) pool = pool.filter((i) => slots.includes(tax.slotOf(i)));
  if (!pool.length) return [];

  const [vectors, qvec] = await Promise.all([
    embedWardrobe(pool),
    embed(query).catch(() => null),
  ]);
  const semanticAvailable = !!(qvec && vectors.size);

  const scored = pool.map((item) => {
    const semantic = semanticAvailable ? Math.max(0, cosine(qvec, vectors.get(item.id)) * 0.5 + 0.5) : null;
    const lexical = lexicalScore(query, item);
    const context = contextBonus(item, { occasion, weather });

    let score;
    if (semanticAvailable) {
      // Blend: embeddings understand "something warm for a cold office",
      // lexical nails "navy", context covers what neither can infer.
      score = semantic * 0.45 + lexical * 0.3 + context * 0.15 + slotBonus(query, item) * 0.1;
    } else {
      score = lexical * 0.6 + context * 0.25 + slotBonus(query, item) * 0.15;
    }
    return { item, score: Number(score.toFixed(4)), semantic, lexical, context };
  });

  scored.sort((a, b) => b.score - a.score);
  return balance(scored, limit);
}

/**
 * Category-balanced shortlist.
 *
 * Naive top-N on a wardrobe full of similar pieces returns 24 shirts. So take
 * the best few per slot first, then backfill with global best until the limit
 * is reached. The LLM therefore always sees a complete, varied wardrobe.
 */
function balance(scored, limit) {
  if (scored.length <= limit) return scored;
  const perSlot = new Map();
  const picked = [];
  const taken = new Set();

  // Pass 1: best 5 per slot (or best 2 for slots with few items).
  for (const entry of scored) {
    const slot = tax.slotOf(entry.item);
    if (!slot) continue;
    const seen = perSlot.get(slot) || 0;
    const quota = slot === 'accessory' ? 3 : 5;
    if (seen >= quota || taken.has(entry.item.id)) continue;
    perSlot.set(slot, seen + 1);
    taken.add(entry.item.id);
    picked.push(entry);
  }
  // Pass 2: backfill with the global best of whatever is left.
  for (const entry of scored) {
    if (picked.length >= limit) break;
    if (taken.has(entry.item.id)) continue;
    taken.add(entry.item.id);
    picked.push(entry);
  }
  return picked
    .slice(0, limit)
    .sort((a, b) => b.score - a.score);
}

/**
 * Build the compact catalog text the LLM prompt consumes.
 * Every line carries the item id so the model's chosen ids can be validated.
 */
function catalogLines(results, wardrobe = []) {
  const byId = new Map(wardrobe.map((i) => [i.id, i]));
  return results
    .map(({ item, score }) => {
      const it = item || byId.get(item);
      if (!it) return null;
      return [
        it.id,
        it.name,
        it.category,
        it.color,
        it.style,
        it.formality || '',
        it.material || '',
        `worn ${it.timesWorn || 0}x`,
        `score ${score}`,
      ].filter(Boolean).join(' | ');
    })
    .filter(Boolean)
    .join('\n');
}

/** Startup diagnostics for GET /admin/system-health. */
async function status() {
  await init();
  return {
    embeddings: state.ready,
    model: state.ready ? EMBED_MODEL : null,
    dim: state.ready ? DIM : null,
    cachedVectors: state.vectors.size,
    disabled: state.disabled,
    fallback: state.ready ? null : 'lexical',
    error: state.error,
  };
}

module.exports = {
  rank,
  catalogLines,
  status,
  warmup,
  lexicalScore,
  itemText,
  fingerprint,
};
