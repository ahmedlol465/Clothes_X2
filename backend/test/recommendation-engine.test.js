/**
 * Focused behaviour tests for the Recommendation Engine (§3).
 *
 * Dependency-free on purpose: they run on `node --test` with no installed
 * packages, so they can be executed in any checkout with:
 *
 *     node --test test/recommendation-engine.test.js     (from backend/)
 *
 * Every test asserts observable behaviour of `recommend()` — what comes out —
 * rather than internal bookkeeping.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../src/recommendation-engine');
const tax = require('../src/taxonomy');
const scoring = require('../src/scoring');
const memoryStore = require('../src/style-memory');

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
    item({ id: 't3', name: 'Minimalist Tee', category: 'Tops', color: 'Black', style: 'Minimal', formality: 'Casual' }),
    item({ id: 'b1', name: 'Raw Denim Jeans', category: 'Bottoms', color: 'Indigo', style: 'Casual', formality: 'Casual', material: 'Denim' }),
    item({ id: 'b2', name: 'Relaxed Chinos', category: 'Bottoms', color: 'Beige', style: 'Casual', formality: 'Casual' }),
    item({ id: 's1', name: 'Minimalist Sneakers', category: 'Shoes', color: 'White', style: 'Minimal', formality: 'Casual' }),
    item({ id: 's2', name: 'Leather Loafers', category: 'Shoes', color: 'Brown', style: 'Classic', formality: 'Formal', material: 'Leather' }),
    item({ id: 'a1', name: 'Minimalist Leather Belt', category: 'Accessories', color: 'Tan', style: 'Minimal', formality: 'Casual' }),
  ];
}

function preferenceWardrobe() {
  return [
    item({ id: 'tNavy', name: 'Navy Oxford Shirt', category: 'Tops', color: 'Navy', style: 'Casual', formality: 'Casual', timesWorn: 10, lastWornLabel: 'Worn 2 days ago' }),
    item({ id: 'tOrange', name: 'Orange Cotton Tee', category: 'Tops', color: 'Orange', style: 'Casual', formality: 'Casual', timesWorn: 0, lastWornLabel: 'Unworn for 60+ days' }),
    item({ id: 'bG', name: 'Grey Trousers', category: 'Bottoms', color: 'Grey', style: 'Casual', formality: 'Casual' }),
    item({ id: 'sB', name: 'Black Sneakers', category: 'Shoes', color: 'Black', style: 'Casual', formality: 'Casual' }),
  ];
}

function weatherWardrobe() {
  return [
    item({ id: 'tWarm', name: 'Quilted Down Sweater', category: 'Tops', color: 'White', style: 'Casual', formality: 'Casual', material: 'Down' }),
    item({ id: 'tCool', name: 'Linen Beach Top', category: 'Tops', color: 'White', style: 'Casual', formality: 'Casual', material: 'Linen' }),
    item({ id: 'bG', name: 'Grey Trousers', category: 'Bottoms', color: 'Grey', style: 'Casual', formality: 'Casual' }),
    item({ id: 'sW', name: 'White Sneakers', category: 'Shoes', color: 'White', style: 'Casual', formality: 'Casual' }),
  ];
}

function occasionWardrobe() {
  return [
    item({ id: 'fTop', name: 'White Formal Shirt', category: 'Tops', color: 'White', style: 'Formal', formality: 'Formal' }),
    item({ id: 'cTop', name: 'Cotton Hoodie', category: 'Tops', color: 'Grey', style: 'Casual', formality: 'Casual', material: 'Fleece' }),
    item({ id: 'fBot', name: 'Tailored Trousers', category: 'Bottoms', color: 'Charcoal', style: 'Formal', formality: 'Formal', material: 'Wool Blend' }),
    item({ id: 'cBot', name: 'Denim Shorts', category: 'Bottoms', color: 'Indigo', style: 'Casual', formality: 'Casual', material: 'Denim' }),
    item({ id: 'fShoe', name: 'Leather Loafers', category: 'Shoes', color: 'Brown', style: 'Classic', formality: 'Formal', material: 'Leather' }),
    item({ id: 'cShoe', name: 'Canvas Sneakers', category: 'Shoes', color: 'White', style: 'Casual', formality: 'Casual' }),
  ];
}

// ------------------------------------------------------------------- Test A

test('A — valid profile + wardrobe produces complete recommendations', async () => {
  const { outfits, meta } = await engine.recommend(baseWardrobe(), {
    occasion: 'casual',
    weather: { tempC: 22, condition: 'partly cloudy' },
    count: 3,
    month: 5,
    styleProfile: { favoriteColors: ['White'], preferredStyles: ['Casual'], avoidedColors: [] },
  });

  assert.ok(outfits.length >= 1, 'at least one recommendation is produced');
  assert.equal(meta.returned, outfits.length);
  for (const outfit of outfits) {
    assert.ok(Array.isArray(outfit.itemIds) && outfit.itemIds.length >= 2);
    assert.equal(typeof outfit.name, 'string');
    assert.ok(outfit.match >= 0 && outfit.match <= 100, `match in range: ${outfit.match}`);
    assert.ok(Array.isArray(outfit.pieces) && outfit.pieces.length === outfit.itemIds.length);
    assert.ok(Array.isArray(outfit.breakdown) && outfit.breakdown.length > 0);
    assert.ok(typeof outfit.explanation === 'string' && outfit.explanation.length > 0);
    const categories = new Set(outfit.items.map((i) => i.category));
    for (const required of ['Tops', 'Bottoms', 'Shoes']) {
      assert.ok(categories.has(required), `outfit fills ${required}: ${outfit.itemIds.join(',')}`);
    }
  }
});

// ------------------------------------------------------------------- Test B

test('B — archived wardrobe items never appear in recommendations', async () => {
  const wardrobe = baseWardrobe().map((i) => (i.id === 't1' ? { ...i, archived: true } : i));
  const { outfits, meta } = await engine.recommend(wardrobe, {
    occasion: 'casual',
    weather: { tempC: 22 },
    count: 3,
    month: 5,
    styleProfile: EMPTY_PROFILE,
  });

  assert.ok(outfits.length >= 1, 'the rest of the wardrobe still works');
  for (const outfit of outfits) {
    assert.ok(!outfit.itemIds.includes('t1'), 'archived item leaked into a recommendation');
  }
  assert.equal(meta.constraints.archived, 1, 'the constraint is reported');
});

// ------------------------------------------------------------------- Test C

test('C — a matching preferred colour/style lifts the outfit in the ranking', async () => {
  const run = (favoriteColors) => engine.recommend(preferenceWardrobe(), {
    occasion: 'casual',
    weather: { tempC: 24 },
    count: 2,
    month: 5,
    styleProfile: { favoriteColors, preferredStyles: [], avoidedColors: [] },
  });

  const withNavy = await run(['Navy']);
  const withOrange = await run(['Orange']);

  assert.equal(withNavy.outfits.length, 2, 'both candidates are returned');
  assert.equal(withOrange.outfits.length, 2);
  assert.ok(withNavy.outfits[0].itemIds.includes('tNavy'), 'favourite colour ranks first');
  assert.ok(withOrange.outfits[0].itemIds.includes('tOrange'), 'the other colour wins when it is the favourite');
  assert.notEqual(
    withNavy.outfits.map((o) => o.itemIds.join()).join('/'),
    withOrange.outfits.map((o) => o.itemIds.join()).join('/'),
    'the same wardrobe ranks differently for the two profiles',
  );
});

// ------------------------------------------------------------------- Test D

test('D — an avoided colour is excluded, even when it is also a favourite', async () => {
  const { outfits, meta } = await engine.recommend(preferenceWardrobe(), {
    occasion: 'casual',
    weather: { tempC: 24 },
    count: 3,
    month: 5,
    styleProfile: { favoriteColors: ['Orange'], preferredStyles: [], avoidedColors: ['Orange'] },
  });

  assert.ok(outfits.length >= 1, 'recommendations still exist without the avoided piece');
  for (const outfit of outfits) {
    assert.ok(!outfit.itemIds.includes('tOrange'), 'avoided colour leaked into a recommendation');
  }
  assert.ok(meta.constraints.avoidedColor >= 1, 'the exclusion is reported');

  // Documented relaxation: if the constraint would empty a required slot, the
  // engine falls back rather than returning nothing.
  const onlyOrange = preferenceWardrobe().filter((i) => i.id !== 'tNavy');
  const relaxed = await engine.recommend(onlyOrange, {
    occasion: 'casual',
    weather: { tempC: 24 },
    count: 3,
    month: 5,
    styleProfile: { favoriteColors: [], preferredStyles: [], avoidedColors: ['Orange'] },
  });
  assert.ok(relaxed.outfits.length >= 1, 'an otherwise empty top slot is relaxed');
  assert.ok(relaxed.meta.constraints.relaxedSlots.includes('top'), 'the relaxation is reported');
});

// ------------------------------------------------------------------- Test E

test('E — weather and context change the ranking', async () => {
  const run = (tempC) => engine.recommend(weatherWardrobe(), {
    occasion: 'casual',
    weather: { tempC, condition: tempC >= 26 ? 'clear sky' : 'cloudy' },
    count: 2,
    month: 5,
    styleProfile: EMPTY_PROFILE,
  });

  const cold = await run(6);
  const hot = await run(32);

  assert.equal(cold.outfits.length, 2, 'both candidates survive in both weathers');
  assert.equal(hot.outfits.length, 2);
  assert.ok(cold.outfits[0].itemIds.includes('tWarm'), 'cold weather ranks the warm piece first');
  assert.ok(hot.outfits[0].itemIds.includes('tCool'), 'hot weather ranks the light piece first');

  // Context (occasion) is part of the same contract.
  const formal = await engine.recommend(occasionWardrobe(), {
    occasion: 'formal dinner',
    weather: { tempC: 22 },
    count: 1,
    month: 5,
    styleProfile: EMPTY_PROFILE,
  });
  assert.ok(formal.outfits.length >= 1);
  for (const id of ['fTop', 'fBot', 'fShoe']) {
    assert.ok(formal.outfits[0].itemIds.includes(id), `formal occasion ranks ${id} first`);
  }
  assert.ok(tax.formalityOf(formal.outfits[0].items[0]) >= 3, 'the leading look is a formal one');
});

// ------------------------------------------------------------------- Test F

test('F — returned recommendations are not minor variations of one outfit', async () => {
  const { outfits } = await engine.recommend(baseWardrobe(), {
    occasion: 'casual',
    weather: { tempC: 22 },
    count: 3,
    month: 5,
    styleProfile: EMPTY_PROFILE,
  });

  assert.ok(outfits.length >= 2, 'the wardrobe can produce several looks');
  const keys = outfits.map((o) => o.itemIds.slice().sort().join('|'));
  assert.equal(new Set(keys).size, outfits.length, 'no two recommendations are the same outfit');

  const pick = (outfit, category) => outfit.items.find((i) => i.category === category)?.id;
  const tops = outfits.map((o) => pick(o, 'Tops'));
  const bottoms = outfits.map((o) => pick(o, 'Bottoms'));
  assert.ok(new Set(tops).size >= 2, `recommendations rotate across tops: ${tops.join(',')}`);
  assert.ok(new Set(bottoms).size >= 2, `recommendations rotate across bottoms: ${bottoms.join(',')}`);
});

// ------------------------------------------------------------------- Test G

test('G — empty and insufficient wardrobes fail safely', async () => {
  const empty = await engine.recommend([], {
    occasion: 'casual',
    weather: { tempC: 22 },
    count: 3,
    month: 5,
    styleProfile: EMPTY_PROFILE,
  });
  assert.deepEqual(empty.outfits, []);
  assert.equal(empty.meta.reason, 'empty_wardrobe');

  const allArchived = await engine.recommend(
    baseWardrobe().map((i) => ({ ...i, archived: true })),
    { occasion: 'casual', weather: { tempC: 22 }, count: 3, month: 5 },
  );
  assert.deepEqual(allArchived.outfits, []);

  // Missing optional profile fields must not break anything.
  const noProfile = await engine.recommend(baseWardrobe(), {
    occasion: 'casual',
    weather: undefined,
    count: 2,
    month: 5,
  });
  assert.ok(noProfile.outfits.length >= 1, 'missing styleProfile/weather still works');

  const single = await engine.recommend([baseWardrobe()[0]], {
    occasion: 'casual',
    weather: { tempC: 22 },
    count: 3,
    month: 5,
    styleProfile: EMPTY_PROFILE,
  });
  assert.ok(Array.isArray(single.outfits));
  for (const outfit of single.outfits) {
    assert.ok(outfit.match <= 62, `incomplete outfit is held under the completeness ceiling: ${outfit.match}`);
  }
});

// ------------------------------------------------------------------- Test I

test('I — a stored opinion only activates learned_affinity on outfits it matches', async () => {
  const mem = memoryStore.empty();
  mem.colors.navy = 0.8; // chat-learned "I always wear navy"
  mem.styles.navy = 0.8; // legacy leak of a colour word into styles
  mem.styles.sneakers = 0.2;

  // baseWardrobe has no navy garment at all, so the inherited navy opinion
  // must not activate the learned-affinity component on any of its looks.
  const base = await engine.recommend(baseWardrobe(), {
    occasion: 'casual',
    weather: { tempC: 22 },
    count: 3,
    month: 5,
    styleProfile: EMPTY_PROFILE,
    memory: mem,
  });
  assert.ok(base.outfits.length >= 1);
  assert.ok(
    !base.meta.activeComponents.includes('learned_affinity'),
    `navy memory must not activate learned_affinity on a navy-free wardrobe (active: ${base.meta.activeComponents.join(', ')})`,
  );

  // The same memory, but scoring a candidate that actually contains the navy
  // item: the gate must let it through.
  const navy = await engine.recommend(preferenceWardrobe(), {
    occasion: 'casual',
    weather: { tempC: 24 },
    count: 2,
    month: 5,
    styleProfile: EMPTY_PROFILE,
    memory: mem,
  });
  assert.ok(
    navy.outfits.some((o) => o.itemIds.includes('tNavy')),
    'the navy wardrobe can produce a navy look',
  );

  const ctx = { styleProfile: EMPTY_PROFILE, memory: mem };
  const navyLook = { match: 80, items: [preferenceWardrobe()[0]] };
  const plainLook = { match: 80, items: [baseWardrobe()[0]] };
  assert.equal(engine.scoreCandidate(navyLook, ctx).components.learned_affinity.applied, true,
    'the navy item carries a matching opinion');
  assert.equal(engine.scoreCandidate(plainLook, ctx).components.learned_affinity.applied, false,
    'a white item with only navy opinions stored stays untouched');
});

// ------------------------------------------------------------------- Test J

test('J — compatibilityScore is the explained 11-factor match; ranking drives order', async () => {
  const opts = {
    occasion: 'casual',
    weather: { tempC: 22, condition: 'partly cloudy' },
    count: 3,
    month: 5,
    styleProfile: EMPTY_PROFILE,
    memory: memoryStore.empty(),
  };
  const { outfits } = await engine.recommend(baseWardrobe(), opts);
  assert.ok(outfits.length >= 2, 'enough looks to check ordering');

  for (const outfit of outfits) {
    assert.ok(Number.isInteger(outfit.compatibilityScore), 'compatibilityScore is an integer');
    assert.equal(typeof outfit.rankingScore, 'number', 'rankingScore present');
    assert.equal(outfit.match, outfit.compatibilityScore,
      'match stays a backward-compatible alias of compatibilityScore');
    const recomputed = scoring.scoreOutfit(outfit.items, {
      occasion: 'casual',
      weather: { tempC: 22, condition: 'partly cloudy' },
      styleProfile: EMPTY_PROFILE,
      memory: memoryStore.empty(),
      month: 5,
    }).match;
    assert.equal(outfit.compatibilityScore, recomputed,
      `compatibilityScore agrees with the 11-factor score of the same items (${outfit.itemIds.join(',')})`);
  }

  const ranking = outfits.map((o) => o.rankingScore);
  for (let i = 1; i < ranking.length; i += 1) {
    assert.ok(
      ranking[i - 1] >= ranking[i],
      `outfits come back best-first by rankingScore: ${ranking.join(',')}`,
    );
  }
});

// ------------------------------------------------------------------- Test H

test('H — identical inputs produce identical recommendations', async () => {
  const opts = {
    occasion: 'casual',
    weather: { tempC: 21, condition: 'cloudy' },
    count: 3,
    month: 9,
    styleProfile: { favoriteColors: ['White'], preferredStyles: ['Casual'], avoidedColors: [] },
  };
  const one = await engine.recommend(baseWardrobe(), opts);
  const two = await engine.recommend(baseWardrobe(), opts);

  const fingerprint = (list) => list.map((o) => ({
    itemIds: o.itemIds,
    match: o.match,
    name: o.name,
    explanation: o.explanation,
    breakdown: o.breakdown.map((b) => [b.key, b.value, b.applied]),
  }));

  assert.deepEqual(fingerprint(one.outfits), fingerprint(two.outfits));
  assert.deepEqual(one.meta.exploration, two.meta.exploration);
  assert.deepEqual(one.meta.candidates, two.meta.candidates);
});
