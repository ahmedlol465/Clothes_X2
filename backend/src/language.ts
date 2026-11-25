/**
 * Language detection and handling (§12 Arabic/English support).
 *
 * TypeScript port of the Express-era language.js: detects English, Modern
 * Standard Arabic (MSA), and Egyptian Arabic (EA) from user messages, and
 * provides the prompt instruction that makes LLM replies match. Pure
 * functions, no I/O, no dependencies.
 */

export const LANGUAGES = {
  EN: 'en',
  AR: 'ar',
  AR_EG: 'ar-EG',
} as const;

export type LanguageCode = (typeof LANGUAGES)[keyof typeof LANGUAGES];

/** Arabic script Unicode ranges. */
export const ARABIC_SCRIPT_REGEX =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

/** Egyptian Arabic distinctive markers (colloquial words not in MSA). */
export const EGYPTIAN_MARKERS = [
  'ايه', 'إيه', 'إزاي', 'ازاي', 'كده', 'كدا', 'فاهم', 'معلش', 'برضه', 'برضو',
  'احنا', 'انتو', 'انتي', 'انت', 'هو', 'هي', 'هما',
  'عايز', 'عايزة', 'محتاج', 'محتاجة', 'منفعش', 'مش', 'مفيش', 'فيها',
  'يلا', 'طيب', 'تمام', 'أوكي', 'أوكيه', 'بس', 'كمان', ' برده',
  'حلو', 'حلوة', 'وحش', 'وحشة', 'قوي', 'قوية', 'أوي', 'اوي',
  'عندك', 'عندكو', 'معاك', 'معاكي', 'لازم', 'ممكن', 'أقدر', 'اقدر',
  'ابعت', 'ابعتله', 'ابعتلي', 'شوف', 'شوفي', 'اعمل', 'اعملي',
  'عشان', 'علشان', 'زي ما', 'كإن', 'كان',
  'هعمل', 'هعملي', 'هتلاق', 'تلاقي', 'تلاقيني', 'تلاقيك',
];

/** Modern Standard Arabic distinctive markers. */
export const MSA_MARKERS = [
  'ماذا', 'كيف', 'أين', 'متى', 'لماذا', 'من', 'إلى', 'على', 'في', 'مع',
  'هذا', 'هذه', 'ذلك', 'تلك', 'أولئك', 'الذي', 'التي', 'الذين', 'اللاتي',
  'أريد', 'أحتاج', 'يمكن', 'يجب', 'يجب أن', 'سوف', 'سي', 'لن', 'لم',
  'إن', 'أن', 'لكن', 'ولكن', 'فـ', 'ثم', 'أو', 'إما', 'لا', 'ليس',
  'ممتاز', 'جيد', 'سيء', 'قوي', 'ضعيف', 'كبير', 'صغير', 'طويل', 'قصير',
];

