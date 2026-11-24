import {
  detectLanguage,
  getLanguagePrompt,
  isRTL,
  LANGUAGES,
} from './language';

describe('detectLanguage', () => {
  it('detects English', () => {
    expect(detectLanguage('What should I wear today?')).toBe(LANGUAGES.EN);
  });

  it('detects Modern Standard Arabic', () => {
    expect(detectLanguage('ماذا أرتدي اليوم؟ كيف حالك؟')).toBe(LANGUAGES.AR);
  });

  it('detects Egyptian Arabic from dialect markers', () => {
    expect(detectLanguage('إزاي ألبس كده، عايز لبس للشغل')).toBe(
      LANGUAGES.AR_EG,
    );
  });

  it('prefers dialect over MSA when both scripts appear', () => {
    expect(detectLanguage('ماذا ألبس، أنا عايز حاجة كده')).toBe(
      LANGUAGES.AR_EG,
    );
  });

  it('treats empty and whitespace input as English', () => {
    expect(detectLanguage('')).toBe(LANGUAGES.EN);
    expect(detectLanguage(null)).toBe(LANGUAGES.EN);
  });

  it('handles mixed English and Arabic', () => {
    expect(detectLanguage('عايز outfit للفرح')).toBe(LANGUAGES.AR_EG);
  });
});

describe('getLanguagePrompt / isRTL', () => {
  it('returns an Arabic instruction for Egyptian', () => {
    const prompt = getLanguagePrompt(LANGUAGES.AR_EG);
    expect(prompt).toMatch(/Egyptian|مصري/i);
  });

  it('marks Arabic codes as RTL and English as LTR', () => {
    expect(isRTL(LANGUAGES.AR)).toBe(true);
    expect(isRTL(LANGUAGES.AR_EG)).toBe(true);
    expect(isRTL(LANGUAGES.EN)).toBe(false);
  });
});
