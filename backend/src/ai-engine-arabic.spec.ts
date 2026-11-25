import * as aiEngine from './ai-engine';

const ARABIC = /[؀-ۿ]/;

const wardrobe = [
  { id: 't1', name: 'White Oxford Shirt', category: 'Tops', color: 'white', timesWorn: 2 },
  { id: 't2', name: 'Navy Tee', category: 'Tops', color: 'navy', timesWorn: 0 },
  { id: 'b1', name: 'Beige Chinos', category: 'Bottoms', color: 'beige', timesWorn: 1 },
  { id: 'b2', name: 'Blue Jeans', category: 'Bottoms', color: 'blue', timesWorn: 5 },
  { id: 's1', name: 'White Sneakers', category: 'Shoes', color: 'white', timesWorn: 8 },
  { id: 's2', name: 'Brown Loafers', category: 'Shoes', color: 'brown', timesWorn: 0 },
];

const ctx = {
  wardrobe,
  weather: { tempC: 24, condition: 'partly cloudy', summary: '24°C', city: 'Cairo' },
  styleProfile: {},
};

describe('chatReply Arabic restoration', () => {
  it('answers an Egyptian outfit request in Egyptian Arabic', () => {
    const r = aiEngine.chatReply('عايز لبس للشغل بكرة', ctx);
    expect(r.intent).toBe('build_outfit');
    expect(r.text).toMatch(ARABIC);
  });

  it('answers a rotation request in Arabic', () => {
    const r = aiEngine.chatReply('فاجئني بحاجة جديدة', ctx);
    expect(r.intent).toBe('build_outfit');
    expect(r.text).toMatch(ARABIC);
  });

  it('answers a weather question in Arabic', () => {
    const r = aiEngine.chatReply('الجو عامل ايه النهاردة', ctx);
    expect(r.intent).toBe('build_outfit');
    expect(r.text).toMatch(ARABIC);
  });

  it('greets back in Arabic', () => {
    const r = aiEngine.chatReply('اهلا', ctx);
    expect(r.intent).toBe('chat');
    expect(r.text).toMatch(ARABIC);
  });

  it('answers MSA in Arabic too', () => {
    const r = aiEngine.chatReply('ماذا أرتدي اليوم؟', ctx);
    expect(r.text).toMatch(ARABIC);
  });

  it('honors an explicit ctx.language over detection', () => {
    const r = aiEngine.chatReply('hello', { ...ctx, language: 'ar-EG' });
    expect(r.text).toMatch(ARABIC);
  });

  it('keeps English replies for English messages', () => {
    const r = aiEngine.chatReply('surprise me', ctx);
    expect(r.intent).toBe('build_outfit');
    expect(r.text).not.toMatch(ARABIC);
  });
});

describe('analyzeClothing with vision unavailable', () => {
  it('falls back to an unverified filename guess instead of throwing', async () => {
    const err: any = new Error('disabled via CLOTHING_VISION=off');
    err.code = 'CLOTHING_VISION_UNAVAILABLE';
    jest.resetModules();
    jest.doMock('./clothing-vision', () => ({
      analyzeClothingImage: jest.fn().mockRejectedValue(err),
    }));
    const engine = require('./ai-engine');
    const result = await engine.analyzeClothing({
      filename: 'blue_shirt.jpg',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    });
    expect(result.success).toBe(true);
    expect(result.verified).toBe(false);
    jest.dontMock('./clothing-vision');
  });
});

describe('wider intents (Arabic and English)', () => {
  it('maps Arabic occasion words to occasions', () => {
    expect(aiEngine.chatReply('عايز لبس للجامعة', ctx).occasion).toBe('university casual');
    expect(aiEngine.chatReply('عندي فرح الاسبوع الجاي', ctx).occasion).toBe('formal dinner');
    expect(aiEngine.chatReply('رايح الجيم', ctx).occasion).toBe('gym');
  });

  it('answers "who are you" in Egyptian Arabic', () => {
    const r = aiEngine.chatReply('انت مين وبتعمل ايه', ctx);
    expect(r.intent).toBe('chat');
    expect(r.text).toMatch(ARABIC);
    expect(r.text).toContain('ستيليست');
  });

  it('answers color questions in Arabic', () => {
    const r = aiEngine.chatReply('ايه الألوان اللي تليق مع بعض', ctx);
    expect(r.text).toMatch(ARABIC);
  });

  it('routes shopping questions to Smart Shopping', () => {
    const r = aiEngine.chatReply('عايز اشتري هدوم جديدة، ايه رأيك', ctx);
    expect(r.text).toMatch(ARABIC);
    expect(r.text).toContain('Smart Shopping');
  });

  it('accepts praise gracefully in both languages', () => {
    expect(aiEngine.chatReply('جامد، عجبني اللوك', ctx).text).toMatch(ARABIC);
    expect(aiEngine.chatReply('love it', ctx).text).not.toMatch(ARABIC);
  });
});
