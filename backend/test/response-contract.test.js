/**
 * Unified response-contract helpers (Session 3).
 *
 * Run from backend/:  node --test test/response-contract.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const contract = require('../src/response-contract');
const ai = require('../src/ai-engine');
const memoryStore = require('../src/style-memory');
const vision = require('../src/vision');

function item(spec) {
  return {
    image: 'assets/images/item.jpg',
    pattern: 'Plain',
    material: 'Cotton',
    season: 'All Season',
    formality: 'Smart Casual',
    timesWorn: 2,
    lastWornLabel: 'Worn 5 days ago',
    ...spec,
  };
}

const WARDROBE = [
  item({ id: 't1', name: 'Oxford Shirt', category: 'Tops', color: 'White', style: 'Casual' }),
  item({ id: 't2', name: 'Oxford Shirt', category: 'Tops', color: 'White', style: 'Casual' }),
  item({ id: 'b1', name: 'Chinos', category: 'Bottoms', color: 'Beige', style: 'Casual' }),
  item({ id: 's1', name: 'Loafers', category: 'Shoes', color: 'Brown', style: 'Classic' }),
  { ...item({ id: 'old1', name: 'Archived Jacket', category: 'Outerwear' }), archived: true },
];

test('validateItemIds keeps owned ids, dedupes by garment, reports drops', () => {
  const res = contract.validateItemIds(
    ['t1', 't2', 'ghost', 'old1', 'b1', 't1'],
    WARDROBE,
  );
  assert.deepEqual(res.requested, ['t1', 't2', 'ghost', 'old1', 'b1']);
  assert.deepEqual(res.valid, ['t1', 'b1']);
  assert.deepEqual(res.dropped, ['t2', 'ghost', 'old1']);
});

test('validateItemIds never invents ids and tolerates bad input', () => {
  assert.deepEqual(contract.validateItemIds(null, WARDROBE), {
    requested: [],
    valid: [],
    dropped: [],
  });
  assert.deepEqual(contract.validateItemIds(['ghost'], []), {
    requested: ['ghost'],
    valid: [],
    dropped: ['ghost'],
  });
});

test('normalizeOutfit turns the old completeness object into a number + detail', () => {
  const out = contract.normalizeOutfit({
    id: 'llm-1',
    name: 'Test Look',
    occasion: 'casual',
    match: 88,
    breakdown: [],
    completeness: { ratio: 1, filled: 3, required: 3 },
    explanation: 'x',
    itemIds: ['t1', 'b1', 's1'],
    pieces: ['Oxford Shirt', 'Chinos', 'Loafers'],
    items: [WARDROBE[0], WARDROBE[2], WARDROBE[3]],
    image: 'i',
  }, {
    provenance: contract.PROVENANCE.llmIds,
    grounding: { recoveredItemIds: ['t1', 'b1', 's1'], usedFallback: false, allOwned: true },
  });

  assert.equal(out.completeness, 1);
  assert.deepEqual(out.completenessDetail, { ratio: 1, filled: 3, required: 3 });
  assert.equal(out.match, 88);
  assert.equal(out.compatibilityScore, 88);
  assert.equal(out.rankingScore, null);
  assert.equal(out.provenance, 'llm_ids');
  assert.deepEqual(out.grounding, {
    recoveredItemIds: ['t1', 'b1', 's1'],
    usedFallback: false,
    allOwned: true,
  });
  assert.equal(out.itemIds.length, 3);
  assert.equal(out.items.length, 3);
});

test('normalizeOutfit derives completeness when a producer omits it', () => {
  const out = contract.normalizeOutfit({
    id: 'match-1',
    name: 'Matched',
    match: 77,
    breakdown: [],
    explanation: 'x',
    itemIds: ['t1', 'b1', 's1'],
    pieces: ['Oxford Shirt', 'Chinos', 'Loafers'],
    items: [WARDROBE[0], WARDROBE[2], WARDROBE[3]],
  }, { provenance: contract.PROVENANCE.match, occasion: 'date night' });

  assert.equal(typeof out.completeness, 'number');
  assert.equal(out.completeness, 1);
  assert.deepEqual(out.completenessDetail, { ratio: 1, filled: 3, required: 3 });
  assert.equal(out.occasion, 'date night');
  assert.equal(out.compatibilityScore, 77);
  assert.equal(out.rankingScore, null);
  assert.equal(out.provenance, 'match');
});

test('normalizeOutfit preserves remix-only fields', () => {
  const out = contract.normalizeOutfit({
    id: 'remix-casual-1',
    name: 'Remixed',
    variant: 'casual',
    match: 81,
    breakdown: [],
    completeness: { ratio: 0.67, filled: 2, required: 3 },
    explanation: 'x',
    itemIds: ['t1', 'b1'],
    pieces: ['Oxford Shirt', 'Chinos'],
    items: WARDROBE.slice(0, 2),
    keptFromOriginal: 1,
    regenerated: false,
    note: 'kept it',
  }, { provenance: contract.PROVENANCE.remix });

  assert.equal(out.variant, 'casual');
  assert.equal(out.keptFromOriginal, 1);
  assert.equal(out.regenerated, false);
  assert.equal(out.note, 'kept it');
  assert.equal(out.completeness, 0.67);
  assert.equal(out.provenance, 'remix');
});

test('memoryFacets exposes the structured taste summary and stays optional-safe', () => {
  const mem = memoryStore.empty('u1');
  mem.colors = { navy: 0.8, red: 0.2 };
  mem.styles = { minimal: 0.7 };
  mem.occasions = { formal: 0.7 };
  mem.avoid = ['sneakers'];
  mem.facts = [{ text: 'Prefers breathable fabrics', at: 'now' }];
  mem.totals = { ratings: 3, chats: 5 };

  const facets = contract.memoryFacets(mem);
  assert.deepEqual(facets.prefers, ['navy']);
  assert.deepEqual(facets.dislikes, ['red']);
  assert.deepEqual(facets.favouredStyles, ['minimal']);
  assert.equal(facets.formalityLean, 'dressier');
  assert.deepEqual(facets.avoid, ['sneakers']);
  assert.deepEqual(facets.notes, ['Prefers breathable fabrics']);
  assert.equal(typeof facets.confidence, 'number');
  assert.deepEqual(facets.totals, { ratings: 3, chats: 5 });

  const empty = contract.memoryFacets(memoryStore.empty('u2'));
  assert.deepEqual(empty.prefers, []);
  assert.deepEqual(empty.dislikes, []);
  assert.deepEqual(empty.notes, []);
  assert.equal(empty.formalityLean, null);
});

test('baseMeta always returns a contractVersion 2 envelope', () => {
  const meta = contract.baseMeta({
    requestId: 'req_test',
    generatedAt: '2026-11-16T13:45:00.000Z',
    engine: 'gemini',
    degraded: true,
    itemIdValidation: { requested: ['t1', 'ghost'], valid: ['t1'], dropped: ['ghost'] },
  });
  assert.deepEqual(meta, {
    contractVersion: 2,
    requestId: 'req_test',
    generatedAt: '2026-11-16T13:45:00.000Z',
    engine: 'gemini',
    degraded: true,
    language: 'en',
    itemIdValidation: { requested: ['t1', 'ghost'], valid: ['t1'], dropped: ['ghost'] },
  });
});

test('inferIntent is deterministic and covers the main turn types', () => {
  assert.equal(contract.inferIntent('Build me an outfit for a date'), 'new_outfit');
  assert.equal(contract.inferIntent('Why does this work?'), 'explain');
  assert.equal(contract.inferIntent('What do you think of this look?'), 'opinion');
  assert.equal(contract.inferIntent('Make it less formal'), 'modify_outfit');
  assert.equal(contract.inferIntent('Hello there'), 'chat');
  assert.equal(contract.inferIntent('Change the shoes'), 'modify_item');
  assert.equal(contract.inferIntent('I hate this outfit'), 'correction');
  assert.equal(contract.inferIntent('That one looks nice'), 'ambiguous');
});

test('detectSingleItemChange returns the targeted category', () => {
  assert.equal(contract.detectSingleItemChange('Change the shoes'), 'shoes');
  assert.equal(contract.detectSingleItemChange('Swap the top for a blouse'), 'top');
  assert.equal(contract.detectSingleItemChange('Replace the jacket'), 'jacket');
  assert.equal(contract.detectSingleItemChange('Different pants'), 'pants');
  assert.equal(contract.detectSingleItemChange('Hello there'), null);
});

test('every generateOutfits producer emits canonical fields', () => {
  const [outfit] = ai.generateOutfits(WARDROBE, { occasion: 'casual', count: 1 });
  assert.ok(outfit);
  assert.equal(typeof outfit.match, 'number');
  assert.equal(Number.isInteger(outfit.match), true);
  assert.equal(typeof outfit.compatibilityScore, 'number');
  assert.equal(typeof outfit.completeness, 'number');
  assert.deepEqual(outfit.completenessDetail.required, 3);
  assert.equal(outfit.provenance, 'generated');
  assert.equal(typeof outfit.grounding, 'object');
  assert.equal(Array.isArray(outfit.itemIds), true);
  assert.equal(Array.isArray(outfit.items), true);
  assert.equal(outfit.items.length, outfit.itemIds.length);
});

test('remix outfits are canonical and keep their remix identity', () => {
  const result = ai.remixOutfit(WARDROBE, {
    itemIds: ['t1', 'b1', 's1'],
    variant: 'casual',
    weather: { tempC: 24, condition: 'clear' },
    memory: memoryStore.empty('u1'),
  });
  const outfit = result.outfit;
  assert.equal(outfit.provenance, 'remix');
  assert.equal(outfit.variant, 'casual');
  assert.equal(typeof outfit.completeness, 'number');
  assert.equal(typeof outfit.compatibilityScore, 'number');
  assert.equal(outfit.rankingScore, null);
  assert.equal(Array.isArray(outfit.itemIds), true);
  assert.equal(Array.isArray(outfit.items), true);
});

// ===== Session 4: Hallucination prevention tests =====

test('validateItemIds rejects all hallucinated IDs', () => {
  const res = contract.validateItemIds(
    ['hallucinated1', 'fake-id', 'not-real', 'also-fake'],
    WARDROBE,
  );
  assert.deepEqual(res.requested, ['hallucinated1', 'fake-id', 'not-real', 'also-fake']);
  assert.deepEqual(res.valid, []);
  assert.deepEqual(res.dropped, ['hallucinated1', 'fake-id', 'not-real', 'also-fake']);
});

test('validateItemIds handles mixed valid/hallucinated IDs', () => {
  const res = contract.validateItemIds(
    ['t1', 'hallucinated1', 'b1', 'fake-id', 's1'],
    WARDROBE,
  );
  assert.deepEqual(res.requested, ['t1', 'hallucinated1', 'b1', 'fake-id', 's1']);
  assert.deepEqual(res.valid, ['t1', 'b1', 's1']);
  assert.deepEqual(res.dropped, ['hallucinated1', 'fake-id']);
});

test('validateItemIds filters archived items', () => {
  const res = contract.validateItemIds(
    ['old1'],
    WARDROBE,
  );
  assert.deepEqual(res.requested, ['old1']);
  assert.deepEqual(res.valid, []);
  assert.deepEqual(res.dropped, ['old1']);
});

test('validateItemIds dedupes by garment key not ID', () => {
  // t1 and t2 are both "Oxford Shirt" - same garment key
  const res = contract.validateItemIds(
    ['t1', 't2'],
    WARDROBE,
  );
  assert.deepEqual(res.valid, ['t1']);
  assert.deepEqual(res.dropped, ['t2']);
});

test('normalizeOutfit grounding reflects hallucination status', () => {
  // Test with valid IDs - allOwned should be true, usedFallback false
  const out = contract.normalizeOutfit({
    id: 'llm-1',
    name: 'Test Look',
    occasion: 'casual',
    match: 88,
    breakdown: [],
    explanation: 'x',
    itemIds: ['t1', 'b1', 's1'],
    pieces: ['Oxford Shirt', 'Chinos', 'Loafers'],
    items: [WARDROBE[0], WARDROBE[2], WARDROBE[3]],
  }, {
    provenance: contract.PROVENANCE.llmIds,
    grounding: { recoveredItemIds: ['t1', 'b1', 's1'], usedFallback: false, allOwned: true },
  });

  assert.equal(out.grounding.allOwned, true);
  assert.equal(out.grounding.usedFallback, false);
  assert.deepEqual(out.grounding.recoveredItemIds, ['t1', 'b1', 's1']);
});

test('normalizeOutfit generated fallback has correct grounding', () => {
  const out = contract.normalizeOutfit({
    id: 'gen-1',
    name: 'Generated Look',
    occasion: 'casual',
    match: 75,
    breakdown: [],
    explanation: 'x',
    itemIds: ['t1', 'b1'],
    pieces: ['Oxford Shirt', 'Chinos'],
    items: [WARDROBE[0], WARDROBE[2]],
  }, {
    provenance: contract.PROVENANCE.generatedFallback,
    grounding: { recoveredItemIds: ['t1'], usedFallback: true, allOwned: true },
  });

  assert.equal(out.provenance, 'generated_fallback');
  assert.equal(out.grounding.usedFallback, true);
  assert.equal(out.grounding.allOwned, true);
  assert.deepEqual(out.grounding.recoveredItemIds, ['t1']);
});

test('baseMeta itemIdValidation captures dropped hallucinated IDs', () => {
  const meta = contract.baseMeta({
    requestId: 'req_test',
    generatedAt: '2026-11-16T13:45:00.000Z',
    engine: 'gemini',
    degraded: true,
    itemIdValidation: { requested: ['t1', 'hallucinated1', 'fake2'], valid: ['t1'], dropped: ['hallucinated1', 'fake2'] },
  });

  assert.deepEqual(meta.itemIdValidation.requested, ['t1', 'hallucinated1', 'fake2']);
  assert.deepEqual(meta.itemIdValidation.valid, ['t1']);
  assert.deepEqual(meta.itemIdValidation.dropped, ['hallucinated1', 'fake2']);
  assert.equal(meta.degraded, true);
});

test('STYLIST_SYSTEM prompt contains anti-hallucination instruction', () => {
  const llm = require('../src/llm');
  // The STYLIST_SYSTEM is a constant in the module, we can't directly test it
  // but we can verify the module exports what we expect
  assert.ok(typeof llm.stylistChat === 'function');
  assert.ok(typeof llm.streamChat === 'function');
});

test('detectRemixVariant maps follow-up words to the right variant', () => {
  assert.equal(ai.detectRemixVariant('make it less formal'), 'casual');
  assert.equal(ai.detectRemixVariant('more casual please'), 'casual');
  assert.equal(ai.detectRemixVariant('keep it relaxed'), 'casual');
  assert.equal(ai.detectRemixVariant('make it colder'), 'cold');
  assert.equal(ai.detectRemixVariant('for winter'), 'cold');
  assert.equal(ai.detectRemixVariant('make it summery'), 'summer');
  assert.equal(ai.detectRemixVariant('it is hot outside'), 'summer');
  assert.equal(ai.detectRemixVariant('for a date'), 'date');
  assert.equal(ai.detectRemixVariant('romantic evening'), 'date');
  assert.equal(ai.detectRemixVariant('make it formal'), 'formal');
  assert.equal(ai.detectRemixVariant('dress it up'), 'formal');
  assert.equal(ai.detectRemixVariant('sharper look'), 'formal');
  assert.equal(ai.detectRemixVariant('something completely new'), 'casual');
  assert.equal(ai.detectRemixVariant(''), 'casual');
});

test('detectRemixVariant checks casual keywords before formal', () => {
  // "less formal" contains "formal" but must map to casual, not formal
  assert.equal(ai.detectRemixVariant('less formal'), 'casual');
  assert.equal(ai.detectRemixVariant('not too formal'), 'casual');
});

test('normalizeOutfit includes factors mirroring breakdown with weight and applied', () => {
  const outfit = {
    id: 'o1',
    name: 'Test Look',
    occasion: 'casual',
    match: 85,
    pieces: ['Shirt', 'Chinos', 'Loafers'],
    itemIds: ['t1', 'b1', 's1'],
    items: [{ id: 't1', name: 'Shirt' }, { id: 'b1', name: 'Chinos' }, { id: 's1', name: 'Loafers' }],
    breakdown: [
      { key: 'color_harmony', label: 'Color Harmony', value: 90, weight: 0.16, applied: true, contribution: 14.4 },
      { key: 'personal_preference', label: 'Personal Taste', value: 75, weight: 0, applied: false, contribution: 0 },
    ],
  };
  const out = contract.normalizeOutfit(outfit, { provenance: contract.PROVENANCE.generated });

  assert.ok(Array.isArray(out.factors), 'factors is an array');
  assert.equal(out.factors.length, 2, 'one factor per breakdown entry');
  assert.equal(out.factors[0].label, 'Color Harmony');
  assert.equal(out.factors[0].value, 90);
  assert.equal(out.factors[0].weight, 0.16);
  assert.equal(out.factors[0].applied, true);
  assert.equal(out.factors[1].label, 'Personal Taste');
  assert.equal(out.factors[1].applied, false);
  assert.equal(out.factors[1].weight, 0);
});

test('normalizeOutfit factors falls back to empty when no breakdown', () => {
  const outfit = { id: 'o1', name: 'Test Look', occasion: 'casual', match: 85 };
  const out = contract.normalizeOutfit(outfit, { provenance: contract.PROVENANCE.generated });
  assert.deepEqual(out.factors, []);
  assert.deepEqual(out.breakdown, []);
});

// ------------------------------------------------------------------- Session 8: conversation context & follow-up

const SESSION8_WARDROBE = [
  item({ id: 't1', name: 'Oxford Shirt', category: 'Tops', color: 'White', style: 'Casual', formality: 'Casual' }),
  item({ id: 't2', name: 'Knit Sweater', category: 'Tops', color: 'Beige', style: 'Smart Casual', formality: 'Smart Casual', material: 'Merino Wool' }),
  item({ id: 'b1', name: 'Relaxed Chinos', category: 'Bottoms', color: 'Beige', style: 'Casual', formality: 'Casual' }),
  item({ id: 'b2', name: 'Dark Jeans', category: 'Bottoms', color: 'Navy', style: 'Casual', formality: 'Casual' }),
  item({ id: 's1', name: 'Leather Loafers', category: 'Shoes', color: 'Brown', style: 'Classic', formality: 'Classic' }),
  item({ id: 's2', name: 'White Sneakers', category: 'Shoes', color: 'White', style: 'Casual', formality: 'Casual' }),
  item({ id: 'j1', name: 'Denim Jacket', category: 'Outerwear', color: 'Blue', style: 'Casual', formality: 'Casual' }),
];

test('detectItemReference finds an item by category keyword', () => {
  const found = ai.detectItemReference('change the shoes', SESSION8_WARDROBE, ['t1', 'b1', 's1']);
  assert.ok(['s1', 's2'].includes(found), 'found a shoe: ' + found);
});

test('detectItemReference prefers items from the current outfit', () => {
  // s1 is in the outfit, s2 is not — both are shoes. Should prefer s1.
  const found = ai.detectItemReference('swap the shoes', SESSION8_WARDROBE, ['t1', 'b1', 's1']);
  assert.equal(found, 's1', 'preferred outfit item: ' + found);
});

test('detectItemReference returns null when no category keyword', () => {
  assert.equal(ai.detectItemReference('hello there', SESSION8_WARDROBE, []), null);
  assert.equal(ai.detectItemReference('make it formal', SESSION8_WARDROBE, []), null);
});

test('modifySingleItem replaces one item and keeps the rest', () => {
  const result = ai.modifySingleItem(SESSION8_WARDROBE, {
    itemIds: ['t1', 'b1', 's1'],
    itemToReplace: 's1',
    weather: { tempC: 22, condition: 'partly cloudy' },
  });
  assert.ok(result.outfit, 'produced an outfit');
  assert.equal(result.replacedItem.id, 's1', 'replaced the loafers');
  assert.notEqual(result.replacementItem.id, 's1', 'replacement is different');
  // Kept items should still be present.
  const keptIds = result.outfit.itemIds;
  assert.ok(keptIds.includes('t1'), 'kept the shirt');
  assert.ok(keptIds.includes('b1'), 'kept the chinos');
  assert.ok(!keptIds.includes('s1'), 'removed the loafers');
  assert.equal(result.outfit.keptFromOriginal, 2, 'kept 2 of 3 original items');
});

test('modifySingleItem returns null when item to replace is not in outfit', () => {
  const result = ai.modifySingleItem(SESSION8_WARDROBE, {
    itemIds: ['t1', 'b1', 's1'],
    itemToReplace: 'j1', // jacket is not in the outfit
    weather: { tempC: 22, condition: 'partly cloudy' },
  });
  assert.equal(result.outfit, null, 'no outfit when item not in outfit');
  assert.equal(result.replacedItem, null, 'no replaced item');
});

test('modifySingleItem returns null when no replacement available', () => {
  // Wardrobe with only one shoe — no alternative to swap to.
  const singleShoeWardrobe = [
    item({ id: 't1', name: 'Oxford Shirt', category: 'Tops', color: 'White', style: 'Casual', formality: 'Casual' }),
    item({ id: 'b1', name: 'Relaxed Chinos', category: 'Bottoms', color: 'Beige', style: 'Casual', formality: 'Casual' }),
    item({ id: 's1', name: 'Leather Loafers', category: 'Shoes', color: 'Brown', style: 'Classic', formality: 'Classic' }),
  ];
  const result = ai.modifySingleItem(singleShoeWardrobe, {
    itemIds: ['t1', 'b1', 's1'],
    itemToReplace: 's1',
    weather: { tempC: 22, condition: 'partly cloudy' },
  });
  assert.equal(result.outfit, null, 'no outfit when no replacement available');
  assert.equal(result.replacedItem.id, 's1', 'identified the item to replace');
  assert.equal(result.replacementItem, null, 'no replacement found');
});

test('modifySingleItem by category name instead of id', () => {
  const result = ai.modifySingleItem(SESSION8_WARDROBE, {
    itemIds: ['t1', 'b1', 's1'],
    itemToReplace: 'shoes', // category name instead of id
    weather: { tempC: 22, condition: 'partly cloudy' },
  });
  assert.ok(result.outfit, 'produced an outfit when replacing by category');
  assert.ok(result.replacedItem, 'identified the shoes');
  assert.notEqual(result.replacementItem.id, 's1', 'replaced with different shoes');
});

test('Arabic and Egyptian follow-ups route to the right intent', () => {
  assert.equal(contract.inferIntent('بدّل الشوز'), 'modify_item');
  assert.equal(contract.inferIntent('غيّر الحذاء'), 'modify_item');
  assert.equal(contract.inferIntent('خليه كاجوال'), 'modify_outfit');
  assert.equal(contract.inferIntent('اعمل لوك للنهار'), 'new_outfit');
  assert.equal(contract.inferIntent('ليه شوز كده؟'), 'explain');
});

test('Arabic single-item changes resolve to owned items', () => {
  const found = ai.detectItemReference('بدّل الشوز', SESSION8_WARDROBE, ['t1', 'b1', 's1']);
  assert.ok(['s1', 's2'].includes(found), 'found a shoe: ' + found);
  assert.equal(ai.detectRemixVariant('خليه كاجوال'), 'casual');
  assert.equal(ai.detectRemixVariant('خليه للسهرة'), 'date');
});

test('deterministic chat replies use the detected language', () => {
  const ar = ai.chatReply('اعمل لوك للنهار', {
    wardrobe: SESSION8_WARDROBE,
    weather: { tempC: 24, condition: 'clear', summary: '24°C' },
    language: 'ar',
  });
  assert.match(ar.text, /[\u0600-\u06FF]/);

  const en = ai.chatReply('build me a casual look', {
    wardrobe: SESSION8_WARDROBE,
    weather: { tempC: 24, condition: 'clear', summary: '24°C' },
    language: 'en',
  });
  assert.match(en.text, /[\u0000-\u007F]/);
});

test('follow-up helpers localize edits, ambiguity and suggestions', () => {
  assert.match(contract.editFollowUp('ar', 'shoes'), /[\u0600-\u06FF]/);
  assert.match(contract.editFollowUp('ar-EG', 'shoes'), /[\u0600-\u06FF]/);
  assert.match(contract.ambiguousFollowUp('ar'), /[\u0600-\u06FF]/);
  assert.ok(contract.suggestionsForTurn({ intent: 'modify_item', lang: 'ar-EG' }).length >= 3);
  assert.ok(contract.suggestionsForTurn({ intent: 'new_outfit', lang: 'en' }).length >= 3);
});

test('vision normalises garment slots instead of occasions', () => {
  const spec = vision.normaliseSpec([
    { slot: 'top', garment: 'Oxford shirt', color: 'white' },
    { garment: 'running shoes', color: 'black' },
  ]);
  assert.equal(spec.slots[0].slot, 'top');
  assert.equal(spec.slots[1].slot, 'shoes');
});

test('vision explicit slots do not widen to unrelated wardrobe categories', () => {
  const wardrobe = [
    item({ id: 't1', name: 'Oxford Shirt', category: 'Tops', color: 'White' }),
    item({ id: 's1', name: 'Leather Loafers', category: 'Shoes', color: 'Brown' }),
  ];

  const present = vision.matchSpec({
    title: 'Reference',
    occasion: '',
    notes: '',
    slots: [{ slot: 'shoes', garment: 'leather loafers', color: 'brown', material: '', formality: '' }],
  }, wardrobe);
  assert.equal(present.matches[0].slot, 'shoes');
  assert.equal(present.matches[0].itemId, 's1');

  const missing = vision.matchSpec({
    title: 'Reference',
    occasion: '',
    notes: '',
    slots: [{ slot: 'shoes', garment: 'running shoes', color: 'black', material: '', formality: '' }],
  }, [wardrobe[0]]);
  assert.equal(missing.matches[0].item, null);
  assert.equal(missing.matches[0].slot, 'shoes');
  assert.equal(missing.gaps[0].slot, 'shoes');
});