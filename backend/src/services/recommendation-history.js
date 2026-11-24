/**
 * Recommendation history + feedback events — §4 FEEDBACK, LEARNING &
 * RECOMMENDATION HISTORY.
 *
 * This module adds the *data* the Recommendation Engine (§3) was deliberately
 * built without: what was recommended, when, to whom — and an idempotent place
 * to attach the user's answer to it. It does not rank anything, it does not
 * score anything, and it does not re-implement learning: every signal is pushed
 * through the existing `style-memory.js` path (`memoryStore.record`), which is
 * the same path `POST /outfits/:id/feedback` has always used.
 *
 * WHAT WAS MISSING IN THE EXPRESS RUNTIME (§1/§2 audits)
 *   - GET /outfits/recommended generated outfits and threw them away: no row
 *     anywhere recorded that a given user was shown a given combination.
 *   - db.feedback rows carried no id, so a retried POST re-learned the same
 *     signal without limit.
 *   - POST /outfits/:id/favorite changed a boolean and taught nothing.
 *   - Feedback on a *generated* recommendation (`gen-…` ids are never saved to
 *     db.outfits) resolved to zero garments, so the rating moved no preference
 *     at all.
 *
 * WHAT THIS MODULE ADDS (smallest compatible surface)
 *   1. db.recommendationHistory — compact per-shown-outfit rows:
 *        { id, userId, at, source, occasion, tempC, outfitId, itemIds, match,
 *          interacted }
 *      No wardrobe copies, no explanations, no embeddings, no model output.
 *      Bounded: the newest MAX_PER_USER rows per user are kept (§3 has no
 *      retention mechanism to copy; this one is set up front instead of
 *      growing forever).
 *   2. Stable event ids for feedback (`fb_<type>_<hash>`), so the same signal
 *      from the same user about the same outfit on the same UTC day is
 *      recorded — and learned from — exactly once.
 *   3. Item attribution through history: when an outfit id is not in
 *      db.outfits (every generated recommendation), the itemIds shown to the
 *      user are recovered from db.recommendationHistory, so rating a
 *      recommendation actually moves the preferences for its garments.
 *   4. Star ratings (saveRating/readRating): the user's 1–5 opinion of an
 *      outfit is stored in db.feedback (one row per user/outfit, replaced in
 *      place) AND learned into StyleMemory with REPLACE semantics — changing a
 *      rating swaps its contribution instead of adding to it — so the next
 *      recommendation reflects the user's current opinion (Phase 1).
 *
 * EXPLICIT vs LEARNED (never mixed)
 *   Explicit profile fields — favoriteColors, preferredStyles, avoidedColors,
 *   sizes, fitPreference — live on `user.styleProfile` and are NOT touched by
 *   anything here. All learning writes to the StyleMemory record
 *   (`db.styleMemories`) through memoryStore, exactly as before. §3 keeps the
 *   two separate components (`profile_match` vs `learned_affinity`) separate,
 *   and so does this module.
 *
 * FEEDBACK STRENGTH — the existing style-memory scale is preserved unchanged:
 *   signal                 direction  magnitude per item        source
 *   ---------------------  ---------  -------------------------  --------------
 *   rating 5 (or favorite) positive   +0.09 colours/styles       RATE_RATING
 *   rating 4               positive   +0.045                    RATE_RATING
 *   rating 3               neutral    0 (recorded, no movement) learnRating
 *   rating 2               negative   −0.03                     RATE_RATING
 *   rating 1               negative   −0.06                     RATE_RATING
 *   (fabrics move at 0.6× the colour/style delta — existing behaviour.)
 *   Caps: every preference score is clamped to [0.02, 0.98] (BOUNDS), so one
 *   action can never pin a profile to a hard 0/1. Duplicates are dropped by
 *   the event id before they reach the learner. There is no time decay — the
 *   bound plus the per-day idempotency window are the existing safeguards.
 *
 * WHAT IS *NOT* HERE (deliberate, documented integration points)
 *   - Impression/view/click acknowledgement: the server can only record what
 *     it *returned*; no Flutter screen reports that it actually rendered the
 *     list, and inventing that producer is out of scope.
 *   - Thumbs up/down on the Outfit History screen is a local toast today
 *     (lib/features/outfits/outfit_history_screen.dart) — it never calls the
 *     API. Wiring it to POST /outfits/:id/feedback is a frontend task.
 *   - Wear signal: `timesWorn`/`lastWornLabel` are already persisted by
 *     PATCH /wardrobe/items/:id and already feed §3's `freshness` component.
 *     No second wear store was created (that would duplicate an existing
 *     mechanism), and the runtime's wear path carries no outfit attribution.
 *   - No decay job, no cleanup daemon, no new dependency, no migration.
 *
 * Persistence: every mutator changes the in-memory `db` object only; the
 * caller decides when to call store.save(), matching style-memory.js.
 * Pure Node (crypto) — no dependencies, no network, no ML.
 */
