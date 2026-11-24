/**
 * Scoring factor tests — fit-preference contract.
 *
 * A `fitPreference` of "regular" is the *absence* of a declared fit opinion,
 * not a real signal: it must never activate the body-fit factor or add a
 * score. Only the explicit relaxed/fitted tokens the factor actually reasons
 * about turn it on.
 *
 * Run from backend/:  node --test test/scoring.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const scoring = require('../src/services/scoring');

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

const OUTFIT = [
  item({ id: 't1', name: 'Oxford Cotton Shirt', category: 'Tops', color: 'White', style: 'Casual' }),
  item({ id: 'b1', name: 'Relaxed Chinos', category: 'Bottoms', color: 'Beige', style: 'Casual' }),
  item({ id: 's1', name: 'Leather Loafers', category: 'Shoes', color: 'Brown', style: 'Classic' }),
];

function fitFactor(result) {
  return result.breakdown.find((f) => f.key === 'body_fit_preference');
}

test('a "regular" fit preference is the absence of a signal, not a score', () => {
  const none = scoring.scoreOutfit(OUTFIT, { styleProfile: {} });
  const regular = scoring.scoreOutfit(OUTFIT, { styleProfile: { fitPreference: 'regular' } });

  const noneFit = fitFactor(none);
  const regularFit = fitFactor(regular);
  assert.equal(noneFit.applied, false, 'no declared fit → factor stays off');
  assert.equal(regularFit.applied, false, '"regular" must not declare a fit opinion');
  assert.equal(regularFit.contribution, 0, '"regular" contributes nothing');
  assert.equal(regular.match, none.match, '"regular" must not move the score at all');
});

test('each supported fit token activates the factor and contributes', () => {
  const tokens = ['relaxed', 'oversized', 'loose', 'wide', 'tailored', 'fitted', 'slim', 'boxy', 'cropped'];
  for (const fit of tokens) {
    const res = scoring.scoreOutfit(OUTFIT, { styleProfile: { fitPreference: fit } });
    const factor = fitFactor(res);
    assert.equal(factor.applied, true, `"${fit}" must activate body_fit_preference`);
    assert.ok(factor.contribution > 0, `"${fit}" contributes`);
  }
});

test('a fit opinion can be declared in notes; "regular" still cannot', () => {
  const viaNotes = scoring.scoreOutfit(OUTFIT, { styleProfile: { notes: 'prefers relaxed fits' } });
  assert.equal(fitFactor(viaNotes).applied, true, 'notes can carry a real fit opinion');

  const regularNotes = scoring.scoreOutfit(OUTFIT, { styleProfile: { notes: 'usual build, regular sizes' } });
  assert.equal(fitFactor(regularNotes).applied, false, '"regular" in notes stays silent');
});

// ------------------------------------------------------------------- explain()

test('explain() names the colour harmony strength with the palette', () => {
  const res = scoring.scoreOutfit(OUTFIT, { occasion: 'casual', weather: { tempC: 22 } });
  const why = scoring.explain(OUTFIT, { occasion: 'casual', weather: { tempC: 22 } }, res);
  assert.ok(why.includes('White / Beige / Brown'), 'palette is named: $why');
  assert.ok(why.includes('Overall match'), 'match is reported: $why');
});

test('explain() names the occasion fit strength', () => {
  const formal = scoring.scoreOutfit(OUTFIT, { occasion: 'formal dinner', weather: { tempC: 22 } });
  const why = scoring.explain(OUTFIT, { occasion: 'formal dinner', weather: { tempC: 22 } }, formal);
  assert.ok(why.includes('occasion fit'), 'occasion fit is named: $why');
});

test('explain() gives cold-weather advice for snow', () => {
  const res = scoring.scoreOutfit(OUTFIT, { occasion: 'casual', weather: { tempC: -5, condition: 'snow' } });
  const why = scoring.explain(OUTFIT, { occasion: 'casual', weather: { tempC: -5, condition: 'snow' } }, res);
  assert.ok(why.includes('cold-weather'), 'snow triggers cold-weather advice: $why');
});

test('explain() gives hot-weather advice', () => {
  const res = scoring.scoreOutfit(OUTFIT, { occasion: 'casual', weather: { tempC: 32 } });
  const why = scoring.explain(OUTFIT, { occasion: 'casual', weather: { tempC: 32 } }, res);
  assert.ok(why.includes('lightweight layers'), 'heat triggers lightweight advice: $why');
});

test('explain() notes missing required slots when incomplete', () => {
  const incomplete = [OUTFIT[0]]; // only a top, no bottom or shoes
  const res = scoring.scoreOutfit(incomplete, { occasion: 'casual', weather: { tempC: 22 } });
  const why = scoring.explain(incomplete, { occasion: 'casual', weather: { tempC: 22 } }, res);
  assert.ok(why.includes('slot'), 'missing slots are mentioned: $why');
});

test('explain() names not-yet-scored factors', () => {
  const res = scoring.scoreOutfit(OUTFIT, { styleProfile: {}, month: 5 });
  const why = scoring.explain(OUTFIT, { styleProfile: {}, month: 5 }, res);
  // personal_preference and body_fit_preference have no signal with an empty profile
  assert.ok(why.includes('not yet scored'), 'unscored factors are named: $why');
});

test('explain() names the weakest factor when it falls below 62', () => {
  // A single item (incomplete outfit) gets wardrobe_availability around 46,
  // which is below 62 and should be called out.
  const single = [OUTFIT[0]];
  const res = scoring.scoreOutfit(single, { occasion: 'casual', weather: { tempC: 22 } });
  const why = scoring.explain(single, { occasion: 'casual', weather: { tempC: 22 } }, res);
  assert.ok(why.includes('compromise'), 'weak factor is called out: $why');
});

test('explain() returns empty for no pieces', () => {
  assert.equal(scoring.explain([], {}), 'No pieces selected yet.');
});