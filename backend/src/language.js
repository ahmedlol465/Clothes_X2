/**
 * Language detection and handling utilities (§12 Arabic/English support).
 *
 * Detects English, Modern Standard Arabic (MSA), and Egyptian Arabic (EA)
 * from user messages. Provides helpers for prompt construction and
 * response metadata.
 *
 * Pure functions. No I/O, no dependencies.
 */
'use strict';

/**
 * Supported language codes.
 * - 'en': English
 * - 'ar': Modern Standard Arabic (MSA)
 * - 'ar-EG': Egyptian Arabic (colloquial/dialect)
 */
const LANGUAGES = Object.freeze({
  EN: 'en',
  AR: 'ar',
  AR_EG: 'ar-EG',
});

/**
 * Arabic script Unicode ranges.
 * Basic Arabic: U+0600–U+06FF
 * Arabic Supplement: U+0750–U+077F
 * Arabic Extended-A: U+08A0–U+08FF
 * Arabic Presentation Forms-A: U+FB50–U+FDFF
 * Arabic Presentation Forms-B: U+FE70–U+FEFF
 */
const ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

/**
 * Egyptian Arabic distinctive markers (colloquial words not in MSA).
 * These are strong indicators of Egyptian dialect.
 */
const EGYPTIAN_MARKERS = [
  // Common Egyptian particles/pronouns
  'ايه', 'إيه', 'إزاي', 'ازاي', 'كده', 'كدا', 'فاهم', 'معلش', 'برضه', 'برضو',
  'احنا', 'انتو', 'انتي', 'انت', 'هو', 'هي', 'هما',
  // Egyptian verbs/expressions
  'عايز', 'عايزة', 'محتاج', 'محتاجة', 'منفعش', 'مش', 'مفيش', 'فيها',
  'يلا', 'طيب', 'تمام', 'أوكي', 'أوكيه', 'بس', 'كمان', ' برده',
  'حلو', 'حلوة', 'وحش', 'وحشة', 'قوي', 'قوية', 'أوي', 'اوي',
  'عندك', 'عندكو', 'معاك', 'معاكي', 'لازم', 'ممكن', 'أقدر', 'اقدر',
  'ابعت', 'ابعتله', 'ابعتلي', 'شوف', 'شوفي', 'اعمل', 'اعملي',
  'عشان', 'علشان', 'زي ما', 'كإن', 'كان',
  'هعمل', 'هعملي', 'هتلاق', 'تلاقي', 'تلاقيني', 'تلاقيك',
];

/**
 * Modern Standard Arabic distinctive markers.
 * Formal grammar words less common in Egyptian dialect.
 */
const MSA_MARKERS = [
  'ماذا', 'كيف', 'أين', 'متى', 'لماذا', 'من', 'إلى', 'على', 'في', 'مع',
  'هذا', 'هذه', 'ذلك', 'تلك', 'أولئك', 'الذي', 'التي', 'الذين', 'اللاتي',
  'أريد', 'أحتاج', 'يمكن', 'يجب', 'يجب أن', 'سوف', 'سي', 'لن', 'لم',
  'إن', 'أن', 'لكن', 'ولكن', 'فـ', 'ثم', 'أو', 'إما', 'لا', 'ليس',
  'ممتاز', 'جيد', 'سيء', 'قوي', 'ضعيف', 'كبير', 'صغير', 'طويل', 'قصير',
];

/**
 * English words that commonly appear in mixed Arabic/English messages.
 * Used to detect code-switching.
 */
const ENGLISH_MARKERS = [
  'outfit', 'style', 'fashion', 'wear', 'dress', 'shirt', 'pants', 'shoes',
  'jacket', 'coat', 'sweater', 'jeans', 't-shirt', 'blazer', 'sneakers',
  'loafers', 'boots', 'sandals', 'color', 'colour', 'size', 'fit',
  'casual', 'formal', 'smart', 'elegant', 'vintage', 'modern', 'classic',
  'date', 'meeting', 'work', 'party', 'wedding', 'interview', 'travel',
  'weather', 'hot', 'cold', 'rain', 'summer', 'winter', 'spring', 'autumn',
  'recommend', 'suggest', 'build', 'create', 'make', 'change', 'swap',
  'remix', 'critique', 'rate', 'review', 'opinion', 'advice', 'help',
  'please', 'thanks', 'thank you', 'yes', 'no', 'ok', 'okay',
];

/**
 * Normalize text for language detection.
 * Removes extra whitespace, lowercases.
 */
