/**
 * Unit tests for `transferRating` — the persistence-only rating hand-off used
 * when a saved recommendation mints a new `o_…` record (Saved Outfits Fix,
 * Phase A).
 *
 * transferRating must:
 *   • copy the same user's rating from source → target,
 *   • never cross users (another user's rating must not leak),
 *   • never fabricate one when the source has no rating,
 *   • never overwrite a rating already on the target (idempotent),
 *   • never learn — StyleMemory and the rating totals stay untouched (the source
 *     rating already taught the learner when it was given).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const history = require('../src/recommendation-history');
const memoryStore = require('../src/style-memory');

/** A minimal, isolated db in the shape the helper expects. */
function makeDb() {
  return {
    wardrobe: [
      { id: 'w1', name: 'White Tee', color: 'White', style: 'Casual', material: 'Cotton' },
    ],
    outfits: [],
    feedback: [],
    styleMemories: [],
  };
}

test('transferRating', async (t) => {
  await t.test('copies the user\'s rating to the target id', () => {
    const db = makeDb();
    history.saveRating(db, { userId: 'u1', outfitId: 'gen-1', rating: 5 });
    // Give the rating a learned footprint to prove the transfer does not move it.
    memoryStore.record(db, 'u1', { rating: 5, items: db.wardrobe });
    const learnedBefore = JSON.parse(JSON.stringify(db.styleMemories));

    const result = history.transferRating(db, {
      userId: 'u1',
      fromOutfitId: 'gen-1',
      toOutfitId: 'o_new',
    });

    assert.equal(result.transferred, true);
    assert.equal(result.rating, 5);
    assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'o_new' }), 5);
    // Source is untouched.
    assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'gen-1' }), 5);
    // Exactly one new row, marked as a rating from the rating source.
    const targetRows = db.feedback.filter((r) => r.outfitId === 'o_new');
    assert.equal(targetRows.length, 1);
    assert.equal(targetRows[0].type, 'rating');
    assert.equal(targetRows[0].source, 'outfit_rating');
    // No learning happened.
    assert.deepEqual(db.styleMemories, learnedBefore);
  });

  await t.test('is idempotent — a repeat transfer adds nothing and keeps the value', () => {
    const db = makeDb();
    history.saveRating(db, { userId: 'u1', outfitId: 'gen-1', rating: 4 });

    const first = history.transferRating(db, { userId: 'u1', fromOutfitId: 'gen-1', toOutfitId: 'o_new' });
    const second = history.transferRating(db, { userId: 'u1', fromOutfitId: 'gen-1', toOutfitId: 'o_new' });

    assert.equal(first.transferred, true);
    assert.equal(second.transferred, false);
    assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'o_new' }), 4);
    assert.equal(db.feedback.filter((r) => r.outfitId === 'o_new').length, 1);
  });

  await t.test('never overwrites a rating the user set directly on the target', () => {
    const db = makeDb();
    history.saveRating(db, { userId: 'u1', outfitId: 'gen-1', rating: 5 });
    history.saveRating(db, { userId: 'u1', outfitId: 'o_new', rating: 2 });

    const result = history.transferRating(db, { userId: 'u1', fromOutfitId: 'gen-1', toOutfitId: 'o_new' });

    assert.equal(result.transferred, false);
    assert.equal(result.alreadyPresent, true);
    assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'o_new' }), 2);
    assert.equal(db.feedback.filter((r) => r.outfitId === 'o_new').length, 1);
  });

  await t.test('never fabricates a rating when the source has none', () => {
    const db = makeDb();
    const result = history.transferRating(db, { userId: 'u1', fromOutfitId: 'gen-absent', toOutfitId: 'o_new' });
    assert.equal(result.transferred, false);
    assert.equal(result.rating, null);
    assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'o_new' }), null);
    assert.equal(db.feedback.length, 0);
  });

  await t.test('never crosses users', () => {
    const db = makeDb();
    // Only u2 rated the shared recommendation.
    history.saveRating(db, { userId: 'u2', outfitId: 'gen-shared', rating: 1 });

    const result = history.transferRating(db, {
      userId: 'u1',
      fromOutfitId: 'gen-shared',
      toOutfitId: 'o_new',
    });

    assert.equal(result.transferred, false);
    assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'o_new' }), null);
    // u2's rating on the source is still theirs and untouched.
    assert.equal(history.readRating(db, { userId: 'u2', outfitId: 'gen-shared' }), 1);
  });

  await t.test('is a no-op for missing or identical ids', () => {
    const db = makeDb();
    history.saveRating(db, { userId: 'u1', outfitId: 'gen-1', rating: 3 });
    const before = db.feedback.length;

    assert.equal(history.transferRating(db, { userId: 'u1', fromOutfitId: null, toOutfitId: 'o_new' }).transferred, false);
    assert.equal(history.transferRating(db, { userId: 'u1', fromOutfitId: 'gen-1', toOutfitId: '' }).transferred, false);
    assert.equal(history.transferRating(db, { userId: 'u1', fromOutfitId: 'gen-1', toOutfitId: 'gen-1' }).transferred, false);
    assert.equal(db.feedback.length, before);
  });

  await t.test('survives a legacy db without a feedback array', () => {
    const db = { wardrobe: [], outfits: [], styleMemories: [] };
    const result = history.transferRating(db, { userId: 'u1', fromOutfitId: 'gen-1', toOutfitId: 'o_new' });
    assert.equal(result.transferred, false);
    assert.ok(Array.isArray(db.feedback));
  });
});
