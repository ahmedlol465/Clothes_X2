/**
 * Focused behaviour tests for Phase 1 — ratings contribute to learning.
 *
 * Dependency-free on purpose (no installed packages needed):
 *
 *     node --test test/rating-learning.test.js     (from backend/)
 *
 * Coverage map:
 *   A a rating is saved and read back
 *   B changing a rating REPLACES its contribution (no double counting)
 *   C positive and negative ratings move learned affinity the right way
 *   D ratings are strictly user-scoped
 *   E a rating is consumed by the recommendation engine (learned_affinity)
 *   F a user with no ratings keeps the previous behaviour exactly
 *   G a rating and its learning survive a serialize/parse round-trip
 *   H generated recommendation ids are stable and content-derived
 *
 * Nothing in this file modifies the §3/§4 suites or their fixtures.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const history = require('../src/recommendation-history');
const memoryStore = require('../src/style-memory');
const engine = require('../src/recommendation-engine');
const ai = require('../src/ai-engine');

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

const SAVED_OUTFIT = {
  id: 'o1', name: 'University Casual', occasion: 'Academics', match: 92,
  pieces: ['Shirt', 'Jeans', 'Sneakers'], itemIds: ['w1', 'w2', 'w3'], favorite: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function makeDb(spec = {}) {
  return {
    users: [
      { id: 'u1', name: 'Karim', email: 'k@x.com', styleProfile: structuredClone(EXPLICIT_PROFILE) },
      { id: 'u2', name: 'Sara', email: 's@x.com', styleProfile: structuredClone(EXPLICIT_PROFILE) },
    ],
    wardrobe: [structuredClone(SHIRT), structuredClone(JEANS), structuredClone(SNEAKERS)],
    outfits: [structuredClone(SAVED_OUTFIT)],
    feedback: [],
    styleMemories: [],
    recommendationHistory: [],
    ...spec,
  };
}

/** Comparable learned state: everything the learner changes, no clock. */
function learnedProjection(memory) {
  // Round to 6dp: "rate 1" and "rate 5 then 1" are provably equal in exact
  // arithmetic but can differ in the last bits from the order of operations.
  const round = (map) =>
    Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k, Number(v.toFixed(6))]));
  return JSON.stringify({
    colors: round(memory.colors),
    styles: round(memory.styles),
    fabrics: round(memory.fabrics),
    itemRatings: Object.fromEntries(
      Object.entries(memory.itemRatings || {}).map(([id, r]) => [id, r && r.rating]),
    ),
    totals: memory.totals,
  });
}

// ------------------------------------------------------------------- Test A

test('A — a rating is saved and read back', () => {
  const db = makeDb();

  const saved = history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 4 });
  assert.equal(saved.row.rating, 4);
  assert.equal(saved.updated, false, 'first save inserts');
  assert.equal(saved.learned, true, 'a decisive rating is learned');
  assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'o1' }), 4);
  assert.equal(db.feedback.length, 1);
});

// ------------------------------------------------------------------- Test B

test('B — changing a rating replaces its contribution (no double counting)', () => {
  // 5 then 1 must leave exactly the state a lone 1 produces.
  const single = makeDb();
  history.saveRating(single, { userId: 'u1', outfitId: 'o1', rating: 1 });

  const changed = makeDb();
  history.saveRating(changed, { userId: 'u1', outfitId: 'o1', rating: 5 });
  history.saveRating(changed, { userId: 'u1', outfitId: 'o1', rating: 1 });

  assert.equal(
    learnedProjection(memoryStore.read(changed, 'u1')),
    learnedProjection(memoryStore.read(single, 'u1')),
    'rate 1 alone === rate 5 then change to 1',
  );
  assert.equal(history.readRating(changed, { userId: 'u1', outfitId: 'o1' }), 1);
  assert.equal(changed.feedback.length, 1, 're-rating still keeps exactly one row');

  // Re-saving the SAME rating is a no-op on the learned state.
  const repeat = makeDb();
  history.saveRating(repeat, { userId: 'u1', outfitId: 'o1', rating: 5 });
  const once = learnedProjection(memoryStore.read(repeat, 'u1'));
  history.saveRating(repeat, { userId: 'u1', outfitId: 'o1', rating: 5 });
  assert.equal(learnedProjection(memoryStore.read(repeat, 'u1')), once, 'same rating does not compound');

  // A change to neutral removes the earlier contribution and counts nothing.
  const toNeutral = makeDb();
  history.saveRating(toNeutral, { userId: 'u1', outfitId: 'o1', rating: 5 });
  history.saveRating(toNeutral, { userId: 'u1', outfitId: 'o1', rating: 3 });
  const neutral = memoryStore.read(toNeutral, 'u1');
  assert.equal(neutral.totals.ratings, 0, 'a 3 leaves no decisive rating');
  assert.ok(Math.abs(memoryStore.itemAffinity(neutral, SHIRT) - 0.5) < 1e-9, 'back to neutral');
});

// ------------------------------------------------------------------- Test C