'use strict';

const crypto = require('crypto');
const memoryStore = require('./style-memory');

/** Newest rows kept per user. Oldest rows fall off once this is exceeded. */
const MAX_PER_USER = 100;
/** Max item references kept on one history row (garments, not embeddings). */
const MAX_ITEM_IDS = 24;

const HISTORY_KEY = 'recommendationHistory';

// ------------------------------------------------------------- safe access

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The history array, created on demand so legacy db.json rows never throw. */
function historyRows(db) {
  if (!isObject(db)) return [];
  if (!Array.isArray(db[HISTORY_KEY])) db[HISTORY_KEY] = [];
  return db[HISTORY_KEY];
}

/** The existing feedback array, created on demand (legacy db.json tolerant). */
function feedbackRows(db) {
  if (!isObject(db)) return [];
  if (!Array.isArray(db.feedback)) db.feedback = [];
  return db.feedback;
}

function isoAt(at) {
  const d = at instanceof Date ? at : new Date(at == null ? Date.now() : at);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function dayOf(iso) {
  return String(iso).slice(0, 10); // UTC day — the idempotency window
}

function hashOf(parts) {
  return crypto.createHash('sha256').update(parts.map(String).join('\u0001')).digest('hex');
}

// -------------------------------------------------------- feedback events

/**
 * Stable id for one feedback signal.
 *
 * Same user + same subject + same payload + same UTC day ⇒ same id, so a
 * retried request is recognised instead of learned from twice. Deliberately
 * payload-derived (no clock reading beyond the day) so identical events are
 * reproducible and testable.
 */
function feedbackEventId({
  type = 'rating',
  userId = null,
  outfitId = null,
  rating = null,
  comment = '',
  at,
} = {}) {
  const numeric = Number(rating);
  const ratingKey = Number.isFinite(numeric) ? String(numeric) : String(rating == null ? '' : rating);
  const iso = isoAt(at);
  return `fb_${String(type)}_${hashOf([
    type,
    userId || 'anonymous',
    outfitId || '',
    ratingKey,
    String(comment || ''),
    dayOf(iso),
  ]).slice(0, 24)}`;
}

function findFeedback(db, id) {
  if (!id) return null;
  const rows = feedbackRows(db);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    // Legacy rows (pre-§4) have no id — they can never collide with a new one.
    if (row && row.id === id) return row;
  }
  return null;
}

/**
 * Append one feedback event. Idempotent: returns the existing row when the
 * stable id has already been recorded.
 *
 * Row shape keeps the legacy db.feedback fields (outfitId, rating, comment,
 * at, userId) so /admin/reports and /admin/dashboard keep working, and adds
 * `id` + `type` + `source` on top.
 */
function recordFeedback(db, payload = {}) {
  const id = payload.id || feedbackEventId(payload);
  const existing = findFeedback(db, id);
  if (existing) return { row: existing, id, duplicate: true };
  const row = {
    id,
    type: payload.type || 'rating',
    source: payload.source || 'outfit_feedback',
    userId: payload.userId || null,
    outfitId: payload.outfitId || null,
    // Stored exactly as sent (legacy behaviour); Number() is applied only
    // when learning.
    rating: payload.rating == null ? null : payload.rating,
    comment: String(payload.comment || ''),
    at: isoAt(payload.at),
  };
  feedbackRows(db).push(row);
  return { row, id, duplicate: false };
}

// -------------------------------------------------------- outfit ratings
//
// Star ratings (Phase 1). A user's 1–5 rating of an outfit is stored as a
// db.feedback row so it survives a restart and can be shown again on reopen,
// and it is learned into the same StyleMemory the recommendation engine already
// reads (`learned_affinity`), so rating a look changes what is recommended next.
//
// The learning uses `applyRating` (replace semantics), not the additive
// `learnRating` used by the day-scoped `/outfits/:id/feedback` event: a rating
// is a *current opinion* rather than an event, so changing 5 → 1 must leave the
// same learned state as giving 1 alone — never the sum of both.
//
// One row per (user, outfit): re-rating updates the row in place (rather than
// appending a day-scoped event), so `readRating` always returns the user's
// current choice. Rows reuse the existing db.feedback collection and its
// legacy shape, so /admin/reports and /admin/dashboard keep working.

