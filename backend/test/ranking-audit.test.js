/**
 * Phase 2 ranking audit — focused tests for the repaired recommendation factors.
 *
 * These pin the four defects found while auditing the §3 ranking:
 *   B  retrieval_relevance must not run on the automatic Home path, where the
 *      default occasion was being scored as if it were a real request.
 *   C  profile_match must judge only the dimensions the profile declares.
 *   D  learned_affinity (and style-memory.itemAffinity) must average only the
 *      pieces that actually carry an opinion, not dilute toward a neutral 50.
 *   E  freshness must read last-worn recency only, over core slots, so basics
 *      and the timesWorn signal already used by scoring.recent_usage are not
 *      counted twice.
 *
 * The Phase 1 score contract is re-asserted here for the query path:
 *   compatibilityScore is the displayed 11-factor match, rankingScore drives
 *   the order, and match stays an alias of compatibilityScore.
 *
 * Run from backend/:  node --test test/ranking-audit.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../src/recommendation-engine');
const memoryStore = require('../src/style-memory');
const scoring = require('../src/scoring');

function item(spec) {
  return {
    image: 'assets/images/item.jpg',
    pattern: 'Plain',
    material: 'Cotton',
    season: 'All Season',
    timesWorn: 4,
    lastWornLabel: 'Worn 5 days ago',
    ...spec,
  };
}

const EMPTY_PROFILE = { favoriteColors: [], preferredStyles: [], avoidedColors: [] };

function baseWardrobe() {
  return [
    item({ id: 't1', name: 'Oxford Cotton Shirt', category: 'Tops', color: 'White', style: 'Casual', formality: 'Casual' }),
    item({ id: 't2', name: 'Beige Knit Sweater', category: 'Tops', color: 'Beige', style: 'Smart Casual', formality: 'Smart Casual', material: 'Merino Wool' }),
    item({ id: 'b1', name: 'Raw Denim Jeans', category: 'Bottoms', color: 'Indigo', style: 'Casual', formality: 'Casual', material: 'Denim' }),
    item({ id: 's1', name: 'Minimalist Sneakers', category: 'Shoes', color: 'White', style: 'Minimal', formality: 'Casual' }),
    item({ id: 'a1', name: 'Minimalist Leather Belt', category: 'Accessories', color: 'Tan', style: 'Minimal', formality: 'Casual' }),
  ];
}

function scoreCtx(extra = {}) {
  return { styleProfile: EMPTY_PROFILE, memory: memoryStore.empty(), ...extra };
}

// --------------------------------------------------------- B. retrieval gating

test('B1 — the automatic Home path does not request retrieval', async () => {
  const { meta } = await engine.recommend(baseWardrobe(), {
    occasion: 'casual',
    weather: { tempC: 22 },
    count: 3,
    month: 5,
    styleProfile: EMPTY_PROFILE,
  });

  assert.equal(meta.retrieval, 'not_requested',
    'no request query was supplied, so retrieval must be reported as not requested');
  assert.ok(!meta.activeComponents.includes('retrieval_relevance'),
    `retrieval must stay out of the automatic ranking (active: ${meta.activeComponents.join(', ')})`);
});

test('B2 — an explicit request query activates retrieval', async () => {
  const { meta } = await engine.recommend(baseWardrobe(), {
    occasion: 'casual',
    weather: { tempC: 22 },
    count: 3,
    month: 5,
    styleProfile: EMPTY_PROFILE,
    retrievalQuery: 'white shirt denim',
  });

  assert.notEqual(meta.retrieval, 'not_requested', 'a real query must be attempted');
  if (meta.retrieval === 'ok') {
    assert.ok(meta.activeComponents.includes('retrieval_relevance'),
      'a query that produced scores must take part in the ranking');
  }
});

test('B3 — retrieval does not count when the map is empty or zero-scored', () => {
  const outfit = { match: 80, items: baseWardrobe() };
  const none = engine.scoreCandidate(outfit, scoreCtx());
  assert.equal(none.components.retrieval_relevance.applied, false);

  const zero = engine.scoreCandidate(outfit, scoreCtx({
    retrievalMap: { scores: new Map([['t1', 0], ['b1', 0]]), max: 0 },
  }));
  assert.equal(zero.components.retrieval_relevance.applied, false, 'a zero max is not a signal');
});

// ------------------------------------------------------- C. profile_match scope

test('C1 — a colours-only profile can reach 100 on matching pieces', () => {
  const white = [
    item({ id: 'w1', name: 'White Tee', category: 'Tops', color: 'White', style: 'Formal' }),
    item({ id: 'w2', name: 'White Trousers', category: 'Bottoms', color: 'White', style: 'Formal' }),
    item({ id: 'w3', name: 'White Sneakers', category: 'Shoes', color: 'White', style: 'Formal' }),
  ];
  const { components } = engine.scoreCandidate(
    { match: 80, items: white },
    scoreCtx({ styleProfile: { favoriteColors: ['White'], preferredStyles: [], avoidedColors: [] } }),
  );
  assert.equal(components.profile_match.value, 100,
    'style is not declared, so it must not be charged against a colours-only profile');
});

test('C2 — a styles-only profile can reach 100 on matching pieces', () => {
  const casual = [
    item({ id: 'c1', name: 'Casual Top', category: 'Tops', color: 'Orange', style: 'Casual' }),
    item({ id: 'c2', name: 'Casual Bottom', category: 'Bottoms', color: 'Orange', style: 'Casual' }),
    item({ id: 'c3', name: 'Casual Shoes', category: 'Shoes', color: 'Orange', style: 'Casual' }),
  ];
  const { components } = engine.scoreCandidate(
    { match: 80, items: casual },
    scoreCtx({ styleProfile: { favoriteColors: [], preferredStyles: ['Casual'], avoidedColors: [] } }),
  );
  assert.equal(components.profile_match.value, 100,
    'colour is not declared, so it must not be charged against a styles-only profile');
});

test('C3 — profile_match stays silent with no declared preferences', () => {
  const { components } = engine.scoreCandidate(
    { match: 80, items: baseWardrobe() },
    scoreCtx(),
  );
  assert.equal(components.profile_match.applied, false);
  assert.equal(components.profile_match.value, 0);
});

test('C4 — a partial match is scored over declared dimensions, not doubled', () => {
  const items = [
    item({ id: 'n1', name: 'Navy Top', category: 'Tops', color: 'Navy', style: 'Casual' }),
    item({ id: 'n2', name: 'Grey Bottom', category: 'Bottoms', color: 'Grey', style: 'Casual' }),
    item({ id: 'n3', name: 'White Shoes', category: 'Shoes', color: 'White', style: 'Casual' }),
  ];
  const { components } = engine.scoreCandidate(
    { match: 80, items },
    scoreCtx({ styleProfile: { favoriteColors: ['Navy'], preferredStyles: [], avoidedColors: [] } }),
  );
  assert.equal(components.profile_match.value, 33, 'one matching colour out of three declared checks');
});

// --------------------------------------------------- D. learned_affinity scope

test('D1 — learned_affinity averages only the pieces that carry an opinion', () => {
  const mem = memoryStore.empty();
  mem.colors.navy = 0.9;

  const items = [
    item({ id: 'n1', name: 'Navy Top', category: 'Tops', color: 'Navy', style: 'Casual' }),
    item({ id: 'g1', name: 'Grey Bottom', category: 'Bottoms', color: 'Grey', style: 'Casual' }),
    item({ id: 'w1', name: 'White Shoes', category: 'Shoes', color: 'White', style: 'Minimal' }),
  ];
  const { components } = engine.scoreCandidate({ match: 80, items }, scoreCtx({ memory: mem }));

  assert.equal(components.learned_affinity.applied, true);
  assert.equal(components.learned_affinity.value, 90,
    'the un-opinionated pieces must not pull a strong navy opinion back toward 50');
});

test('D2 — learned_affinity is neutral (not applied) when nothing applies', () => {
  const mem = memoryStore.empty();
  mem.colors.navy = 0.9;
  const { components } = engine.scoreCandidate(
    { match: 80, items: [item({ id: 'w1', name: 'White Top', category: 'Tops', color: 'White', style: 'Casual' })] },
    scoreCtx({ memory: mem }),
  );
  assert.equal(components.learned_affinity.applied, false);
});

test('D3 — itemAffinity is evidence-only and neutral with no evidence', () => {
  const mem = memoryStore.empty();
  mem.colors.navy = 0.9;

  assert.equal(memoryStore.itemAffinity(mem, { id: 'n', color: 'Navy', style: 'Casual', material: 'Cotton' }), 0.9,
    'a single matching colour opinion is returned as-is');
  assert.equal(memoryStore.itemAffinity(mem, { id: 'w', color: 'White', style: 'Casual', material: 'Cotton' }), 0.5,
    'an item with no matching opinion stays neutral');
  assert.equal(memoryStore.itemAffinity(memoryStore.empty(), { id: 'n', color: 'Navy' }), 0.5,
    'an empty memory is neutral');
});

test('D4 — a formality lean varies per item instead of pinning a constant', () => {
  const mem = memoryStore.empty();
  mem.occasions.formal = 0.8; // "make it dressier"

  const relaxed = memoryStore.itemAffinity(mem, { id: 'r', color: 'Grey', style: 'Casual', category: 'Tops', formality: 'Casual' });
  const dressy = memoryStore.itemAffinity(mem, { id: 'd', color: 'Grey', style: 'Casual', category: 'Tops', formality: 'Formal' });
  assert.ok(dressy > relaxed,
    `a formality lean must reward the dressier piece (relaxed ${relaxed}, dressy ${dressy})`);
});

// ------------------------------------------------------- E. freshness recency

test('E1 — freshness reads recency only, not timesWorn', () => {
  const fresh = engine.freshnessOf(item({ id: 'x', category: 'Tops', lastWornLabel: 'Worn 3 days ago', timesWorn: 0 }));
  const heavily = engine.freshnessOf(item({ id: 'y', category: 'Tops', lastWornLabel: 'Worn 3 days ago', timesWorn: 40 }));
  assert.equal(fresh, heavily, 'the same last-worn date must score the same regardless of wear count');
});

test('E2 — freshness stays neutral when there is no usable label', () => {
  const noLabel = engine.freshnessOf({ id: 'x', category: 'Tops', timesWorn: 9, lastWornLabel: '' });
  assert.equal(noLabel, 60);
});

test('E3 — freshness is averaged over core slots, so basics do not penalise it', () => {
  const top = item({ id: 'top', category: 'Tops', lastWornLabel: 'Unworn for 60+ days' });
  const bottom = item({ id: 'bottom', category: 'Bottoms', lastWornLabel: 'Unworn for 60+ days' });

  const shoeToday = item({ id: 'shoe', category: 'Shoes', lastWornLabel: 'Worn today' });
  const shoeOld = item({ id: 'shoe', category: 'Shoes', lastWornLabel: 'Worn 40 days ago' });

  const a = engine.scoreCandidate({ match: 80, items: [top, bottom, shoeToday] }, scoreCtx())
    .components.freshness.value;
  const b = engine.scoreCandidate({ match: 80, items: [top, bottom, shoeOld] }, scoreCtx())
    .components.freshness.value;

  assert.equal(a, b, 'shoe wear must not move the freshness signal');
  assert.equal(a, 100, 'only the two core pieces are averaged');
});

// --------------------------------------------- normalisation + phase 1 contract

test('N1 — applied component weights renormalise to 1 with no NaN', () => {
  const { components, score } = engine.scoreCandidate(
    { match: 80, items: baseWardrobe() },
    scoreCtx(),
  );
  const applied = Object.values(components).filter((c) => c.applied);
  assert.ok(applied.length >= 1);
  const total = applied.reduce((sum, c) => sum + c.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-3, `applied weights must sum to 1 (got ${total})`);
  assert.ok(Number.isFinite(score) && score >= 0 && score <= 100);
  for (const c of Object.values(components)) {
    assert.ok(Number.isFinite(c.value) && Number.isFinite(c.weight));
  }
});

test('N2 — ranking is best-first and keeps the Phase 1 score contract', async () => {
  const { outfits } = await engine.recommend(baseWardrobe(), {
    occasion: 'casual',
    weather: { tempC: 22, condition: 'partly cloudy' },
    count: 3,
    month: 5,
    styleProfile: { favoriteColors: ['White'], preferredStyles: ['Casual'], avoidedColors: [] },
    memory: memoryStore.empty(),
    retrievalQuery: 'casual white outfit',
  });

  assert.ok(outfits.length >= 2, 'enough looks to check ordering');
  const ranking = outfits.map((o) => o.rankingScore);
  for (let i = 1; i < ranking.length; i += 1) {
    assert.ok(ranking[i - 1] >= ranking[i], `best-first by rankingScore: ${ranking.join(',')}`);
  }
  for (const outfit of outfits) {
    assert.equal(outfit.match, outfit.compatibilityScore,
      'match stays an alias of the displayed compatibility score');
    const recomputed = scoring.scoreOutfit(outfit.items, {
      occasion: 'casual',
      weather: { tempC: 22, condition: 'partly cloudy' },
      styleProfile: { favoriteColors: ['White'], preferredStyles: ['Casual'], avoidedColors: [] },
      memory: memoryStore.empty(),
      month: 5,
    }).match;
    assert.equal(outfit.compatibilityScore, recomputed,
      'compatibilityScore still equals the 11-factor score of the same items');
  }

  const keys = outfits.map((o) => o.itemIds.slice().sort().join('|'));
  assert.equal(new Set(keys).size, outfits.length, 'no duplicate outfits');
});
