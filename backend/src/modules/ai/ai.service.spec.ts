import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AiService } from './ai.service';
import { AnalysisResult, ClothingServiceEnvelope } from './ai.types';

function config(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    'ai.serviceUrl': 'http://localhost:8000',
    'ai.timeoutMs': 20_000,
    'ai.mode': 'http',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

const fullResult: AnalysisResult = {
  success: true,
  items: [
    {
      id: 'g-0',
      bbox: { x1: 1, y1: 2, x2: 3, y2: 4 },
      coarse_label: 'top',
      attributes: {
        category: { value: 't-shirt', confidence: 0.66, source: 'fashion' },
        color: {
          primary: 'blue',
          primary_hex: '#2e5aac',
          secondary: ['white'],
          distribution: { blue: 0.8, white: 0.2 },
          is_multicolor: true,
          color_space: 'lab',
        },
        material: { value: 'cotton', confidence: 0.6, source: 'fashion' },
        pattern: { value: 'solid', confidence: 0.7, source: 'fashion' },
        style: { value: 'casual', confidence: 0.55, source: 'fashion' },
      },
      confidence: 0.66,
      status: 'accepted_with_uncertainty',
      needs_review: true,
      review_reason: ['color_source_disagreement'],
      segmentation_quality: 0.82,
      embedding: [0.1, 0.2, 0.3],
      attempts: 2,
    },
  ],
  processing: { total_ms: 168.9 },
  analysis_id: 'abc123',
};

function service(overrides: Record<string, unknown> = {}): AiService {
  return new AiService(config(overrides));
}

/**
 * Replace the private transport so the mapping is testable without a socket.
 *
 * `post` returns the parsed response body, so the mock resolves to the envelope
 * itself. `analyze` then reads `envelope.data`, which is the `AnalysisResult`.
 */
function stubTransport(target: AiService, envelope: unknown): jest.Mock {
  const mock = jest.fn().mockResolvedValue(envelope);
  (target as unknown as { post: unknown }).post = mock;
  return mock;
}

describe('AiService', () => {
  describe('mode selection', () => {
    it('reports itself as disabled outside http mode', async () => {
      const ai = service({ 'ai.mode': 'rule-engine' });
      expect(ai.isHttpMode).toBe(false);
    });

    it('degrades instead of throwing when the service is switched off', async () => {
      const result = await service({ 'ai.mode': 'rule-engine' }).analyze({
        image: Buffer.from('x'),
      });
      expect(result.success).toBe(false);
      expect(result.items).toEqual([]);
      expect(result.resolvedBy).toBe('fallback');
    });

    it('never calls the network in rule-engine mode', async () => {
      const ai = service({ 'ai.mode': 'rule-engine' });
      const post = jest.fn();
      (ai as unknown as { post: unknown }).post = post;
      await ai.analyze({ image: Buffer.from('x') });
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('mapping', () => {
    it('flattens an analysed item', async () => {
      const ai = service();
      stubTransport(ai, { success: true, data: fullResult } as ClothingServiceEnvelope);

      const result = await ai.analyze({ image: Buffer.from('bytes') });
      const item = result.items[0];

      expect(item.id).toBe('g-0');
      expect(item.coarseLabel).toBe('top');
      expect(item.category).toEqual({ value: 't-shirt', confidence: 0.66, source: 'fashion' });
      expect(item.color).toBe('blue');
      expect(item.colorHex).toBe('#2e5aac');
      expect(item.secondaryColors).toEqual(['white']);
      expect(item.status).toBe('accepted_with_uncertainty');
      expect(item.needsReview).toBe(true);
      expect(item.attempts).toBe(2);
      expect(result.processingMs).toBe(168.9);
      expect(result.resolvedBy).toBe('ai-service');
    });

    it('carries the per-attribute confidence through', async () => {
      const ai = service();
      stubTransport(ai, { success: true, data: fullResult });
      const [item] = (await ai.analyze({ image: Buffer.from('x') })).items;
      expect(item.material?.confidence).toBe(0.6);
      expect(item.pattern?.confidence).toBe(0.7);
    });

    it('surfaces needs_review, which has no column to be stored in', async () => {
      const ai = service();
      stubTransport(ai, { success: true, data: fullResult });
      const result = await ai.analyze({ image: Buffer.from('x') });
      expect(result.items[0].needsReview).toBe(true);
      expect(result.items[0].reviewReason).toEqual(['color_source_disagreement']);
    });

    it('warns about an item that needs review', async () => {
      const ai = service();
      stubTransport(ai, { success: true, data: fullResult });
      const result = await ai.analyze({ image: Buffer.from('x') });
      expect(result.warnings?.join(' ')).toContain('color_source_disagreement');
    });
  });

  describe('absent attributes', () => {
    it('leaves an omitted attribute null rather than inventing a value', async () => {
      const ai = service();
      stubTransport(ai, {
        success: true,
        data: {
          ...fullResult,
          items: [
            {
              ...fullResult.items[0],
              attributes: {
                category: { value: 'jeans', confidence: 0.8, source: 'fashion' },
              },
            },
          ],
        },
      });

      const [item] = (await ai.analyze({ image: Buffer.from('x') })).items;

      // The service declined to claim these. Writing '' or 'unknown' would turn
      // a refusal into a stored fact.
      expect(item.color).toBeNull();
      expect(item.colorHex).toBeNull();
      expect(item.material).toBeUndefined();
      expect(item.pattern).toBeUndefined();
      expect(item.style).toBeUndefined();
    });

    it('defaults secondary colors to an empty array, not undefined', async () => {
      const ai = service();
      stubTransport(ai, {
        success: true,
        data: {
          ...fullResult,
          items: [
            {
              ...fullResult.items[0],
              attributes: {
                category: { value: 'jeans', confidence: 0.8, source: 'fashion' },
                color: {
                  primary: 'indigo',
                  primary_hex: '#2b3a67',
                  secondary: [],
                  distribution: { indigo: 1 },
                  is_multicolor: false,
                  color_space: 'lab',
                },
              },
            },
          ],
        },
      });
      const [item] = (await ai.analyze({ image: Buffer.from('x') })).items;
      expect(item.secondaryColors).toEqual([]);
    });
  });

  describe('degradation', () => {
    it('treats "no clothing found" as an answer, not a failure', async () => {
      const ai = service();
      stubTransport(ai, {
        success: false,
        data: { success: false, items: [], reason: 'No clothing item detected' },
      });

      const result = await ai.analyze({ image: Buffer.from('x') });

      expect(result.success).toBe(false);
      expect(result.items).toEqual([]);
      expect(result.reason).toBe('No clothing item detected');
      expect(result.resolvedBy).toBe('ai-service');
    });

    it('does not throw when the service is unreachable', async () => {
      const ai = service();
      (ai as unknown as { post: unknown }).post = jest.fn().mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), { isAxiosError: true, code: 'ECONNREFUSED' }),
      );

      const result = await ai.analyze({ image: Buffer.from('x') });

      expect(result.success).toBe(false);
      expect(result.resolvedBy).toBe('fallback');
      expect(result.warnings?.length).toBeGreaterThan(0);
    });

    it('reports a timeout in a way an operator can act on', async () => {
      const ai = service();
      (ai as unknown as { post: unknown }).post = jest.fn().mockRejectedValue(
        Object.assign(new Error('timeout of 20000ms exceeded'), {
          isAxiosError: true,
          code: 'ECONNABORTED',
        }),
      );

      const result = await ai.analyze({ image: Buffer.from('x') });
      expect(result.warnings?.join(' ')).toContain('20000ms');
    });

    it('refuses a payload it cannot understand instead of half-mapping it', async () => {
      const ai = service();
      stubTransport(ai, { success: true, data: { success: true } });

      // `items` missing: guessing here would write junk to the wardrobe.
      const result = await ai.analyze({ image: Buffer.from('x') });
      expect(result.success).toBe(false);
      expect(result.resolvedBy).toBe('fallback');
    });

    it('rejects an empty upload as a caller error', async () => {
      const ai = service();
      stubTransport(ai, { success: true, data: fullResult });
      await expect(ai.analyze({ image: Buffer.alloc(0) })).rejects.toThrow(/empty/);
    });

    it('notes an unusable image quality without failing the request', async () => {
      const ai = service();
      stubTransport(ai, {
        success: true,
        data: {
          ...fullResult,
          image_quality: { score: 0.1, usable: false, issues: [] },
        },
      });
      const result = await ai.analyze({ image: Buffer.from('x') });
      expect(result.success).toBe(true);
      expect(result.warnings?.join(' ')).toContain('quality');
    });
  });

  describe('health', () => {
    it('reports disabled without touching the network', async () => {
      const result = await service({ 'ai.mode': 'rule-engine' }).health();
      expect(result).toEqual({ reachable: false, status: 'disabled' });
    });

    it('reports the service status when it answers', async () => {
      const ai = service();
      (ai as unknown as { client: { get: unknown } }).client = {
        get: jest.fn().mockResolvedValue({ data: { status: 'ok' } }),
      };
      await expect(ai.health()).resolves.toEqual({ reachable: true, status: 'ok' });
    });

    it('reports unreachable rather than throwing', async () => {
      const ai = service();
      (ai as unknown as { client: { get: unknown } }).client = {
        get: jest.fn().mockRejectedValue(new Error('down')),
      };
      const result = await ai.health();
      expect(result.reachable).toBe(false);
      expect(result.status).toBe('unreachable');
    });
  });

  describe('WardrobeItem projection', () => {
    const ai = () => service();

    it('maps onto the columns the entity actually has', () => {
      const patch = ai().toWardrobePatch({
        id: 'g-0',
        coarseLabel: 'top',
        category: { value: 't-shirt', confidence: 0.66, source: 'fashion' },
        material: { value: 'cotton', confidence: 0.6, source: 'fashion' },
        pattern: { value: 'solid', confidence: 0.7, source: 'fashion' },
        style: { value: 'casual', confidence: 0.55, source: 'fashion' },
        color: 'blue',
        colorHex: '#2e5aac',
        secondaryColors: ['white'],
        confidence: 0.66,
        status: 'accepted_with_uncertainty',
        needsReview: true,
        embedding: [0.1, 0.2],
      });

      expect(patch).toMatchObject({
        category: 't-shirt',
        color: 'blue',
        secondaryColors: ['white'],
        pattern: 'solid',
        style: 'casual',
        material: 'cotton',
        confidence: 0.66,
        embeddings: [0.1, 0.2],
      });
    });

    it('emits nulls, not blanks, for attributes the service withheld', () => {
      const patch = ai().toWardrobePatch({
        id: 'g-0',
        coarseLabel: 'top',
        category: { value: null, confidence: 0 },
        color: null,
        colorHex: null,
        secondaryColors: [],
        confidence: 0.1,
        status: 'rejected',
        needsReview: true,
      });

      // A blank string here would look like "we checked and it has no pattern".
      expect(patch.category).toBeNull();
      expect(patch.pattern).toBeNull();
      expect(patch.material).toBeNull();
      expect(patch.secondaryColors).toBeNull();
      expect(patch.embeddings).toBeNull();
    });

    it('records per-attribute confidence only for attributes it has', () => {
      const patch = ai().toWardrobePatch({
        id: 'g-0',
        coarseLabel: 'top',
        category: { value: 't-shirt', confidence: 0.66, source: 'fashion' },
        color: 'blue',
        colorHex: '#2e5aac',
        secondaryColors: [],
        confidence: 0.66,
        status: 'accepted',
        needsReview: false,
      });

      // Colour is measured, not classified, and carries no calibrated
      // confidence. Reporting 1 would be a claim the service never made.
      expect(patch.confidenceByAttribute).toEqual({ category: 0.66 });
      expect(patch.confidenceByAttribute).not.toHaveProperty('material');
      expect(patch.confidenceByAttribute).not.toHaveProperty('color');
      // The value itself is still returned; only its confidence is withheld.
      expect(patch.color).toBe('blue');
    });
  });

  describe('storage policy', () => {
    it('refuses to overwrite a user value with a barely-confident guess', () => {
      const ai = service({ 'ai.minStoreConfidence': 0.4 });
      expect(ai.isConfidentEnoughToStore(0.5)).toBe(true);
      expect(ai.isConfidentEnoughToStore(0.2)).toBe(false);
    });

    it('rejects a non-numeric confidence rather than storing NaN', () => {
      const ai = service();
      expect(ai.isConfidentEnoughToStore(Number.NaN)).toBe(false);
    });
  });
});

describe('AiService as a Nest provider', () => {
  it('is injectable and exports itself', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AiService, { provide: ConfigService, useValue: config() }],
    }).compile();

    expect(moduleRef.get(AiService)).toBeInstanceOf(AiService);
    await moduleRef.close();
  });
});

describe('configuration', () => {
  /**
   * Every `ai.*` key the service reads must exist in `aiConfig`. A key that is
   * read but never defined is not a default, it is a silent `undefined` that
   * happens to work right until someone tightens the type.
   */
  it('defines every ai key the service depends on', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { aiConfig } = require('../../config/configuration') as {
      aiConfig: () => Record<string, unknown>;
    };
    const defined = aiConfig();

    for (const key of ['serviceUrl', 'timeoutMs', 'mode', 'minStoreConfidence']) {
      expect(defined).toHaveProperty(key);
      expect(defined[key]).toBeDefined();
    }
  });

  it('defaults to rule-engine so a fresh checkout does not call a service that is not running', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { aiConfig } = require('../../config/configuration') as {
      aiConfig: () => Record<string, unknown>;
    };
    expect(aiConfig().mode).toBe('rule-engine');
  });

  it('keeps the storage floor inside the 0-1 range', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { aiConfig } = require('../../config/configuration') as {
      aiConfig: () => Record<string, unknown>;
    };
    const value = Number(aiConfig().minStoreConfidence);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });
});