/** Marks a db.feedback row as a persistence-only outfit rating. */
const RATING_SOURCE = 'outfit_rating';

/**
 * True only for the ratings the UI may send: a whole JSON number 1–5.
 * Strings, booleans, floats, null and out-of-range values are all rejected, so
 * a malformed body can never be persisted as a rating.
 */
function isValidRating(value) {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= 5;
}

/** Stable id for one user's current rating of one outfit (not day-scoped). */
function ratingEventId({ userId = null, outfitId = null } = {}) {
  return `fb_rating_${hashOf(['rating', userId || 'anonymous', outfitId || '']).slice(0, 24)}`;
}

/**
 * Record or update a user's rating for an outfit AND learn from it (Phase 1).
 *
 * Persistence: one row per (user, outfit) — re-rating updates it in place.
 * Learning: the current rating's signal is applied to the user's StyleMemory
 * with REPLACE semantics (see `memoryStore.applyRating`), so changing a rating
 * never double-counts the old value. The previous rating is read from the row
 * before it is overwritten, and the outfit's garments are resolved from the
 * explicit `itemIds`, the saved outfit, or (for generated recommendations) the
 * history row that produced it.
 *
 * Never throws: a learning failure is reported in `learnError` while the
 * rating itself is still saved. Returns `{ row, id, updated, previous, learned,
 * learnError }`.
 */
function saveRating(db, { userId = null, outfitId = null, rating, itemIds, at } = {}) {
  const id = ratingEventId({ userId, outfitId });
  const value = Number(rating);
  const iso = isoAt(at);
  const existing = findFeedback(db, id);
  const previous = existing && Number.isFinite(Number(existing.rating))
    ? Number(existing.rating)
    : null;

  let row;
  let updated;
  if (existing) {
    existing.rating = value;
    existing.at = iso;
    existing.userId = userId || null;
    existing.outfitId = outfitId || null;
    existing.type = 'rating';
    existing.source = RATING_SOURCE;
    row = existing;
    updated = true;
  } else {
    row = {
      id,
      type: 'rating',
      source: RATING_SOURCE,
      userId: userId || null,
      outfitId: outfitId || null,
      rating: value,
      comment: '',
      at: iso,
    };
    feedbackRows(db).push(row);
    updated = false;
  }

  const items = resolveItemIds(db, { userId, outfitId, itemIds })
    .map((itemId) => (Array.isArray(db.wardrobe)
      ? db.wardrobe.find((i) => isObject(i) && i.id === itemId)
      : null))
    .filter(Boolean);

  // Something to learn or unlearn? A neutral first rating (and a neutral
  // re-rating of a neutral one) moves nothing, so nothing is written — matching
  // `learnRating`'s "rating 3 is not a preference signal".
  const hasSignal = memoryStore.ratingSignal(value) !== 0
    || (previous != null && memoryStore.ratingSignal(previous) !== 0);

  let learned = false;
  let learnError = null;
  if (items.length && hasSignal) {
    const learningUser = userId || 'anonymous';
    try {
      const memory = memoryStore.read(db, learningUser);
      memoryStore.applyRating(memory, { items, rating: value, previous });
      memoryStore.write(db, memory);
      learned = true;
    } catch (e) {
      learnError = String((e && e.message) || e).slice(0, 200);
    }
  }

  return { row, id, updated, previous, learned, learnError };
}

/** The user's saved rating for an outfit, or null when none was given. */
function readRating(db, { userId = null, outfitId = null } = {}) {
  if (outfitId == null) return null;
  const row = findFeedback(db, ratingEventId({ userId, outfitId }));
  if (!row) return null;
  const n = Number(row.rating);
  return Number.isFinite(n) ? n : null;
}

/**
 * Copy a user's existing rating from one outfit id to another (saved-outfits
 * fix phase A).
 *
 * Saving a recommendation mints a new `o_…` record; the rating the user gave
 * the `gen-…` recommendation must follow it so the saved look reopens with the
 * same stars. This is a *persistence* copy only:
 *
 *   • It never calls `applyRating` / `memoryStore.*`, so StyleMemory and the
 *     rating-learning totals are untouched. The source rating already taught the
 *     learner when it was given; re-teaching here would double-count.
 *   • It is strictly user-scoped: `readRating` filters on `userId`, so another
 *     user's rating can never be copied.
 *   • It is idempotent: an existing rating on the target is left in place, so
 *     repeating the transfer cannot append a second row or overwrite a rating
 *     the user set directly.
 *   • It never fabricates: with no (valid) source rating it does nothing.
 *
 * Returns `{ transferred, rating, source? }`.
 */