function normalizeForDetection(text) {
  return String(text || '').trim().toLowerCase();
}

/**
 * Count Arabic script characters in text.
 */
function countArabicChars(text) {
  const matches = String(text || '').match(ARABIC_SCRIPT_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Count English letters in text.
 */
function countEnglishChars(text) {
  const matches = String(text || '').match(/[a-zA-Z]/g);
  return matches ? matches.length : 0;
}

/**
 * Check if text contains Egyptian Arabic markers.
 */
function hasEgyptianMarkers(text) {
  const normalized = normalizeForDetection(text);
  return EGYPTIAN_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}

/**
 * Check if text contains MSA markers.
 */
function hasMSAMarkers(text) {
  const normalized = normalizeForDetection(text);
  return MSA_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}

/**
 * Check if text contains English markers.
 */
function hasEnglishMarkers(text) {
  const normalized = normalizeForDetection(text);
  return ENGLISH_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}

/**
 * Detect the primary language of a message.
 *
 * Returns one of: 'en', 'ar', 'ar-EG'
 *
 * Priority:
 * 1. If Egyptian markers present → 'ar-EG'
 * 2. If Arabic script present and MSA markers present → 'ar'
 * 3. If Arabic script present → 'ar' (default Arabic)
 * 4. If English markers present or English dominates → 'en'
 * 5. Default → 'en'
 */
function detectLanguage(message) {
  if (!message || typeof message !== 'string') return LANGUAGES.EN;

  const text = message.trim();
  if (!text) return LANGUAGES.EN;

  const arabicChars = countArabicChars(text);
  const englishChars = countEnglishChars(text);
  const totalChars = arabicChars + englishChars;
  const hasArabicScript = arabicChars > 0;

  // Check for explicit Egyptian dialect markers first
  if (hasEgyptianMarkers(text)) {
    return LANGUAGES.AR_EG;
  }

  // If Arabic script is present (even if English chars dominate in mixed messages)
  if (hasArabicScript) {
    // Check for MSA markers
    if (hasMSAMarkers(text)) {
      return LANGUAGES.AR;
    }
    // Default to MSA for Arabic script without dialect markers
    return LANGUAGES.AR;
  }

  // If mostly English or has English markers
  if (englishChars > arabicChars || hasEnglishMarkers(text)) {
    return LANGUAGES.EN;
  }

  // Default to English for ambiguous/short messages
  return LANGUAGES.EN;
}

/**
 * Get the language name for display/logging.
 */
function getLanguageName(code) {
  switch (code) {
    case LANGUAGES.AR_EG:
      return 'Egyptian Arabic';
    case LANGUAGES.AR:
      return 'Modern Standard Arabic';
    case LANGUAGES.EN:
    default:
      return 'English';
  }
}

/**
 * Get the prompt instruction for a given language.
 * Returns a string to append to the system prompt.
 */
function getLanguagePrompt(langCode) {
  switch (langCode) {
    case LANGUAGES.AR_EG:
      return '\nLanguage: Reply in Egyptian Arabic (عامية مصرية). Use natural colloquial expressions. Keep fashion terms in English where commonly used (outfit, style, blazer, etc.).';
    case LANGUAGES.AR:
      return '\nLanguage: Reply in Modern Standard Arabic (الفصحى). Use formal grammar and vocabulary. Keep fashion terms in English where commonly used (outfit, style, blazer, etc.).';
    case LANGUAGES.EN:
    default:
      return '\nLanguage: Reply in English. Use natural, conversational tone.';
  }
}

/**
 * Check if a language is RTL (right-to-left).
 */
function isRTL(langCode) {
  return langCode === LANGUAGES.AR || langCode === LANGUAGES.AR_EG;
}

/**
 * Get the locale string for Flutter/intl.
 */
function getLocale(langCode) {
  switch (langCode) {
    case LANGUAGES.AR_EG:
      return 'ar_EG';
    case LANGUAGES.AR:
      return 'ar';
    case LANGUAGES.EN:
    default:
      return 'en';
  }
}

module.exports = {
  LANGUAGES,
  detectLanguage,
  getLanguageName,
  getLanguagePrompt,
  isRTL,
  getLocale,
  normalizeForDetection,
  countArabicChars,
  countEnglishChars,
  hasEgyptianMarkers,
  hasMSAMarkers,
  hasEnglishMarkers,
  ARABIC_SCRIPT_REGEX,
  EGYPTIAN_MARKERS,
  MSA_MARKERS,
  ENGLISH_MARKERS,
};