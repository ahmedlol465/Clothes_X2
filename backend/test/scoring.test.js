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