function transferRating(db, { userId = null, fromOutfitId = null, toOutfitId = null, at } = {}) {
  const from = fromOutfitId == null || fromOutfitId === '' ? null : String(fromOutfitId);
  const to = toOutfitId == null || toOutfitId === '' ? null : String(toOutfitId);
  if (from == null || to == null || from === to) {
    return { transferred: false, rating: to == null ? null : readRating(db, { userId, outfitId: to }) };
  }

  const source = readRating(db, { userId, outfitId: from });
  if (source == null || !isValidRating(source)) {
    return { transferred: false, rating: null };
  }

  // Idempotent: never overwrite a rating already on the target (an explicit
  // rating the user set on the saved outfit wins over the copied one).
  const existing = readRating(db, { userId, outfitId: to });
  if (existing != null) {
    return { transferred: false, rating: existing, alreadyPresent: true };
  }

  feedbackRows(db).push({
    id: ratingEventId({ userId, outfitId: to }),
    type: 'rating',
    source: RATING_SOURCE,
    userId: userId || null,
    outfitId: to,
    rating: source,
    comment: '',
    at: isoAt(at),
  });
  return { transferred: true, rating: source, source: from };
}

// --------------------------------------------------- recommendation history

/**
 * Record what was shown. One compact row per outfit in the response.
 *
 * Rows with no usable itemIds (empty recommendations) are not recorded —
 * nothing was shown. Returns the rows written (0 for an empty result), so the
 * caller can skip persisting when nothing changed.
 */
function recordShown(db, payload = {}) {
  const rows = historyRows(db);
  const at = isoAt(payload.at);
  const userId = payload.userId || null;
  const outfits = Array.isArray(payload.outfits) ? payload.outfits : [];
  const written = [];

  for (const outfit of outfits) {
    if (!isObject(outfit)) continue;
    const itemIds = (Array.isArray(outfit.itemIds) ? outfit.itemIds : [])
      .filter((x) => x != null && x !== '')
      .map(String)
      .slice(0, MAX_ITEM_IDS);
    if (!itemIds.length) continue;

    const row = {
      id: `rh_${crypto.randomBytes(8).toString('hex')}`,
      userId,
      at,
      source: String(payload.source || 'GET /outfits/recommended').slice(0, 80),
      occasion: payload.occasion == null ? null : String(payload.occasion).slice(0, 60),
      tempC: Number.isFinite(Number(payload.tempC)) ? Number(payload.tempC) : null,
      outfitId: outfit.id == null ? null : String(outfit.id),
      itemIds,
      match: Number.isFinite(Number(outfit.match)) ? Number(outfit.match) : null,
      interacted: null,
    };
    rows.push(row);
    written.push(row);
  }

  if (written.length) trimHistory(db, userId);
  return written;
}

/** Drop a user's oldest rows beyond MAX_PER_USER (retention, §3 had none). */
function trimHistory(db, userId = null) {
  const rows = historyRows(db);
  const uid = userId || null;
  const mine = rows.filter((r) => isObject(r) && (r.userId || null) === uid);
  if (mine.length <= MAX_PER_USER) return 0;
  const drop = new Set(mine.slice(0, mine.length - MAX_PER_USER).map((r) => r.id));
  db[HISTORY_KEY] = rows.filter((r) => !isObject(r) || !drop.has(r.id));
  return drop.size;
}

/** A user's own history, oldest first, newest `limit` rows. */
function listFor(db, userId = null, limit = 50) {
  const uid = userId || null;
  const rows = historyRows(db).filter((r) => isObject(r) && (r.userId || null) === uid);
  const max = Number.isFinite(Number(limit)) ? Math.max(0, Math.round(Number(limit))) : 50;
  return rows.slice(-max);
}

/**
 * The newest history row this user was shown for an outfit id — strict user
 * match, so one user's feedback never resolves another user's garments.
 */
function findForOutfit(db, userId, outfitId) {
  if (outfitId == null) return null;
  const wanted = String(outfitId);
  const uid = userId || null;
  const rows = historyRows(db);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!isObject(row) || row.outfitId !== wanted) continue;
    if ((row.userId || null) !== uid) continue;
    return row;
  }
  return null;
}

/**
 * Which garments a feedback event is about: explicit itemIds when the outfit
 * is persisted in db.outfits, otherwise the ones recovered from history (the
 * normal case for generated recommendations).
 */
