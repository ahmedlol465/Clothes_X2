/**
 * Focused behaviour tests for Phase 3 — the persistence-only outfit rating.
 *
 * Dependency-free on purpose: they run on `node --test` with no installed
 * packages, exactly like the §3/§4 suites:
 *
 *     node --test test/outfit-rating.test.js     (from backend/)
 *
 * Coverage map:
 *   A a 1-star and a 5-star rating both persist and read back
 *   B validation rejects 0, 6, non-integers, strings, booleans and null
 *   C re-rating updates the one row in place (never appends a second)
 *   D ratings are strictly user-scoped
 *   E a generated recommendation id (gen-…) is a valid rating target
 *   F the rating survives a serialize/parse round-trip (restart)
 *   G a rating teaches StyleMemory (Phase 1: ratings learn)
 *   H a rating feeds the learned-affinity component the engine consumes
 *   I legacy / malformed db.json shapes do not crash the rating helpers
 *   J the rows reuse the documented db.feedback shape
 *
 * Nothing in this file modifies the §3/§4 suites or their fixtures.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const history = require('../src/recommendation-history');
const memoryStore = require('../src/style-memory');
const engine = require('../src/recommendation-engine');

// ------------------------------------------------------------------ helpers

const SHIRT = {
  id: 'w1', name: 'Oxford Cotton Shirt', category: 'Tops',
  color: 'Navy', style: 'Casual', material: 'Cotton',
  season: 'All Season', formality: 'Casual', timesWorn: 4, lastWornLabel: 'Worn 5 days ago',
};
const JEANS = {
  id: 'w2', name: 'Raw Denim Jeans', category: 'Bottoms',
  color: 'Indigo', style: 'Casual', material: 'Denim',
  season: 'All Season', formality: 'Casual', timesWorn: 9, lastWornLabel: 'Worn 2 days ago',
};
const SNEAKERS = {
  id: 'w3', name: 'Minimalist Sneakers', category: 'Shoes',
  color: 'White', style: 'Minimal', material: 'Leather',
  season: 'All Season', formality: 'Casual', timesWorn: 12, lastWornLabel: 'Worn yesterday',
};

const EXPLICIT_PROFILE = {
  favoriteColors: ['Navy'],
  preferredStyles: ['Casual'],
  avoidedColors: ['Orange'],
  heightCm: 178,
  weightKg: null,
  fitPreference: 'regular',
  sizes: { top: 'M', bottom: '32', shoe: '42' },
};

function makeDb(spec = {}) {
  return {
    users: [
      { id: 'u1', name: 'Karim', email: 'k@x.com', styleProfile: structuredClone(EXPLICIT_PROFILE) },
      { id: 'u2', name: 'Sara', email: 's@x.com', styleProfile: structuredClone(EXPLICIT_PROFILE) },
    ],
    wardrobe: [structuredClone(SHIRT), structuredClone(JEANS), structuredClone(SNEAKERS)],
    outfits: [{
      id: 'o1', name: 'University Casual', occasion: 'Academics', match: 92,
      pieces: ['Shirt', 'Jeans', 'Sneakers'], itemIds: ['w1', 'w2', 'w3'], favorite: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
    feedback: [],
    styleMemories: [],
    recommendationHistory: [],
    ...spec,
  };
}

// ------------------------------------------------------------------- Test A

test('A — a 1-star and a 5-star rating both persist and read back', () => {
  const db = makeDb();

  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 1 });
  assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'o1' }), 1);

  history.saveRating(db, { userId: 'u1', outfitId: 'o2', rating: 5 });
  assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'o2' }), 5);
});

// ------------------------------------------------------------------- Test B

test('B — validation rejects everything that is not a whole number 1–5', () => {
  const accepted = [1, 2, 3, 4, 5];
  for (const v of accepted) {
    assert.equal(history.isValidRating(v), true, `${v} is a valid rating`);
  }

  const rejected = [0, 6, -1, 4.5, '5', '4', '', null, undefined, true, false, {}, [], NaN, Infinity];
  for (const v of rejected) {
    assert.equal(history.isValidRating(v), false, `${JSON.stringify(v)} must be rejected`);
  }
});

// ------------------------------------------------------------------- Test C

test('C — re-rating updates the one row in place instead of appending', () => {
  const db = makeDb();

  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 2 });
  assert.equal(db.feedback.length, 1);

  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 4 });
  assert.equal(db.feedback.length, 1, 'still exactly one row');
  assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'o1' }), 4, 'latest rating wins');
});

// ------------------------------------------------------------------- Test D

test('D — ratings are strictly user-scoped', () => {
  const db = makeDb();

  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 5 });
  history.saveRating(db, { userId: 'u2', outfitId: 'o1', rating: 2 });

  assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'o1' }), 5);
  assert.equal(history.readRating(db, { userId: 'u2', outfitId: 'o1' }), 2);
  assert.equal(history.readRating(db, { userId: 'u3', outfitId: 'o1' }), null,
    'a third user sees nothing for the same outfit');
  assert.equal(db.feedback.length, 2, 'each user has their own row');
});

// ------------------------------------------------------------------- Test E

test('E — a generated recommendation id is a valid rating target', () => {
  const db = makeDb();

  // gen-… ids are never saved to db.outfits, but the user still rates them.
  history.saveRating(db, { userId: 'u1', outfitId: 'gen-1791398415503-3', rating: 5 });

  assert.equal(db.outfits.some((o) => o.id === 'gen-1791398415503-3'), false);
  assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'gen-1791398415503-3' }), 5);
});

// ------------------------------------------------------------------- Test F

test('F — a rating survives a serialize/parse round-trip', () => {
  const db = makeDb();
  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 3 });

  // Exactly what store.save()/load() do to db.json.
  const restored = JSON.parse(JSON.stringify(db));
  assert.equal(history.readRating(restored, { userId: 'u1', outfitId: 'o1' }), 3);
});

// ------------------------------------------------------------------- Test G

test('G — a rating teaches StyleMemory (Phase 1: ratings learn)', () => {
  const db = makeDb();
  const before = memoryStore.read(db, 'u1');

  // A saved outfit: its garments come from db.outfits.
  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 5 });

  const after = memoryStore.read(db, 'u1');
  assert.equal(after.totals.ratings, before.totals.ratings + 1, 'one decisive rating is learned once');
  assert.ok(memoryStore.hasOpinionFor(after, SHIRT), 'the rated garments now carry an opinion');
  assert.ok(memoryStore.itemAffinity(after, SHIRT) > 0.5, 'a 5-star rating lifts affinity');
  assert.ok(db.styleMemories.some((m) => (m.userId || null) === 'u1'), 'a StyleMemory record exists');

  // A generated recommendation: its garments come from db.recommendationHistory.
  const gen = makeDb();
  history.recordShown(gen, { userId: 'u1', outfits: [{ id: 'gen-x', itemIds: ['w1'], match: 70 }] });
  history.saveRating(gen, { userId: 'u1', outfitId: 'gen-x', rating: 1 });

  const m2 = memoryStore.read(gen, 'u1');
  assert.equal(m2.totals.ratings, 1);
  assert.ok(memoryStore.itemAffinity(m2, SHIRT) < 0.5, 'a 1-star rating pushes affinity down');
});

// ------------------------------------------------------------------- Test H

test('H — a rating feeds the learned-affinity component the engine consumes', async () => {
  const db = makeDb();
  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 5 });
  const learned = memoryStore.read(db, 'u1');

  // Pure component check: the same candidate is scored with and without the
  // learned memory. Only the learned_affinity component may come alive.
  const candidate = { items: [structuredClone(SHIRT), structuredClone(JEANS), structuredClone(SNEAKERS)], match: 80 };
  const scored = engine.scoreCandidate(candidate, { styleProfile: structuredClone(EXPLICIT_PROFILE), memory: learned });
  const bare = engine.scoreCandidate(candidate, { styleProfile: structuredClone(EXPLICIT_PROFILE), memory: memoryStore.empty('u1') });
  assert.equal(scored.components.learned_affinity.applied, true, 'learned affinity is active after a rating');
  assert.equal(bare.components.learned_affinity.applied, false, 'no ratings ⇒ no learned affinity');

  // Full engine path (what GET /outfits/recommended runs after loading memory).
  const opts = (memory) => ({
    occasion: 'casual',
    weather: { tempC: 24, condition: 'partly cloudy' },
    count: 3,
    styleProfile: structuredClone(EXPLICIT_PROFILE),
    memory,
  });
  const withRating = await engine.recommend(structuredClone(db.wardrobe), opts(learned));
  const withoutRating = await engine.recommend(structuredClone(makeDb().wardrobe), opts(memoryStore.empty('u1')));

  assert.ok(withRating.meta.activeComponents.includes('learned_affinity'), 'rated user has live learned affinity');
  assert.ok(!withoutRating.meta.activeComponents.includes('learned_affinity'), 'unrated user has none');

  // The two scores stay distinct: `match` remains an alias of the displayed
  // compatibility score, and rankingScore is the engine's own ordering score.
  for (const o of withRating.outfits) {
    assert.equal(typeof o.compatibilityScore, 'number');
    assert.equal(typeof o.rankingScore, 'number');
    assert.equal(o.match, o.compatibilityScore, 'match stays an alias of compatibilityScore');
  }

  assert.deepEqual({ ...engine.SCORE_WEIGHTS }, {
    compatibility: 0.45,
    retrieval_relevance: 0.2,
    profile_match: 0.15,
    freshness: 0.1,
    learned_affinity: 0.1,
  });
});

// ------------------------------------------------------------------- Test I

test('I — legacy and malformed db shapes do not crash the rating helpers', () => {
  // No feedback array at all (legacy db.json): read is null, save creates it.
  const legacy = { users: [], wardrobe: [], outfits: [] };
  assert.equal(history.readRating(legacy, { userId: 'u1', outfitId: 'o1' }), null);
  history.saveRating(legacy, { userId: 'u1', outfitId: 'o1', rating: 4 });
  assert.equal(history.readRating(legacy, { userId: 'u1', outfitId: 'o1' }), 4);

  // Junk rows are skipped, never thrown on.
  const junk = { feedback: [null, 42, { nope: true }] };
  assert.equal(history.readRating(junk, { userId: 'u1', outfitId: 'o1' }), null);
  history.saveRating(junk, { userId: 'u1', outfitId: 'o1', rating: 5 });
  assert.equal(history.readRating(junk, { userId: 'u1', outfitId: 'o1' }), 5);

  // A null outfit id simply has no rating.
  assert.equal(history.readRating(makeDb(), { userId: 'u1', outfitId: null }), null);
});

// ------------------------------------------------------------------- Test J

test('J — rows reuse the documented db.feedback shape', () => {
  const db = makeDb();
  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 4, at: '2026-02-02T00:00:00.000Z' });

  const row = db.feedback[0];
  assert.equal(row.type, 'rating');
  assert.equal(row.source, history.RATING_SOURCE);
  assert.equal(row.userId, 'u1');
  assert.equal(row.outfitId, 'o1');
  assert.equal(row.rating, 4);
  assert.equal(row.comment, '');
  assert.equal(row.at, '2026-02-02T00:00:00.000Z');
  assert.equal(typeof row.id, 'string');

  // The id is stable for the same (user, outfit): a save through a fresh db
  // produces the same id, so late duplicates collapse onto one row.
  const twin = makeDb();
  history.saveRating(twin, { userId: 'u1', outfitId: 'o1', rating: 1 });
  assert.equal(twin.feedback[0].id, row.id);
});
