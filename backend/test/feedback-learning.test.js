/**
 * Focused behaviour tests for §4 FEEDBACK, LEARNING & RECOMMENDATION HISTORY.
 *
 * Dependency-free on purpose: they run on `node --test` with no installed
 * packages, exactly like the §3 suite, because backend/node_modules is absent
 * in this checkout (npm test / jest cannot run):
 *
 *     node --test test/feedback-learning.test.js     (from backend/)
 *
 * Coverage map (spec §4 STEP 10):
 *   A existing feedback behaviour stays compatible (legacy rows, response data)
 *   B recommendation history persists and is readable (incl. retention cap)
 *   C feedback and history are strictly user-scoped
 *   D positive feedback moves learned affinity up
 *   E negative feedback moves learned affinity down
 *   F explicit profile preferences are never touched by learning
 *   G duplicate feedback does not multiply the learning signal
 *   H missing / legacy / malformed db.json fields do not crash
 *   I empty history is a working state, not an error
 *   J §3 recommendation generation still works after the integration
 *   K GET /outfits/recommended response contract — asserted over real HTTP in
 *     the runtime verification step (needs express, which is not installed
 *     here); covered by the module-level shapes this endpoint consumes.
 *   L identical inputs / identical events produce identical results
 *
 * Nothing in this file modifies the §3 suite or its fixtures.
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
    users: [{ id: 'u1', name: 'Karim', email: 'k@x.com', styleProfile: structuredClone(EXPLICIT_PROFILE) }],
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

/** The compact keys §3/§4 history rows are allowed to carry. */
const HISTORY_KEYS = ['id', 'userId', 'at', 'source', 'occasion', 'tempC', 'outfitId', 'itemIds', 'match', 'interacted'];

function shownOutfit(id, itemIds) {
  return { id, itemIds, match: 71, name: 'Engine Pick' };
}

/** Comparable memory projection: everything the learner changes, no clock. */
function learnedProjection(memory) {
  return JSON.stringify({
    colors: memory.colors,
    styles: memory.styles,
    fabrics: memory.fabrics,
    occasions: memory.occasions,
    // Ratings only: the per-item `at` stamp is a clock reading, not a
    // preference, and must not enter a determinism comparison.
    itemRatings: Object.fromEntries(
      Object.entries(memory.itemRatings || {}).map(([id, r]) => [id, r && r.rating]),
    ),
    avoid: memory.avoid,
    totals: memory.totals,
  });
}

function affinityFor(db, userId, item) {
  return memoryStore.itemAffinity(memoryStore.read(db, userId), item);
}

// ------------------------------------------------------------------- Test A

