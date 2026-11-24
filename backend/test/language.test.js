/**
 * Language detection tests (Session 12).
 *
 * Run from backend/:  node --test test/language.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const lang = require('../src/services/language');

test('detectLanguage returns en for English messages', () => {
  const cases = [
    'Hello, I need an outfit for a date',
    'What should I wear today?',
    'Build me a casual look',
    'I love this blue shirt',
    'Please recommend something formal',
    'outfit for work meeting',
  ];
  for (const msg of cases) {
    assert.equal(lang.detectLanguage(msg), lang.LANGUAGES.EN, `Expected EN for: ${msg}`);
  }
});

test('detectLanguage returns ar for MSA messages', () => {
  const cases = [
    'ماذا أرتدي اليوم؟',
    'أريد زي رسمي للاجتماع',
    'أحتاج فستان للزفاف',
    'قمصان بألوان محايدة',
    'هذا الزي ممتاز للعمل',
  ];
  for (const msg of cases) {
    assert.equal(lang.detectLanguage(msg), lang.LANGUAGES.AR, `Expected AR for: ${msg}`);
  }
});

test('detectLanguage returns ar-EG for Egyptian Arabic messages', () => {
  const cases = [
    'ايه اللي أقدر ألبسه النهاردة؟',
    'عايز أطلع في موعد، أعمل إيه؟',
    'محتاج شيرت حلو للكاجوال',
    'عندك بوتس رسمي؟',
    'معلش مش فاهم، ممكن توضح أكتر؟',
    'طيب تمام، شوفلي حاجة تانية',
    'يلا اعمل لي لوك جديد',
    'عندك حاجة تانية؟',
    'كده حلو أوي، برافو!',
  ];
  for (const msg of cases) {
    assert.equal(lang.detectLanguage(msg), lang.LANGUAGES.AR_EG, `Expected AR-EG for: ${msg}`);
  }
});

test('detectLanguage handles mixed Arabic/English messages', () => {
  const cases = [
    'I need outfit for العيد',
    'عايز shirt أبيض و pants سوداء',
    'Build me a look للفرح',
    'What should I wear للعمل؟',
  ];
  for (const msg of cases) {
    const detected = lang.detectLanguage(msg);
    // Mixed messages with Arabic script should detect as Arabic
    assert.ok([lang.LANGUAGES.AR, lang.LANGUAGES.AR_EG].includes(detected), `Expected AR or AR-EG for: ${msg}, got ${detected}`);
  }
});

test('detectLanguage handles empty and invalid input', () => {
  assert.equal(lang.detectLanguage(''), lang.LANGUAGES.EN);
  assert.equal(lang.detectLanguage(null), lang.LANGUAGES.EN);
  assert.equal(lang.detectLanguage(undefined), lang.LANGUAGES.EN);
  assert.equal(lang.detectLanguage('   '), lang.LANGUAGES.EN);
});

test('getLanguagePrompt returns correct prompt for each language', () => {
  const enPrompt = lang.getLanguagePrompt(lang.LANGUAGES.EN);
  assert.ok(enPrompt.includes('English'));
  assert.ok(enPrompt.includes('conversational'));

  const arPrompt = lang.getLanguagePrompt(lang.LANGUAGES.AR);
  assert.ok(arPrompt.includes('Modern Standard Arabic'));
  assert.ok(arPrompt.includes('الفصحى'));

  const arEgPrompt = lang.getLanguagePrompt(lang.LANGUAGES.AR_EG);
  assert.ok(arEgPrompt.includes('Egyptian Arabic'));
  assert.ok(arEgPrompt.includes('عامية مصرية'));
});

test('isRTL returns true for Arabic languages', () => {
  assert.equal(lang.isRTL(lang.LANGUAGES.AR), true);
  assert.equal(lang.isRTL(lang.LANGUAGES.AR_EG), true);
  assert.equal(lang.isRTL(lang.LANGUAGES.EN), false);
});

test('getLocale returns correct locale strings', () => {
  assert.equal(lang.getLocale(lang.LANGUAGES.EN), 'en');
  assert.equal(lang.getLocale(lang.LANGUAGES.AR), 'ar');
  assert.equal(lang.getLocale(lang.LANGUAGES.AR_EG), 'ar_EG');
});

test('hasEgyptianMarkers detects Egyptian colloquial words', () => {
  assert.ok(lang.hasEgyptianMarkers('ايه ده؟'));
  assert.ok(lang.hasEgyptianMarkers('عايز ألبس حاجه'));
  assert.ok(lang.hasEgyptianMarkers('معلش مش فاهم'));
  assert.ok(lang.hasEgyptianMarkers('طيب تمام'));
  assert.ok(!lang.hasEgyptianMarkers('ماذا أرتدي؟'));
  assert.ok(!lang.hasEgyptianMarkers('Hello world'));
});

test('hasMSAMarkers detects Modern Standard Arabic words', () => {
  assert.ok(lang.hasMSAMarkers('ماذا أرتدي؟'));
  assert.ok(lang.hasMSAMarkers('أريد زي رسمي'));
  assert.ok(lang.hasMSAMarkers('هذا ممتاز'));
  assert.ok(!lang.hasMSAMarkers('عايز ألبس حاجه'));
  assert.ok(!lang.hasMSAMarkers('Hello world'));
});

test('countArabicChars and countEnglishChars work correctly', () => {
  assert.equal(lang.countArabicChars('مرحبا'), 5);
  assert.equal(lang.countEnglishChars('Hello'), 5);
  assert.equal(lang.countArabicChars('Hello مرحبا'), 5);
  assert.equal(lang.countEnglishChars('Hello مرحبا'), 5);
  assert.equal(lang.countArabicChars(''), 0);
  assert.equal(lang.countEnglishChars(''), 0);
});

test('LANGUAGES constants are correctly defined', () => {
  assert.equal(lang.LANGUAGES.EN, 'en');
  assert.equal(lang.LANGUAGES.AR, 'ar');
  assert.equal(lang.LANGUAGES.AR_EG, 'ar-EG');
});

test('getLanguageName returns correct display names', () => {
  assert.equal(lang.getLanguageName(lang.LANGUAGES.EN), 'English');
  assert.equal(lang.getLanguageName(lang.LANGUAGES.AR), 'Modern Standard Arabic');
  assert.equal(lang.getLanguageName(lang.LANGUAGES.AR_EG), 'Egyptian Arabic');
});