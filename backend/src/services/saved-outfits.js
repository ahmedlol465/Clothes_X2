/**
 * Saved-outfit relationships — §8.5 SAVED OUTFITS.
 *
 * `db.outfits` holds shared outfit *records* (name, image, pieces, match…),
 * which are not owned by anyone. Whether a given user has *saved* an outfit is
 * a separate, per-user fact, so it lives in its own collection rather than as a
 * flag on the record:
 *
 *     db.savedOutfits = [{ id, userId, outfitId, createdAt }, …]
 *
 * That separation is what makes unsaving safe: removing a relationship touches
 * only this collection. The outfit record — and everything derived from it such
 * as ratings, feedback and history — is never mutated or deleted by an unsave.
 *
 * Design notes
 *   • Idempotent: the row id is a pure hash of (userId, outfitId), so saving
 *     the same outfit twice returns the existing row and unsaving twice is a
 *     no-op. No day-scoped window is needed here — a save is a state, not an
 *     event.
 *   • User-scoped: every read filters on the caller's id, so one user can never
 *     see or remove another user's saves.
 *   • Legacy-tolerant: `rows()` creates the array on demand, so an existing
 *     db.json without `savedOutfits` behaves as "nothing saved" instead of
 *     throwing. There is no migration.
 *
 * Persistence matches style-memory.js / recommendation-history.js: mutators
 * change the in-memory `db` only, and the caller decides when to `store.save()`.
 */
'use strict';

const crypto = require('crypto');

/** The relationships collection key on `db`. */
const KEY = 'savedOutfits';

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normId(v) {
  return v == null || v === '' ? null : String(v);
}

function isoAt(at) {
  const d = at instanceof Date ? at : new Date(at == null ? Date.now() : at);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** The relationships array, created on demand for legacy db.json files. */
function rows(db) {
  if (!isObject(db)) return [];
  if (!Array.isArray(db[KEY])) db[KEY] = [];
  return db[KEY];
}

/**
 * Stable id for one (user, outfit) relationship. Deterministic so a repeated
 * save collapses onto the same row instead of appending a second.
 */
function relationshipId(userId, outfitId) {
  const hash = crypto
    .createHash('sha256')
    .update(`${userId || 'anonymous'}\u0001${outfitId || ''}`)
    .digest('hex')
    .slice(0, 24);
  return `so_${hash}`;
}

/** The user's relationship row for an outfit, or null when not saved. */
function find(db, userId, outfitId) {
  const user = normId(userId);
  const outfit = normId(outfitId);
  if (user == null || outfit == null) return null;
  const wanted = relationshipId(user, outfit);
  for (const row of rows(db)) {
    if (isObject(row) && row.id === wanted) return row;
  }
  return null;
}

/** True when the user has saved the outfit. */
function isSaved(db, userId, outfitId) {
  return find(db, userId, outfitId) != null;
}

/**
 * Save an outfit for a user. Idempotent: an existing relationship is returned
 * untouched. Returns `{ row, created }`, or null when either id is missing.
 */
function save(db, { userId, outfitId, at } = {}) {
  const user = normId(userId);
  const outfit = normId(outfitId);
  if (user == null || outfit == null) return null;

  const existing = find(db, user, outfit);
  if (existing) return { row: existing, created: false };

  const row = {
    id: relationshipId(user, outfit),
    userId: user,
    outfitId: outfit,
    createdAt: isoAt(at),
  };
  rows(db).push(row);
  return { row, created: true };
}

/**
 * Remove a user's relationship to an outfit. Idempotent: returns how many rows
 * were removed (0 when it was not saved). Never touches `db.outfits` or any
 * other collection — this is the whole point of the relationship model.
 */
function unsave(db, { userId, outfitId } = {}) {
  const user = normId(userId);
  const outfit = normId(outfitId);
  if (user == null || outfit == null) return { removed: 0 };

  const wanted = relationshipId(user, outfit);
  const before = rows(db).length;
  db[KEY] = rows(db).filter((row) => !(isObject(row) && row.id === wanted));
  return { removed: before - db[KEY].length };
}

/** The user's relationships, oldest first. */
function listFor(db, userId) {
  const user = normId(userId);
  if (user == null) return [];
  return rows(db).filter((row) => isObject(row) && row.userId === user);
}

/** The set of outfit ids the user has saved. */
function listOutfitIds(db, userId) {
  const ids = new Set();
  for (const row of listFor(db, userId)) {
    if (row.outfitId != null && row.outfitId !== '') ids.add(String(row.outfitId));
  }
  return [...ids];
}

/**
 * The user's saved outfit records, joined against `db.outfits` and returned in
 * the outfits collection's own order (newest first, since POST /outfits
 * unshifts). Relationships pointing at an unknown outfit id are skipped, so a
 * stale row can never surface a null record.
 */
function listOutfits(db, userId) {
  const wanted = new Set(listOutfitIds(db, userId));
  if (!wanted.size) return [];
  const outfits = isObject(db) && Array.isArray(db.outfits) ? db.outfits : [];
  return outfits.filter((o) => isObject(o) && wanted.has(String(o.id)));
}

/**
 * Drop every relationship pointing at a deleted outfit, for all users. Called
 * when a record is deleted so no dangling rows accumulate; it never deletes an
 * outfit itself.
 */
function purgeOutfit(db, outfitId) {
  const outfit = normId(outfitId);
  if (outfit == null) return 0;
  const before = rows(db).length;
  db[KEY] = rows(db).filter((row) => !(isObject(row) && row.outfitId === outfit));
  return before - db[KEY].length;
}

module.exports = {
  KEY,
  rows,
  relationshipId,
  find,
  isSaved,
  save,
  unsave,
  listFor,
  listOutfitIds,
  listOutfits,
  purgeOutfit,
};