/** English words that commonly appear in mixed Arabic/English messages. */
export const ENGLISH_MARKERS = [
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

export function normalizeForDetection(text: unknown): string {
  return String(text || '').trim().toLowerCase();
}

export function countArabicChars(text: unknown): number {
  const matches = String(text || '').match(ARABIC_SCRIPT_REGEX);
  return matches ? matches.length : 0;
}

export function countEnglishChars(text: unknown): number {
  const matches = String(text || '').match(/[a-zA-Z]/g);
  return matches ? matches.length : 0;
}

export function hasEgyptianMarkers(text: unknown): boolean {
  const normalized = normalizeForDetection(text);
  return EGYPTIAN_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}

export function hasMSAMarkers(text: unknown): boolean {
  const normalized = normalizeForDetection(text);
  return MSA_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}

export function hasEnglishMarkers(text: unknown): boolean {
  const normalized = normalizeForDetection(text);
  return ENGLISH_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}

/**
 * Detect the primary language of a message: 'en', 'ar', or 'ar-EG'.
 * Egyptian markers win first; Arabic script without dialect markers reads as
 * MSA; otherwise English.
 */
export function detectLanguage(message: unknown): LanguageCode {
  if (!message || typeof message !== 'string') return LANGUAGES.EN;
  const text = message.trim();
  if (!text) return LANGUAGES.EN;

  const arabicChars = countArabicChars(text);
  const englishChars = countEnglishChars(text);
  const hasArabicScript = arabicChars > 0;

  if (hasEgyptianMarkers(text)) return LANGUAGES.AR_EG;
  if (hasArabicScript) return LANGUAGES.AR;
  if (englishChars > arabicChars || hasEnglishMarkers(text)) return LANGUAGES.EN;
  return LANGUAGES.EN;
}

export function getLanguageName(code: LanguageCode): string {
  switch (code) {
    case LANGUAGES.AR_EG:
      return 'Egyptian Arabic';
    case LANGUAGES.AR:
      return 'Modern Standard Arabic';
    default:
      return 'English';
  }
}

/** Prompt instruction appended to the stylist system prompt. */
export function getLanguagePrompt(langCode: LanguageCode): string {
  switch (langCode) {
    case LANGUAGES.AR_EG:
      return '\nLanguage: Reply in Egyptian Arabic (عامية مصرية). Use natural colloquial expressions. Keep fashion terms in English where commonly used (outfit, style, blazer, etc.).';
    case LANGUAGES.AR:
      return '\nLanguage: Reply in Modern Standard Arabic (الفصحى). Use formal grammar and vocabulary. Keep fashion terms in English where commonly used (outfit, style, blazer, etc.).';
    default:
      return '\nLanguage: Reply in English. Use natural, conversational tone.';
  }
}

export function isRTL(langCode: LanguageCode): boolean {
  return langCode === LANGUAGES.AR || langCode === LANGUAGES.AR_EG;
}

export function getLocale(langCode: LanguageCode): string {
  switch (langCode) {
    case LANGUAGES.AR_EG:
      return 'ar_EG';
    case LANGUAGES.AR:
      return 'ar';
    default:
      return 'en';
  }
}

// -------------------------------------------------- Arabic message helpers
// Ported from the Express-era response-contract.js so the rule engine can
// understand and answer Arabic messages even without an LLM key.

/** Strip diacritics and fold letter variants so regexes stay short. */
export function normalizeArabic(text: unknown): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

/** Arabic (and a few English loan) words → the outfit slot they name. */
export const ARABIC_CATEGORIES: Array<[RegExp, string]> = [
  [/(شوز|حذاء|احذيه|جزمت|جزامه|بوت|sneaker|shoe|boot)/, 'shoes'],
  [/(توب|قميص|تيشيرت|تي شيرت|بلوز|كنزه|سويتر|هودي|shirt|tee|top)/, 'top'],
  [/(جاكيت|بلازر|معطف|بالطو|outerwear|jacket|blazer|coat)/, 'outerwear'],
  [/(بنطال|بنطلون|جينز|سروال|pant|jean|bottom)/, 'bottom'],
  [/(تنوره|فستان|skirt|dress)/, 'dress'],
  [/(جورب|sock)/, 'socks'],
];

const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  en: { shoes: 'shoes', top: 'top', outerwear: 'jacket', bottom: 'bottoms', dress: 'dress', socks: 'socks', item: 'item' },
  ar: { shoes: 'الحذاء', top: 'القطعة العلوية', outerwear: 'الجاكيت', bottom: 'الجزء السفلي', dress: 'الفستان', socks: 'الجوارب', item: 'القطعة' },
  'ar-EG': { shoes: 'الشوز', top: 'التوب', outerwear: 'الجاكيت', bottom: 'البنطلون', dress: 'الفستان', socks: 'الجوارب', item: 'القطعة' },
};

/** Human label for a slot in the reply's language. */
export function categoryLabel(lang: LanguageCode, category: string): string {
  const table = CATEGORY_LABELS[lang] || CATEGORY_LABELS.en;
  return table[category] || table.item;
}

/** First outfit slot an Arabic message names, if any. */
export function arabicSlot(message: unknown): string | null {
  const ar = normalizeArabic(message);
  for (const [pattern, slot] of ARABIC_CATEGORIES) {
    if (pattern.test(ar)) return slot;
  }
  return null;
}

/** Pick the reply string for the detected language: Egyptian, else MSA, else English. */
export function localizedReply(lang: LanguageCode, en: string, ar: string, arEg?: string): string {
  if (lang === LANGUAGES.AR_EG) return arEg || ar || en;
  if (lang === LANGUAGES.AR) return ar || en;
  return en;
}