test('C — positive and negative ratings move affinity the right way', () => {
  const up = makeDb();
  history.saveRating(up, { userId: 'u1', outfitId: 'o1', rating: 5 });
  assert.ok(memoryStore.itemAffinity(memoryStore.read(up, 'u1'), SHIRT) > 0.5, '5-star lifts affinity');

  const down = makeDb();
  history.saveRating(down, { userId: 'u1', outfitId: 'o1', rating: 1 });
  assert.ok(memoryStore.itemAffinity(memoryStore.read(down, 'u1'), SHIRT) < 0.5, '1-star lowers affinity');

  const neutral = makeDb();
  const res = history.saveRating(neutral, { userId: 'u1', outfitId: 'o1', rating: 3 });
  assert.equal(res.learned, false, 'a 3 teaches nothing');
  assert.equal(neutral.styleMemories.length, 0, 'no memory written for a neutral-only rating');
  assert.equal(memoryStore.itemAffinity(memoryStore.read(neutral, 'u1'), SHIRT), 0.5);
});

// ------------------------------------------------------------------- Test D

test('D — ratings and their learning are strictly user-scoped', () => {
  const db = makeDb();

  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 5 });
  history.saveRating(db, { userId: 'u2', outfitId: 'o1', rating: 1 });

  assert.equal(history.readRating(db, { userId: 'u1', outfitId: 'o1' }), 5);
  assert.equal(history.readRating(db, { userId: 'u2', outfitId: 'o1' }), 1);
  assert.equal(history.readRating(db, { userId: 'u3', outfitId: 'o1' }), null);
  assert.equal(db.feedback.length, 2);

  const m1 = memoryStore.read(db, 'u1');
  const m2 = memoryStore.read(db, 'u2');
  assert.ok(memoryStore.itemAffinity(m1, SHIRT) > 0.5, 'u1 likes the shirt');
  assert.ok(memoryStore.itemAffinity(m2, SHIRT) < 0.5, 'u2 dislikes it');
  assert.notEqual(learnedProjection(m1), learnedProjection(m2));
});

// ------------------------------------------------------------------- Test E

test('E — a rating is consumed by the recommendation engine', async () => {
  const db = makeDb();
  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 5 });

  const memory = memoryStore.read(db, 'u1');
  assert.ok(memoryStore.hasOpinionFor(memory, SHIRT), 'learned opinion reaches the item');

  const { meta } = await engine.recommend(db.wardrobe, {
    occasion: 'casual',
    weather: { tempC: 24, condition: 'partly cloudy' },
    count: 3,
    styleProfile: db.users[0].styleProfile,
    memory,
  });
  assert.ok(meta.activeComponents.includes('learned_affinity'),
    'the learned-affinity component is live for a rated user');
});

// ------------------------------------------------------------------- Test F

test('F — a user with no ratings keeps the previous behaviour', async () => {
  const db = makeDb();
  // Feedback/ratings, but never a decisive one.
  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 3 });

  const memory = memoryStore.read(db, 'u1');
  assert.equal(db.styleMemories.length, 0, 'no learned record was created');
  assert.equal(memory.totals.ratings, 0);

  const opts = () => ({
    occasion: 'casual',
    weather: { tempC: 24, condition: 'partly cloudy' },
    count: 3,
    styleProfile: structuredClone(EXPLICIT_PROFILE),
    memory: memoryStore.empty('u1'),
  });
  const a = await engine.recommend(structuredClone(db.wardrobe), opts());
  const b = await engine.recommend(structuredClone(makeDb().wardrobe), opts());
  assert.deepEqual(
    a.outfits.map((o) => ({ ids: o.itemIds, match: o.match, rank: o.rankingScore })),
    b.outfits.map((o) => ({ ids: o.itemIds, match: o.match, rank: o.rankingScore })),
    'an unrated user is unaffected',
  );
  assert.ok(!a.meta.activeComponents.includes('learned_affinity'));
});

// ------------------------------------------------------------------- Test G

test('G — a rating and its learning survive a reload', () => {
  const db = makeDb();
  history.saveRating(db, { userId: 'u1', outfitId: 'o1', rating: 5 });

  // Exactly what store.save()/load() do to db.json.
  const restored = JSON.parse(JSON.stringify(db));

  assert.equal(history.readRating(restored, { userId: 'u1', outfitId: 'o1' }), 5, 'the rating reloads');
  const memory = memoryStore.read(restored, 'u1');
  assert.equal(memory.totals.ratings, 1, 'the learned signal reloads');
  assert.ok(memoryStore.itemAffinity(memory, SHIRT) > 0.5);
});

// ------------------------------------------------------------------- Test H

test('H — generated recommendation ids are stable and content-derived', () => {
  const opts = { occasion: 'casual', weather: { tempC: 24 }, count: 3, memory: memoryStore.empty('u1') };

  const first = ai.generateOutfits(structuredClone(makeDb().wardrobe), opts);
  const second = ai.generateOutfits(structuredClone(makeDb().wardrobe), opts);

  assert.ok(first.length >= 1);
  assert.deepEqual(
    first.map((o) => o.id),
    second.map((o) => o.id),
    'the same garments produce the same ids across calls',
  );
  for (const o of first) {
    assert.match(o.id, /^gen-[0-9a-f]+$/, 'id is a stable content hash, not a timestamp');
  }

  // A rating on a stable generated id reads back after a fresh generation.
  const db = makeDb();
  ai.generateOutfits(db.wardrobe, opts).forEach((o) =>
    history.recordShown(db, { userId: 'u1', outfits: [o] }));
  const ratedId = first[0].id;
  history.saveRating(db, { userId: 'u1', outfitId: ratedId, rating: 4 });

  const regenerated = ai.generateOutfits(db.wardrobe, opts);
  assert.ok(regenerated.some((o) => o.id === ratedId), 'the rated outfit reappears with the same id');
  assert.equal(history.readRating(db, { userId: 'u1', outfitId: ratedId }), 4);
});
