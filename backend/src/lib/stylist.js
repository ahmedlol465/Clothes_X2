/** Helpers used by the AI stylist chat endpoints. */
'use strict';
const ai = require('../services/ai-engine');
const scoring = require('../services/scoring');
const memoryStore = require('../services/style-memory');
const retrieval = require('../services/retrieval');
const tax = require('../services/taxonomy');
const responseContract = require('../services/response-contract');
const { now, db } = require('./context');
const { resolveWeather } = require('./weather');

// ============================================================== 8.3 Wardrobe
const CATEGORIES = ['Tops', 'Bottoms', 'Shoes', 'Outerwear', 'Accessories'];

// ------------------------------------------------------------- stylist core
/**
 * Shared context assembly for every stylist entry point.
 *
 * `ranked` is the retrieval shortlist: retrieval scores the whole wardrobe
 * locally (embeddings when available, lexical scoring otherwise) and returns a
 * category-balanced top slice. The LLM only ever sees these, which is what
 * replaces the old `wardrobe.slice(0, 40)`.
 */
async function stylistContext(user, message = '', opts = {}) {
  const wardrobe = db.wardrobe.filter((i) => !i.archived);
  const memory = memoryStore.read(db, user?.id);
  const weather = opts.weather || (await resolveWeather());
  const occasion = opts.occasion || ai.detectOccasion(message) || 'casual';

  const ranked = await retrieval.rank(message, wardrobe, {
    weather,
    occasion,
    limit: opts.limit || 30,
  });
  return {
    wardrobe,
    shortlist: ranked.map((r) => r.item),
    memory,
    weather,
    occasion,
    styleProfile: user?.styleProfile || {},
    events: db.events || [],
  };
}

/**
 * Recover the items a streamed reply talked about.
 *
 * The streaming path has no structured channel — the model answers in prose —
 * so the pieces it recommended are recovered by matching the ids *or* the
 * garment names it used back to the wardrobe. That keeps the streamed turn as
 * grounded as the non-streamed one, instead of quietly attaching an unrelated
 * generated look to advice about something else.
 */
function idsMentionedIn(text, wardrobe) {
  // Normalise once, but keep it a bare string — a padded copy made every match
  // depend on the word being followed by a space, so "your Leather Loafers,"
  // never matched "leather loafers".
  const haystack = tax.normalize(text).replace(/\s+/g, ' ');
  if (haystack.trim().length < 3) return [];

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const byId = wardrobe.filter((w) => w.id && new RegExp(`\\b${escape(w.id)}\\b`).test(haystack));
  // Longest names first so "Oxford Shirt" wins over "Shirt".
  const byName = wardrobe
    .filter((w) => w.name && w.name.length >= 4)
    .map((w) => ({ w, key: tax.normalize(w.name).trim() }))
    .filter(({ key }) => key && new RegExp(`\\b${escape(key)}\\b`).test(haystack))
    .sort((a, b) => b.w.name.length - a.w.name.length);
  return [...new Set([...byId, ...byName].map(({ w }) => w.id))];
}

/** Phrases worth mining for a durable preference. */
const LEARN_TRIGGER =
  /\b(hate|love|loves|never|always|avoid|prefer|don'?t like|dont like|no more|too (formal|casual|bright|plain|dressy))\b/i;

/**
 * Run the learning loop over a stylist turn.
 *
 * The LLM's `memoryNotes` is a lossy paraphrase of what the user said, so it
 * is an *extra* pass — never a replacement. Learning only from the summary
 * turned "I never wear sneakers" into the far weaker "avoids sneakers", which
 * is an opinion rather than an exclusion.
 */
function learnTurn(memory, message, memoryNotes) {
  const sources = [message, memoryNotes].filter((s) => typeof s === 'string' && s.trim());
  if (!sources.some((s) => LEARN_TRIGGER.test(s))) return false;
  for (const s of sources) memoryStore.learnChat(memory, s);
  return true;
}

/** Turn the LLM's chosen ids into a real, scored outfit. */
function buildOutfitFromIds(ids, ctx, opts = {}) {
  // Dedupe on the garment, not the id: the wardrobe can hold two "White Shirt"
  // rows, and a reply that names it once must not produce a matching pair.
  const picked = [];
  const seen = new Set();
  for (const id of [...new Set(ids || [])]) {
    const item = ctx.wardrobe.find((w) => w.id === id);
    if (!item) continue;
    const key = tax.garmentKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(item);
  }
  const items = picked;
  if (items.length < 2) return null;

  const result = scoring.scoreOutfit(items, {
    occasion: opts.occasion || ctx.occasion,
    weather: ctx.weather,
    styleProfile: ctx.styleProfile,
    memory: ctx.memory,
  });
  const provenance = opts.provenance || responseContract.PROVENANCE.llmIds;
  const itemIds = items.map((p) => p.id);
  return responseContract.normalizeOutfit({
    id: `llm-${Date.now()}`,
    name: ai.outfitName(items, opts.occasion || ctx.occasion),
    occasion: opts.occasion || ctx.occasion,
    match: result.match,
    breakdown: result.breakdown,
    completeness: result.completeness,
    explanation: scoring.explain(items, {
      occasion: opts.occasion || ctx.occasion,
      weather: ctx.weather,
    }, result),
    itemIds,
    pieces: items.map((p) => p.name),
    items,
    image: items[0]?.image,
  }, {
    provenance,
    grounding: {
      recoveredItemIds: itemIds,
      usedFallback: false,
      allOwned: true,
    },
  });
}

/** Server-side conversation recall when the client sends no history. */
function recallTurns(userId, conversationId, limit = 10) {
  const log = db.conversations || [];
  return log
    .filter((t) => t.userId === userId && (!conversationId || t.conversationId === conversationId))
    .slice(-limit)
    .flatMap((t) => ([
      { fromUser: true, text: t.message },
      { fromUser: false, text: t.reply },
    ]));
}

/**
 * Find the most recent turn in this conversation that produced an outfit,
 * returning its itemIds plus the provenance/grounding metadata from that turn.
 * Iterates newest-first so the latest look is always the one remixed.
 */
function findLastOutfitTurn(userId, conversationId) {
  const log = db.conversations || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const t = log[i];
    if ((!userId || t.userId === userId) &&
        (!conversationId || t.conversationId === conversationId) &&
        t.itemIds && t.itemIds.length) {
      return t;
    }
  }
  return null;
}

module.exports = { CATEGORIES, stylistContext, idsMentionedIn, LEARN_TRIGGER, learnTurn, buildOutfitFromIds, recallTurns, findLastOutfitTurn };
