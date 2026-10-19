/**
 * Focused behaviour tests for Phase 3 — safe Unsave via saved-outfit
 * relationships (§8.5).
 *
 * Dependency-free on purpose: they run on `node --test` with no installed
 * packages, exactly like the §3/§4 suites:
 *
 *     node --test test/saved-outfits.test.js     (from backend/)
 *
 * Coverage map:
 *   A saving creates exactly one relationship for the user
 *   B repeated saves are idempotent (one row, same id)
 *   C unsaving removes ONLY the relationship — record, rating and learning stay
 *   D repeated unsaves are safe no-ops
 *   E relationships are strictly user-scoped
 *   F the joined list follows db.outfits order and skips unknown ids
 *   G isSaved / find are honest about unknown users, outfits and empty ids
 *   H legacy / malformed db.json shapes do not crash the helpers
 *   I a relationship survives a serialize/parse round-trip with a stable id
 *   J purgeOutfit drops relationships for a deleted record, for every user
 *
 * Nothing in this file modifies the §3/§4 suites or their fixtures.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const saved = require('../src/saved-outfits');

// ------------------------------------------------------------------ helpers

function makeDb(spec = {}) {
  return {
    users: [{ id: 'u1' }, { id: 'u2' }],
    outfits: [
      { id: 'o1', name: 'University Casual', itemIds: ['w1', 'w2'] },
      { id: 'o2', name: 'Formal Dinner', itemIds: ['w8'] },
      { id: 'o3', name: 'Weekend Chillout', itemIds: ['w3'] },
    ],
    feedback: [
      { id: 'fb_rating_u1_o1', type: 'rating', userId: 'u1', outfitId: 'o1', rating: 5 },
    ],
    styleMemories: [
      { userId: 'u1', colors: { navy: 0.7 }, totals: { ratings: 1, chats: 0 } },
    ],
    ...spec,
  };
}

// ------------------------------------------------------------------- Test A

test('A — saving creates exactly one relationship for the user', () => {
  const db = makeDb();

  const result = saved.save(db, { userId: 'u1', outfitId: 'o1' });

  assert.equal(result.created, true);
  assert.equal(db.savedOutfits.length, 1);
  assert.equal(result.row.userId, 'u1');
  assert.equal(result.row.outfitId, 'o1');
  assert.equal(typeof result.row.id, 'string');
  assert.equal(typeof result.row.createdAt, 'string');
  assert.equal(saved.isSaved(db, 'u1', 'o1'), true);
});

// ------------------------------------------------------------------- Test B

test('B — repeated saves are idempotent: one row, same id', () => {
  const db = makeDb();

  const first = saved.save(db, { userId: 'u1', outfitId: 'o1' });
  const second = saved.save(db, { userId: 'u1', outfitId: 'o1' });

  assert.equal(first.created, true);
  assert.equal(second.created, false, 'the second save must not create a row');
  assert.equal(second.row.id, first.row.id, 'both calls resolve to the same row');
  assert.equal(db.savedOutfits.length, 1, 'exactly one relationship exists');
});

// ------------------------------------------------------------------- Test C

test('C — unsaving removes only the relationship, never the record or its data', () => {
  const db = makeDb();
  saved.save(db, { userId: 'u1', outfitId: 'o1' });
  const feedbackBefore = JSON.parse(JSON.stringify(db.feedback));
  const memoriesBefore = JSON.parse(JSON.stringify(db.styleMemories));
  const outfitsBefore = JSON.parse(JSON.stringify(db.outfits));

  const removed = saved.unsave(db, { userId: 'u1', outfitId: 'o1' });

  assert.equal(removed.removed, 1);
  assert.equal(saved.isSaved(db, 'u1', 'o1'), false);
  assert.deepEqual(db.outfits, outfitsBefore, 'the outfit record is untouched');
  assert.deepEqual(db.feedback, feedbackBefore, 'the rating / feedback is untouched');
  assert.deepEqual(db.styleMemories, memoriesBefore, 'learned StyleMemory is untouched');
  // The look can be saved again later — the record is still there to reference.
  const again = saved.save(db, { userId: 'u1', outfitId: 'o1' });
  assert.equal(again.created, true);
  assert.equal(again.row.id, saved.relationshipId('u1', 'o1'), 'same relationship id');
});

// ------------------------------------------------------------------- Test D

test('D — repeated unsaves are safe no-ops', () => {
  const db = makeDb();
  saved.save(db, { userId: 'u1', outfitId: 'o1' });

  assert.equal(saved.unsave(db, { userId: 'u1', outfitId: 'o1' }).removed, 1);
  assert.equal(saved.unsave(db, { userId: 'u1', outfitId: 'o1' }).removed, 0);
  assert.equal(saved.unsave(db, { userId: 'u1', outfitId: 'nope' }).removed, 0);
  assert.equal(db.savedOutfits.length, 0);
});

// ------------------------------------------------------------------- Test E

test('E — relationships are strictly user-scoped', () => {
  const db = makeDb();
  saved.save(db, { userId: 'u1', outfitId: 'o1' });
  saved.save(db, { userId: 'u2', outfitId: 'o2' });

  assert.deepEqual(saved.listOutfitIds(db, 'u1'), ['o1']);
  assert.deepEqual(saved.listOutfitIds(db, 'u2'), ['o2']);
  assert.deepEqual(saved.listOutfitIds(db, 'u3'), [], 'a third user sees nothing');
  assert.equal(db.savedOutfits.length, 2, 'each user has their own row');

  // One user unsaving must not touch the other's relationship.
  saved.unsave(db, { userId: 'u1', outfitId: 'o1' });
  assert.equal(saved.isSaved(db, 'u2', 'o2'), true, 'u2 keeps their save');
});

// ------------------------------------------------------------------- Test F

test('F — the joined list follows db.outfits order and skips unknown ids', () => {
  const db = makeDb();
  // Save out of record order; db.outfits defines the display order.
  saved.save(db, { userId: 'u1', outfitId: 'o3' });
  saved.save(db, { userId: 'u1', outfitId: 'o1' });
  saved.save(db, { userId: 'u1', outfitId: 'missing' }); // dangling relationship

  const list = saved.listOutfits(db, 'u1');
  assert.deepEqual(list.map((o) => o.id), ['o1', 'o3'],
    'record order wins and unknown ids are dropped');
  assert.ok(list.every((o) => o && typeof o.name === 'string'),
    'every returned entry is a real record, never null');
});

// ------------------------------------------------------------------- Test G

test('G — isSaved / find are honest about unknown and empty ids', () => {
  const db = makeDb();
  saved.save(db, { userId: 'u1', outfitId: 'o1' });

  assert.equal(saved.isSaved(db, 'u1', 'o1'), true);
  assert.equal(saved.isSaved(db, 'u1', 'o2'), false);
  assert.equal(saved.isSaved(db, 'u2', 'o1'), false, 'not saved by another user');
  assert.equal(saved.find(db, 'u1', 'o2'), null);

  // Missing ids can never match a row or create one.
  assert.equal(saved.save(db, { userId: 'u1', outfitId: null }), null);
  assert.equal(saved.save(db, { userId: null, outfitId: 'o1' }), null);
  assert.equal(saved.unsave(db, { userId: 'u1', outfitId: null }).removed, 0);
  assert.deepEqual(saved.listFor(db, null), []);
  assert.equal(db.savedOutfits.length, 1);
});

// ------------------------------------------------------------------- Test H

test('H — legacy and malformed db shapes do not crash the helpers', () => {
  // No savedOutfits array at all (legacy db.json): reads are empty, save creates it.
  const legacy = { users: [], outfits: [{ id: 'o1', name: 'One' }] };
  assert.deepEqual(saved.listOutfits(legacy, 'u1'), []);
  assert.equal(saved.isSaved(legacy, 'u1', 'o1'), false);
  assert.equal(saved.save(legacy, { userId: 'u1', outfitId: 'o1' }).created, true);
  assert.equal(saved.isSaved(legacy, 'u1', 'o1'), true);
  assert.equal(Array.isArray(legacy.savedOutfits), true);

  // Junk rows are skipped, never thrown on.
  const junk = { savedOutfits: [null, 42, { nope: true }, { id: 'so_x', userId: 'u1' }] };
  assert.deepEqual(saved.listOutfitIds(junk, 'u1'), [],
    'a row with no outfitId contributes no id');
  assert.equal(saved.unsave(junk, { userId: 'u1', outfitId: 'o1' }).removed, 0);
});

// ------------------------------------------------------------------- Test I

test('I — a relationship survives a serialize/parse round-trip with a stable id', () => {
  const db = makeDb();
  const { row } = saved.save(db, { userId: 'u1', outfitId: 'o1', at: '2026-03-03T00:00:00.000Z' });
  assert.equal(row.createdAt, '2026-03-03T00:00:00.000Z');

  const restored = JSON.parse(JSON.stringify(db));
  assert.equal(saved.isSaved(restored, 'u1', 'o1'), true);

  // A save through a fresh db produces the same id, so late duplicates collapse.
  const twin = makeDb();
  assert.equal(saved.save(twin, { userId: 'u1', outfitId: 'o1' }).row.id, row.id);
  assert.equal(saved.relationshipId('u1', 'o1'), row.id);
});

// ------------------------------------------------------------------- Test J

test('J — purgeOutfit drops relationships for a deleted record, for every user', () => {
  const db = makeDb();
  saved.save(db, { userId: 'u1', outfitId: 'o1' });
  saved.save(db, { userId: 'u1', outfitId: 'o2' });
  saved.save(db, { userId: 'u2', outfitId: 'o1' });
  const recordsBefore = JSON.parse(JSON.stringify(db.outfits));
  const feedbackBefore = JSON.parse(JSON.stringify(db.feedback));

  const dropped = saved.purgeOutfit(db, 'o1');

  assert.equal(dropped, 2, 'both users\u2019 o1 relationships are removed');
  assert.deepEqual(saved.listOutfitIds(db, 'u1'), ['o2']);
  assert.deepEqual(saved.listOutfitIds(db, 'u2'), []);
  assert.deepEqual(db.outfits, recordsBefore, 'purging relationships never deletes records');
  assert.deepEqual(db.feedback, feedbackBefore, 'and never touches feedback');
});
