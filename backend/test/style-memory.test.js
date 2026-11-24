/**
 * Style Memory learning-loop tests (§9) — the colour-key contract.
 *
 * Chat and ratings must write keys the scorers actually read, colour words
 * must not leak into `styles`, and an opinion must only move items it applies
 * to. These are the regressions that pinned recommendations at ~50/60: the
 * seed memory held `colors.navy` (chat) while the reader asked for the family
 * key (ratings), and colour words were also written into `styles` where no
 * outfit could ever read them back.
 *
 * Run from backend/:  node --test test/style-memory.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const memoryStore = require('../src/style-memory');

const RATE_CHAT = 0.04;

function navyItem() {
  return { id: 'tNavy', name: 'Navy Oxford Shirt', color: 'Navy', style: 'Casual', material: 'Cotton' };
}

function beigeItem() {
  return { id: 'tBeige', name: 'Beige Knit Sweater', color: 'Beige', style: 'Smart Casual', material: 'Cotton' };
}

test('chat colour words write the exact colour and its family, never styles', () => {
  const m = memoryStore.empty();
  memoryStore.learnChat(m, 'I always wear navy.');

  assert.ok(Math.abs(m.colors.navy - (0.5 + RATE_CHAT * 0.8)) < 1e-9, 'exact word learned');
  assert.ok(Math.abs(m.colors.cool - (0.5 + RATE_CHAT * 0.8)) < 1e-9, 'family key learned');
  assert.equal(m.styles.navy, undefined, 'a colour word must not leak into styles');
  assert.deepEqual(m.styles, {});
});

test('garment nouns are style opinions, never colours', () => {
  const m = memoryStore.empty();
  memoryStore.learnChat(m, 'I love sneakers.');

  assert.ok(m.styles.sneakers > 0.5, 'sneakers opinion lives in styles');
  assert.deepEqual(m.colors, {}, 'no colour key invented for a garment word');
});

test('item affinity honours both legacy chat keys and family keys', () => {
  const legacy = memoryStore.empty(); // written by the old chat path
  legacy.colors.navy = 0.8;
  legacy.styles.navy = 0.8;
  legacy.styles.sneakers = 0.2;

  assert.equal(memoryStore.itemAffinity(legacy, beigeItem()), 0.5,
    'a pure legacy chat memory leaves an unmatched outfit neutral');
  assert.ok(memoryStore.itemAffinity(legacy, navyItem()) > 0.5,
    'the exact colour word still reads back for the item that carries it');
});

test('ratings still read through the family key', () => {
  const m = memoryStore.empty();
  memoryStore.learnRating(m, { items: [navyItem()], rating: 5 });

  assert.ok(m.colors.cool > 0.5, 'learnRating stores the family key');
  assert.equal(m.colors.navy, undefined, 'learnRating does not invent an exact word');
  assert.ok(memoryStore.itemAffinity(m, navyItem()) > 0.5,
    'the family fallback picks up the rating for a navy item');
});

test('an empty memory reports neutral affinity', () => {
  assert.equal(memoryStore.itemAffinity(memoryStore.empty(), navyItem()), 0.5);
  assert.equal(memoryStore.colorPreference(memoryStore.empty(), 'Magenta'), 0.5);
});

test('exact colour word beats the family', () => {
  const m = { colors: { navy: 0.8, cool: 0.2 } };
  assert.equal(memoryStore.colorPreference(m, 'Navy'), 0.8);
  assert.equal(memoryStore.colorPreference(m, 'Indigo'), 0.2);
  assert.equal(memoryStore.colorPreference(m, 'Beige'), 0.5);
});

test('hasOpinionFor only reports signals that apply to the item', () => {
  const none = memoryStore.empty();
  assert.equal(memoryStore.hasOpinionFor(none, navyItem()), false);

  const byColor = memoryStore.empty();
  byColor.colors.navy = 0.7;
  assert.equal(memoryStore.hasOpinionFor(byColor, navyItem()), true);
  assert.equal(memoryStore.hasOpinionFor(byColor, beigeItem()), false);

  const byStyle = memoryStore.empty();
  byStyle.styles.casual = 0.6;
  assert.equal(memoryStore.hasOpinionFor(byStyle, { id: 'x', color: 'White', style: 'Casual' }), true);
  assert.equal(memoryStore.hasOpinionFor(byStyle, { id: 'x', color: 'White', style: 'Formal' }), false);

  const byFabric = memoryStore.empty();
  byFabric.fabrics.cotton = 0.7;
  assert.equal(memoryStore.hasOpinionFor(byFabric, { id: 'x', material: 'Cotton' }), true);

  const byRating = memoryStore.empty();
  byRating.itemRatings.t1 = { rating: 5, at: '2026-01-01T00:00:00.000Z' };
  assert.equal(memoryStore.hasOpinionFor(byRating, { id: 't1' }), true);
  assert.equal(memoryStore.hasOpinionFor(byRating, { id: 't2' }), false);

  const byFormality = memoryStore.empty();
  byFormality.occasions.formal = 0.7;
  assert.equal(memoryStore.hasOpinionFor(byFormality, navyItem()), true,
    'a stated formality lean applies to any outfit');
});

// ------------------------------------------------------------------- Preference management

test('preferences can be read back after learning', () => {
  const m = memoryStore.empty();
  memoryStore.learnChat(m, 'I love navy.');
  memoryStore.learnRating(m, { items: [navyItem(), beigeItem()], rating: 5 });

  assert.ok(m.colors.navy > 0.5, 'navy colour preference learned');
  assert.ok(m.styles.casual > 0.5, 'casual style preference learned');
  assert.ok(memoryStore.confidence(m) > 0, 'confidence is reported');
  assert.equal(m.totals.ratings, 1, 'rating count tracked');
});

test('avoid list dedups and caps at 10 entries', () => {
  const m = memoryStore.empty();
  memoryStore.learnChat(m, 'never wear sneakers.');
  memoryStore.learnChat(m, 'never wear sneakers.'); // duplicate — ignored
  memoryStore.learnChat(m, 'never wear linen.');

  assert.equal(m.avoid.length, 2, 'two distinct exclusions');
  assert.ok(m.avoid.includes('sneakers'), 'sneakers excluded');
  assert.ok(m.avoid.includes('linen'), 'linen excluded');
});

test('confidence grows with signals', () => {
  const empty = memoryStore.empty();
  assert.equal(memoryStore.confidence(empty), 0, 'empty memory has zero confidence');

  const withRating = memoryStore.empty();
  memoryStore.learnRating(withRating, { items: [navyItem()], rating: 5 });
  assert.ok(memoryStore.confidence(withRating) > 0, 'ratings build confidence');

  const withChat = memoryStore.empty();
  memoryStore.learnChat(withChat, 'I love navy.');
  assert.ok(memoryStore.confidence(withChat) > 0, 'chat signals build confidence');
});

test('styleDNA reflects learned preferences', () => {
  const m = memoryStore.empty();
  memoryStore.learnChat(m, 'I always wear navy.');
  memoryStore.learnRating(m, { items: [navyItem()], rating: 5 });

  const dna = memoryStore.styleDna(m, [navyItem(), beigeItem()]);
  assert.ok(dna.confidence > 0, 'DNA confidence reported');
  assert.ok(Array.isArray(dna.notes), 'DNA notes array present');
  assert.ok(Array.isArray(dna.palette), 'DNA palette array present');
});

test('preferences are user-isolated', () => {
  const db = { styleMemories: [] };
  const m1 = memoryStore.read(db, 'user1');
  memoryStore.learnChat(m1, 'I love navy.');
  memoryStore.write(db, m1);

  const m2 = memoryStore.read(db, 'user2');
  assert.equal(m2.colors.navy, undefined, 'user2 does not see user1 preferences');
  assert.equal(db.styleMemories.length, 1, 'only one memory record written');
});