test('A — existing feedback behaviour remains compatible', () => {
  const db = makeDb();

  // Legacy rows written before §4 (no id / type / source) are still there and
  // still readable by /admin/reports and /admin/dashboard (raw array access).
  db.feedback.push({ outfitId: 'o1', rating: 4, comment: 'nice', at: '2025-11-01T10:00:00.000Z', userId: 'u1' });

  const result = history.applyFeedback(db, {
    type: 'rating', source: 'outfit_feedback', userId: 'u1',
    outfitId: 'o1', rating: 5, comment: 'great', itemIds: ['w1', 'w2', 'w3'],
  });

  assert.equal(result.duplicate, false);
  assert.equal(db.feedback.length, 2, 'legacy row preserved, new row appended');

  const legacy = db.feedback[0];
  assert.deepEqual(
    { outfitId: legacy.outfitId, rating: legacy.rating, comment: legacy.comment, userId: legacy.userId, at: legacy.at },
    { outfitId: 'o1', rating: 4, comment: 'nice', userId: 'u1', at: '2025-11-01T10:00:00.000Z' },
    'legacy feedback row untouched',
  );

  const row = db.feedback[1];
  assert.equal(row.outfitId, 'o1');
  assert.equal(row.rating, 5);
  assert.equal(row.comment, 'great');
  assert.equal(row.userId, 'u1');
  assert.match(row.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(row.id, /^fb_rating_/);
  assert.equal(row.type, 'rating');
  assert.equal(row.source, 'outfit_feedback');

  // The learning payload the endpoint builds from `result.memory` still has
  // every field the pre-§4 response had.
  const m = result.memory;
  assert.equal(typeof memoryStore.confidence(m), 'number');
  assert.equal(typeof m.totals.ratings, 'number');
  assert.equal(typeof m.totals.chats, 'number');
  assert.ok(Array.isArray(Object.entries(m.colors).map(([label, value]) => ({ label, value: Number(value.toFixed(3)) }))));
  assert.ok(Array.isArray(m.facts.slice(0, 3).map((f) => f.text)));
});

// ------------------------------------------------------------------- Test B

test('B — recommendation history is persisted and readable', () => {
  const db = makeDb();

  const written = history.recordShown(db, {
    userId: 'u1', occasion: 'casual', tempC: 24, source: 'GET /outfits/recommended',
    outfits: [shownOutfit('gen-1-0', ['w1', 'w2', 'w3']), shownOutfit('gen-1-1', ['w1', 'w3'])],
  });

  assert.equal(written.length, 2, 'one row per shown outfit');
  const rows = history.listFor(db, 'u1');
  assert.equal(rows.length, 2);

  const row = rows[0];
  assert.deepEqual(Object.keys(row).sort(), [...HISTORY_KEYS].sort(), 'compact row: no wardrobe copies, no embeddings');
  assert.equal(row.userId, 'u1');
  assert.match(row.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(row.occasion, 'casual');
  assert.equal(row.tempC, 24);
  assert.equal(row.outfitId, 'gen-1-0');
  assert.deepEqual(row.itemIds, ['w1', 'w2', 'w3']);
  assert.equal(row.match, 71);
  assert.equal(row.interacted, null);

  const found = history.findForOutfit(db, 'u1', 'gen-1-1');
  assert.ok(found, 'shown outfit can be looked up later');
  assert.deepEqual(found.itemIds, ['w1', 'w3']);

  // An empty recommendation shows nothing and stores nothing.
  assert.equal(history.recordShown(db, { userId: 'u1', outfits: [] }).length, 0);
  assert.equal(history.recordShown(db, { userId: 'u1', outfits: [{ id: 'gen-empty', itemIds: [] }] }).length, 0);
  assert.equal(db.recommendationHistory.length, 2);

  // Retention: bounded per user, oldest rows dropped first.
  for (let i = 0; i < history.MAX_PER_USER + 5; i += 1) {
    history.recordShown(db, { userId: 'u1', outfits: [shownOutfit(`gen-x-${i}`, ['w1'])] });
  }
  assert.equal(history.listFor(db, 'u1', 1000).length, history.MAX_PER_USER);
  assert.ok(!history.listFor(db, 'u1', 1000).some((r) => r.outfitId === 'gen-x-0'), 'oldest row evicted');
});

// ------------------------------------------------------------------- Test C

test('C — feedback and history are user-scoped', () => {
  const db = makeDb();
  db.users.push({ id: 'u2', name: 'Mona', email: 'm@x.com', styleProfile: structuredClone(EXPLICIT_PROFILE) });

  history.recordShown(db, { userId: 'u1', occasion: 'casual', outfits: [shownOutfit('gen-a', ['w1'])] });

  // Another user sees none of it.
  assert.equal(history.listFor(db, 'u2').length, 0);
  assert.equal(history.findForOutfit(db, 'u2', 'gen-a'), null, 'no cross-user outfit lookup');
  assert.equal(history.findForOutfit(db, 'u1', 'gen-a').outfitId, 'gen-a');
  assert.equal(history.markInteracted(db, { userId: 'u2', outfitId: 'gen-a', type: 'rating' }), null,
    'u2 cannot stamp u1\'s history row');

  // Feedback resolves items only for its own user: u2 rating a generated id
  // u1 was shown gets zero garments (and therefore learns nothing about them).
  const forU2 = history.applyFeedback(db, {
    type: 'rating', userId: 'u2', outfitId: 'gen-a', rating: 1, comment: '',
  });
  assert.equal(forU2.items.length, 0);
  assert.equal(history.findForOutfit(db, 'u2', 'gen-a'), null);

  // u1 gets the attribution and the learning.
  const forU1 = history.applyFeedback(db, {
    type: 'rating', userId: 'u1', outfitId: 'gen-a', rating: 5, comment: '',
  });
  assert.equal(forU1.items.length, 1);
  assert.deepEqual(forU1.items.map((i) => i.id), ['w1']);

  // Memories are separate per user.
  const m1 = memoryStore.read(db, 'u1');
  const m2 = memoryStore.read(db, 'u2');
  assert.notEqual(learnedProjection(m1), learnedProjection(m2));
  assert.equal(m2.totals.ratings, 1, 'u2 recorded its own (item-less) rating');
  assert.equal(m1.totals.ratings, 1, 'u1 recorded its own');
});

// ------------------------------------------------------------------- Test D

test('D — positive feedback increases learned affinity', () => {
  const db = makeDb();
  const before = affinityFor(db, 'u1', SHIRT);

  const result = history.applyFeedback(db, {
    type: 'rating', userId: 'u1', outfitId: 'o1', rating: 5, comment: 'love it',
    itemIds: ['w1', 'w2', 'w3'],
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.learnError, null);
  const after = affinityFor(db, 'u1', SHIRT);
  assert.ok(after > before, `affinity must rise: ${before} -> ${after}`);
  assert.ok(after > 0.5);
  assert.equal(result.memory.totals.ratings, 1);

  // A favourite is the same strength as a 5-star rating (documented scale).
  const db2 = makeDb();
  history.applyFeedback(db2, { type: 'favorite', userId: 'u1', outfitId: 'o1', rating: 5, comment: '', itemIds: ['w1'] });
  assert.ok(affinityFor(db2, 'u1', SHIRT) > 0.5, 'favourite lifts affinity');
});

// ------------------------------------------------------------------- Test E

test('E — negative feedback decreases learned affinity', () => {
  const db = makeDb();
  const before = affinityFor(db, 'u1', SHIRT);

  const result = history.applyFeedback(db, {
    type: 'rating', userId: 'u1', outfitId: 'o1', rating: 1, comment: 'never again',
    itemIds: ['w1', 'w2', 'w3'],
  });

  assert.equal(result.learnError, null);
  const after = affinityFor(db, 'u1', SHIRT);
  assert.ok(after < before, `affinity must fall: ${before} -> ${after}`);
  assert.ok(after < 0.5);

  // Neutral ratings are recorded but move nothing (existing §9 semantics).
  const db2 = makeDb();
  const neutral = history.applyFeedback(db2, {
    type: 'rating', userId: 'u1', outfitId: 'o1', rating: 3, comment: '', itemIds: ['w1'],
  });
  assert.equal(neutral.memory.totals.ratings, 0, 'rating 3 is not a preference signal');
  assert.ok(Math.abs(affinityFor(db2, 'u1', SHIRT) - 0.5) < 1e-9);
});

// ------------------------------------------------------------------- Test F

test('F — explicit profile preferences remain unchanged after learning', () => {
  const db = makeDb();
  const before = JSON.stringify(db.users[0].styleProfile);

  history.applyFeedback(db, { type: 'rating', userId: 'u1', outfitId: 'o1', rating: 5, comment: 'more formal please', itemIds: ['w1'] });
  history.applyFeedback(db, { type: 'rating', userId: 'u1', outfitId: 'o1', rating: 1, comment: '', itemIds: ['w2'] });
  history.applyFeedback(db, { type: 'favorite', userId: 'u1', outfitId: 'o1', rating: 5, comment: '', itemIds: ['w3'] });

  assert.equal(JSON.stringify(db.users[0].styleProfile), before, 'styleProfile byte-identical');
  // The learned record is a different object store entirely.
  assert.ok(Array.isArray(db.styleMemories) && db.styleMemories.length === 1);
  assert.equal(db.styleMemories[0].userId, 'u1');
  assert.ok(db.styleMemories[0].colors, 'learned colours live in StyleMemory, not in the profile');
});

// ------------------------------------------------------------------- Test G

test('G — duplicate feedback does not multiply the learning signal', () => {
  const db = makeDb();
  const payload = {
    type: 'rating', userId: 'u1', outfitId: 'o1', rating: 5, comment: 'great', itemIds: ['w1', 'w2'],
  };

  const first = history.applyFeedback(db, payload);
  const snapshot = learnedProjection(first.memory);
  const feedbackCount = db.feedback.length;

  const second = history.applyFeedback(db, payload);
  const third = history.applyFeedback(db, payload);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(third.duplicate, true);
  assert.equal(second.id, first.id, 'stable event id');
  assert.equal(db.feedback.length, feedbackCount, 'no extra rows');
  assert.equal(learnedProjection(second.memory), snapshot, 'memory unchanged by the retry');
  assert.equal(learnedProjection(third.memory), snapshot);
  assert.equal(second.memory.totals.ratings, 1);

  // Different payload, same day → a distinct event that does learn.
  const different = history.applyFeedback(db, { ...payload, rating: 4 });
  assert.equal(different.duplicate, false);
  assert.equal(db.feedback.length, feedbackCount + 1);

  // Favourites are idempotent too (double tap on the toggle).
  const fav = { type: 'favorite', userId: 'u1', outfitId: 'o1', rating: 5, comment: '', itemIds: ['w1'] };
  const f1 = history.applyFeedback(db, fav);
  const f2 = history.applyFeedback(db, fav);
  assert.equal(f1.duplicate, false);
  assert.equal(f2.duplicate, true);
  assert.equal(f2.memory.totals.ratings, f1.memory.totals.ratings, 'favourite re-applied adds nothing');
});

// ------------------------------------------------------------------- Test H

test('H — missing / legacy / malformed db.json fields do not crash', () => {
  // 1. A legacy database with none of the §4 arrays (and no StyleMemory array).
  const legacy = { users: [], wardrobe: [structuredClone(SHIRT)], outfits: [] };
  assert.equal(history.recordShown(legacy, { userId: 'u1', outfits: [shownOutfit('g1', ['w1'])] }).length, 1);
  assert.ok(Array.isArray(legacy.recommendationHistory));
  const r1 = history.applyFeedback(legacy, { type: 'rating', userId: 'u1', outfitId: 'g1', rating: 5, comment: '' });
  assert.equal(r1.duplicate, false);
  assert.ok(Array.isArray(legacy.feedback));
  assert.equal(r1.memory.totals.ratings, 1);

  // 2. The seed's legacy `styleMemory` (singular) row — never read by
  //    style-memory.js, must not disturb anything.
  const seeded = makeDb({
    styleMemory: [{ userId: 'u_demo', preference: 'neutral_colors', value: 0.91, confidence: 0.87, source: 'outfit_feedback' }],
  });
  delete seeded.styleMemories;
  const r2 = history.applyFeedback(seeded, { type: 'rating', userId: 'u1', outfitId: 'o1', rating: 5, comment: '', itemIds: ['w1'] });
  assert.equal(r2.learnError, null);
  assert.ok(r2.memory.colors);

  // 3. Malformed StyleMemory row (partial/legacy fields): the learner fails
  //    safely, the event is still recorded, and the response payload the
  //    endpoint builds cannot throw.
  const broken = makeDb({
    styleMemories: [{ userId: 'u1', colors: null, facts: null, totals: null, avoid: null, itemRatings: null }],
  });
  const r3 = history.applyFeedback(broken, { type: 'rating', userId: 'u1', outfitId: 'o1', rating: 5, comment: 'ok', itemIds: ['w1'] });
  assert.equal(r3.duplicate, false, 'event still recorded when learning fails');
  assert.equal(typeof r3.learnError, 'string');
  assert.deepEqual(r3.memory.colors, {}, 'response view is sanitised');
  assert.ok(Array.isArray(r3.memory.facts));
  assert.equal(broken.feedback.length, 1);

  // The exact response-building expressions used by server.js.
  const m = r3.memory;
  assert.doesNotThrow(() => ({
    confidence: memoryStore.confidence(m),
    ratings: m.totals.ratings,
    signals: m.totals.chats,
    palette: Object.entries(m.colors)
      .sort((a, b) => Math.abs(b[1] - 0.5) - Math.abs(a[1] - 0.5))
      .slice(0, 5)
      .map(([label, value]) => ({ label, value: Number(value.toFixed(3)) })),
    notes: m.facts.slice(0, 3).map((f) => f.text),
  }));

  // 4. Junk rows inside the arrays are skipped, not fatal.
  const junk = makeDb({ feedback: [null, 42, { nope: true }], recommendationHistory: [undefined, 'x'] });
  assert.equal(history.findFeedback(junk, 'fb_rating_zzz'), null);
  assert.equal(history.findForOutfit(junk, 'u1', 'missing'), null);
  assert.equal(history.recordShown(junk, { userId: 'u1', outfits: [null, 'nope', shownOutfit('g2', ['w1'])] }).length, 1);

  // 5. Missing wardrobe / missing outfit / unknown rating type.
  const empty = { users: [] };
  const r4 = history.applyFeedback(empty, { type: 'rating', userId: null, outfitId: 'ghost', rating: 'abc', comment: '' });
  assert.equal(r4.items.length, 0);
  assert.equal(r4.memory.totals.ratings, 0, 'junk rating is not a preference signal');
});

// ------------------------------------------------------------------- Test I

test('I — empty history is a working state', () => {
  const db = makeDb();
  assert.deepEqual(history.listFor(db, 'u1'), []);
  assert.equal(history.findForOutfit(db, 'u1', 'gen-none'), null);
  assert.equal(history.markInteracted(db, { userId: 'u1', outfitId: 'gen-none', type: 'rating' }), null);
  assert.deepEqual(history.resolveItemIds(db, { userId: 'u1', outfitId: 'gen-none' }), []);

  // Feedback with no history behind it still behaves like the legacy
  // endpoint: recorded, answered, no crash.
  const result = history.applyFeedback(db, {
    type: 'rating', userId: 'u1', outfitId: 'gen-none', rating: 4, comment: '',
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.items.length, 0);
  assert.equal(result.memory.totals.ratings, 1);
  assert.equal(db.feedback.length, 1);
  assert.equal(db.recommendationHistory.length, 0, 'no phantom history invented');

  // …and a history row that HAS been shown can be stamped afterwards.
  history.recordShown(db, { userId: 'u1', outfits: [shownOutfit('gen-hit', ['w1', 'w2'])] });
  const linked = history.applyFeedback(db, { type: 'rating', userId: 'u1', outfitId: 'gen-hit', rating: 5, comment: '' });
  assert.equal(linked.items.length, 2, 'itemIds recovered from history');
  const row = history.findForOutfit(db, 'u1', 'gen-hit');
  assert.deepEqual(row.interacted, { type: 'rating', at: row.interacted.at });
  assert.match(row.interacted.at, /^\d{4}-\d{2}-\d{2}T/);
});

// ------------------------------------------------------------------- Test J

test('J — §3 recommendation generation still works after the integration', async () => {
  const db = makeDb();

  // Feedback arrives first, history is written, then the engine runs on the
  // exact inputs server.js passes it.
  history.recordShown(db, { userId: 'u1', occasion: 'casual', tempC: 24, outfits: [shownOutfit('gen-0', ['w1', 'w2', 'w3'])] });
  history.applyFeedback(db, { type: 'rating', userId: 'u1', outfitId: 'gen-0', rating: 5, comment: '', itemIds: ['w1', 'w2', 'w3'] });

  const { outfits, meta } = await engine.recommend(db.wardrobe, {
    occasion: 'casual',
    weather: { tempC: 24, condition: 'partly cloudy' },
    count: 3,
    styleProfile: db.users[0].styleProfile,
    memory: memoryStore.read(db, 'u1'),
  });

  assert.ok(outfits.length >= 1, 'engine still produces recommendations');
  for (const o of outfits) {
    assert.ok(o.itemIds.length >= 2);
    assert.ok(Number.isFinite(o.match) && o.match > 0 && o.match <= 100);
  }
  assert.equal(meta.engine, 'recommendation-engine');
  assert.equal(meta.returned, outfits.length);

  // History rows themselves must not leak into ranking: the same call with
  // §4 history present but no learned memory returns byte-identical
  // recommendations to a database that never saw §4 at all.
  const opts = () => ({
    occasion: 'casual',
    weather: { tempC: 24, condition: 'partly cloudy' },
    count: 3,
    styleProfile: structuredClone(EXPLICIT_PROFILE),
    memory: memoryStore.empty('u1'),
  });
  const withHistory = makeDb();
  history.recordShown(withHistory, { userId: 'u1', occasion: 'casual', tempC: 24, outfits: [shownOutfit('gen-77', ['w1', 'w2', 'w3'])] });
  const a = await engine.recommend(structuredClone(withHistory.wardrobe), opts());
  const b = await engine.recommend(structuredClone(makeDb().wardrobe), opts());
  assert.deepEqual(
    a.outfits.map((o) => ({ ids: o.itemIds, match: o.match })),
    b.outfits.map((o) => ({ ids: o.itemIds, match: o.match })),
    'persisted history does not change ranking',
  );

  // §3 scoring weights are untouched by §4.
  assert.deepEqual({ ...engine.SCORE_WEIGHTS }, {
    compatibility: 0.45,
    retrieval_relevance: 0.2,
    profile_match: 0.15,
    freshness: 0.1,
    learned_affinity: 0.1,
  });

  // The learned memory only moves the documented learned_affinity component;
  // it never changes the explicit profile_match inputs.
  const learned = memoryStore.read(db, 'u1');
  assert.equal(JSON.stringify(db.users[0].styleProfile), JSON.stringify(EXPLICIT_PROFILE),
    'ranking inputs: explicit profile untouched by §4 signals');
  assert.equal(learned.totals.ratings, 1, 'learned memory carries the signal instead');
});

// ------------------------------------------------------------------- Test L

test('L — identical inputs and identical events are deterministic', async () => {
  const runOnce = () => {
    const db = makeDb();
    history.recordShown(db, { userId: 'u1', occasion: 'casual', tempC: 24, outfits: [shownOutfit('gen-9', ['w1', 'w2'])] });
    const a = history.applyFeedback(db, { type: 'rating', userId: 'u1', outfitId: 'gen-9', rating: 5, comment: 'solid', itemIds: ['w1', 'w2'] });
    const b = history.applyFeedback(db, { type: 'rating', userId: 'u1', outfitId: 'gen-9', rating: 5, comment: 'solid', itemIds: ['w1', 'w2'] });
    const fav = history.applyFeedback(db, { type: 'favorite', userId: 'u1', outfitId: 'gen-9', rating: 5, comment: '', itemIds: ['w1'] });
    return {
      projection: learnedProjection(a.memory),
      afterDuplicate: learnedProjection(b.memory),
      afterFavorite: learnedProjection(fav.memory),
      feedbackRows: db.feedback.map((f) => f.id),
      eventIds: [a.id, b.id, fav.id],
      historyRows: db.recommendationHistory.map((r) => ({ outfitId: r.outfitId, itemIds: r.itemIds, userId: r.userId, interacted: r.interacted && r.interacted.type })),
    };
  };

  const one = runOnce();
  const two = runOnce();
  assert.deepEqual(one, two, 'two independent runs must agree exactly');

  // A duplicate never changes the learned state.
  assert.equal(one.afterDuplicate, one.projection);

  // Same input memory → same engine output (§3 determinism survives §4).
  const opts = () => ({
    occasion: 'casual',
    weather: { tempC: 24, condition: 'partly cloudy' },
    count: 3,
    styleProfile: structuredClone(EXPLICIT_PROFILE),
    memory: memoryStore.empty('u1'),
  });
  const a = await engine.recommend(structuredClone(makeDb().wardrobe), opts());
  const b = await engine.recommend(structuredClone(makeDb().wardrobe), opts());
  assert.deepEqual(
    a.outfits.map((o) => ({ ids: o.itemIds, match: o.match, name: o.name, why: o.explanation })),
    b.outfits.map((o) => ({ ids: o.itemIds, match: o.match, name: o.name, why: o.explanation })),
  );
});
