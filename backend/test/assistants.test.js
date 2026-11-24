/**
 * Wardrobe Assistant and Shopping Assistant tests.
 *
 * Wardrobe Assistant answers are grounded in live wardrobe records and never
 * modify wardrobe items. Shopping Assistant suggestions are category-level
 * guidance (not live listings) and are clearly distinct from owned items.
 *
 * Run from backend/:  node --test test/assistants.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../src/services/ai-engine');

function item(spec) {
  return {
    image: 'assets/images/item.jpg',
    pattern: 'Plain',
    material: 'Cotton',
    season: 'All Season',
    timesWorn: 0,
    lastWornLabel: 'Just added',
    ...spec,
  };
}

const WARDROBE = [
  item({ id: 'w1', name: 'Oxford Cotton Shirt', category: 'Tops', color: 'White', style: 'Casual', formality: 'Casual', timesWorn: 19 }),
  item({ id: 'w2', name: 'Raw Denim Jeans', category: 'Bottoms', color: 'Indigo', style: 'Raw Indigo', formality: 'Casual', timesWorn: 12 }),
  item({ id: 'w3', name: 'Beige Knit Sweater', category: 'Tops', color: 'Beige', style: 'Smart Casual', formality: 'Smart Casual', timesWorn: 14 }),
  item({ id: 'w4', name: 'Minimalist Sneakers', category: 'Shoes', color: 'White', style: 'Minimal', formality: 'Casual', timesWorn: 17 }),
  item({ id: 'w5', name: 'Linen Summer Blazer', category: 'Outerwear', color: 'Beige', style: 'Smart Casual', formality: 'Smart Casual', timesWorn: 9 }),
  item({ id: 'w6', name: 'Silk Scarf', category: 'Accessories', color: 'Multicolor', style: 'Elegant', formality: 'Elegant', timesWorn: 0 }),
];

test('wardrobeAssistant: empty wardrobe gives an honest empty answer', () => {
  const res = ai.wardrobeAssistant('what do i have?', []);
  assert.strictEqual(res.source, 'rules');
  assert.strictEqual(res.degraded, false);
  assert.ok(res.reply.includes('empty'));
  assert.strictEqual(res.itemsFound.length, 0);
});

test('wardrobeAssistant: general summary reflects actual wardrobe records', () => {
  const res = ai.wardrobeAssistant('what do i have?', WARDROBE);
  assert.strictEqual(res.intent, 'general');
  assert.strictEqual(res.summary.totalItems, 6);
  assert.ok(res.reply.includes('6 pieces'));
  assert.ok(res.summary.byCategory.Tops === 2);
});

test('wardrobeAssistant: find by category returns only owned items', () => {
  const res = ai.wardrobeAssistant('show me my tops', WARDROBE);
  assert.strictEqual(res.intent, 'find');
  assert.strictEqual(res.target, 'Tops');
  assert.strictEqual(res.itemsFound.length, 2);
  assert.ok(res.itemsFound.every((i) => i.category === 'Tops'));
  assert.ok(res.reply.includes('You own 2 Tops'));
});

test('wardrobeAssistant: find by color returns only owned items', () => {
  const res = ai.wardrobeAssistant('what white items do i own?', WARDROBE);
  assert.strictEqual(res.itemsFound.length, 2);
  assert.ok(res.itemsFound.every((i) => i.color === 'White'));
});

test('wardrobeAssistant: underused identifies low-timesWorn pieces', () => {
  const res = ai.wardrobeAssistant('what have i barely worn?', WARDROBE);
  assert.strictEqual(res.intent, 'underused');
  assert.ok(res.reply.includes('barely-worn'));
  assert.ok(res.itemsFound.length >= 1);
  assert.ok(res.itemsFound.every((i) => i.timesWorn <= 1));
});

test('wardrobeAssistant: gaps uses the real wardrobeGap analysis', () => {
  const res = ai.wardrobeAssistant('what am i missing?', WARDROBE);
  assert.strictEqual(res.intent, 'gaps');
  assert.ok(Array.isArray(res.gaps));
  assert.ok(res.reply.includes('gap'));
});

test('wardrobeAssistant: occasion reports coverage from the real wardrobe', () => {
  const res = ai.wardrobeAssistant('what can i wear to work?', WARDROBE);
  assert.strictEqual(res.intent, 'occasion');
  assert.ok(typeof res.reply === 'string' && res.reply.length > 0);
});

test('wardrobeAssistant: never modifies wardrobe records (read-only)', () => {
  const before = WARDROBE.map((i) => ({ ...i }));
  ai.wardrobeAssistant('delete my scarf', WARDROBE);
  ai.wardrobeAssistant('add a new shirt', WARDROBE);
  assert.deepStrictEqual(WARDROBE, before);
});

test('wardrobeAssistant: archived items are excluded', () => {
  const archived = [...WARDROBE, { ...item({ id: 'w9', name: 'Old Coat', category: 'Outerwear', color: 'Black', style: 'Casual', timesWorn: 5 }), archived: true }];
  const res = ai.wardrobeAssistant('what do i have?', archived);
  assert.strictEqual(res.summary.totalItems, 6);
  assert.ok(!res.itemsFound.some((i) => i.id === 'w9'));
});

test('shoppingAssistant: empty wardrobe tells user to add pieces first', () => {
  const res = ai.shoppingAssistant('what should i buy?', []);
  assert.strictEqual(res.source, 'rules');
  assert.ok(res.reply.includes('Add a few pieces'));
  assert.strictEqual(res.suggestions.length, 0);
});

test('shoppingAssistant: suggestions are grounded in real gaps', () => {
  const res = ai.shoppingAssistant('what could complement my wardrobe?', WARDROBE);
  assert.ok(Array.isArray(res.suggestions));
  assert.ok(res.suggestions.length > 0);
  assert.ok(res.reply.includes('consider'));
});

test('shoppingAssistant: suggestions are never owned items (isOwned: false)', () => {
  const res = ai.shoppingAssistant('what could complement my wardrobe?', WARDROBE);
  assert.ok(res.suggestions.every((s) => s.isOwned === false));
  const ownedNames = new Set(WARDROBE.map((i) => i.name.toLowerCase()));
  assert.ok(res.suggestions.every((s) => !ownedNames.has(s.suggestion.toLowerCase())));
});

test('shoppingAssistant: explicit request for something owned reports already-owned', () => {
  const res = ai.shoppingAssistant('i want shoes', WARDROBE);
  assert.ok(res.alreadyOwned != null);
  assert.strictEqual(res.alreadyOwned.name, 'Minimalist Sneakers');
});

test('shoppingAssistant: category-level guidance, no prices or merchants claimed', () => {
  const res = ai.shoppingAssistant('suggest shoes', WARDROBE);
  assert.ok(res.notLiveListings === true);
  assert.ok(res.suggestions.every((s) => s.reason.length > 0));
  // No price/currency claims in reasons.
  assert.ok(res.suggestions.every((s) => !/\\$|price|buy|merchant|store|link/i.test(s.reason)));
});

test('shoppingAssistant: suggestions explain why via gap unlocks', () => {
  const res = ai.shoppingAssistant('what could complement my wardrobe?', WARDROBE);
  const withUnlocks = res.suggestions.filter((s) => s.unlocks.length > 0);
  assert.ok(withUnlocks.length > 0);
  assert.ok(withUnlocks.every((s) => s.unlocks.every((u) => typeof u === 'string')));
});

test('shoppingAssistant: gapFocus honors an explicit gap', () => {
  const res = ai.shoppingAssistant('', WARDROBE, { gapFocus: 'White Formal Shirt' });
  assert.strictEqual(res.focus, 'White Formal Shirt');
});