function resolveItemIds(db, { userId = null, outfitId = null, itemIds } = {}) {
  if (Array.isArray(itemIds) && itemIds.length) return itemIds.map(String);
  // A saved outfit carries its own itemIds; a generated recommendation only
  // exists in history. Prefer the saved outfit, then fall back to what was shown.
  const saved = isObject(db) && Array.isArray(db.outfits)
    ? db.outfits.find((o) => isObject(o) && o.id === outfitId)
    : null;
  if (saved && Array.isArray(saved.itemIds) && saved.itemIds.length) return saved.itemIds.map(String);
  const row = findForOutfit(db, userId, outfitId);
  return row && Array.isArray(row.itemIds) ? row.itemIds.map(String) : [];
}

/** Attach the user's answer to the row that produced it (latest match wins). */
function markInteracted(db, { userId = null, outfitId = null, type = 'rating', at } = {}) {
  const row = findForOutfit(db, userId, outfitId);
  if (!row) return null;
  row.interacted = { type: String(type), at: isoAt(at) };
  return row;
}

// ---------------------------------------------------------------- learning

/**
 * A response-safe view of a StyleMemory record.
 *
 * `style-memory.js` is intentionally untouched (§2: do not modify), so a
 * legacy or hand-edited row can carry `colors: null` / a missing `totals`.
 * Read tolerates it; response building must too.
 */
function safeMemory(memory, userId = 'anonymous') {
  const base = memoryStore.empty(userId);
  const m = isObject(memory) ? memory : {};
  return {
    ...base,
    ...m,
    colors: isObject(m.colors) ? m.colors : {},
    styles: isObject(m.styles) ? m.styles : {},
    occasions: isObject(m.occasions) ? m.occasions : {},
    fabrics: isObject(m.fabrics) ? m.fabrics : {},
    itemRatings: isObject(m.itemRatings) ? m.itemRatings : {},
    avoid: Array.isArray(m.avoid) ? m.avoid : [],
    facts: Array.isArray(m.facts) ? m.facts : [],
    totals: {
      ratings: Number(m.totals?.ratings) || 0,
      chats: Number(m.totals?.chats) || 0,
    },
  };
}

function readMemory(db, userId) {
  try {
    return safeMemory(memoryStore.read(db, userId), userId);
  } catch {
    return safeMemory(memoryStore.empty(userId), userId);
  }
}

/**
 * One feedback signal, end to end:
 *
 *   stable event id → duplicate? → existing StyleMemory learning → history
 *
 * Returns `{ duplicate, id, memory, learnError, items }` and NEVER throws:
 * a failure inside learning is reported in `learnError`, the event is still
 * recorded (the user did give the signal), and the caller keeps serving.
 *
 * `memory` is always a response-safe record of the current learned state.
 */
function applyFeedback(db, payload = {}) {
  const type = payload.type || 'rating';
  const userId = payload.userId || null;
  const learningUser = userId || 'anonymous';
  const id = feedbackEventId({ ...payload, type, userId });

  const itemsFor = () => resolveItemIds(db, payload)
    .map((itemId) => (Array.isArray(db.wardrobe) ? db.wardrobe.find((i) => i && i.id === itemId) : null))
    .filter(Boolean);

  const existing = findFeedback(db, id);
  if (existing) {
    return {
      duplicate: true,
      id,
      row: existing,
      memory: readMemory(db, learningUser),
      learnError: null,
      items: itemsFor(),
    };
  }

  let memory = readMemory(db, learningUser);
  let learnError = null;
  let items = [];
  try {
    items = itemsFor();
    memory = memoryStore.record(db, learningUser, {
      rating: type === 'favorite' ? 5 : Number(payload.rating),
      items,
      // A favourite carries no text; only explicit ratings mine comments, so
      // the existing chat-learning path stays exactly as it was.
      message: type === 'rating' ? payload.comment || null : null,
    });
    memory = safeMemory(memory, learningUser);
  } catch (e) {
    learnError = String((e && e.message) || e).slice(0, 200);
    memory = readMemory(db, learningUser);
  }

  const recorded = recordFeedback(db, { ...payload, type, id });
  if (!recorded.duplicate) {
    markInteracted(db, { userId, outfitId: payload.outfitId, type, at: payload.at });
  }

  return {
    duplicate: false,
    id,
    row: recorded.row,
    memory,
    learnError,
    items,
  };
}

module.exports = {
  MAX_PER_USER,
  RATING_SOURCE,
  feedbackEventId,
  findFeedback,
  recordFeedback,
  isValidRating,
  ratingEventId,
  saveRating,
  readRating,
  transferRating,
  recordShown,
  listFor,
  findForOutfit,
  resolveItemIds,
  markInteracted,
  applyFeedback,
  readMemory,
  safeMemory,
};
