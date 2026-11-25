import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { aiEngine } from '../../../common/legacy/legacy-modules';
import { AnalyzeImageResponseDto } from '../dto/ai.dto';
import { AiService } from '../ai.service';

/**
 * Everything a clothing analyzer needs. Kept intentionally close to the
 * existing `aiEngine.analyzeClothing` input so the local and HTTP analyzers can
 * be swapped without changing the wardrobe or stylist services.
 */
export interface ClothingAnalyzerInput {
  bytes: Buffer;
  filename?: string;
  name?: string;
  category?: string;
  color?: string;
  style?: string;
  pattern?: string;
  material?: string;
  season?: string;
  formality?: string;
  gender?: string;
}

/**
 * The shape the rest of the backend already consumes. `aiEngine` returns a
 * wider object than this; the extra fields are preserved through the index
 * signature so evidence/confidence details are not lost during the swap.
 */
export interface ClothingAnalyzerResult {
  success: boolean;
  source?: string;
  error_type?: string;
  error?: string;
  category?: string;
  color?: string;
  style?: string;
  pattern?: string;
  material?: string;
  season?: string;
  formality?: string;
  gender?: string;
  retake?: string[];
  isOnePiece?: boolean;
  isWinterWear?: boolean;
  suggestedName?: string;
  confidence?: number;
  confidenceKind?: string;
  model?: Record<string, unknown>;
  colorDetail?: Record<string, unknown>;
  uncertainAttributes?: string[];
  analyzedAt?: string;
  [key: string]: unknown;
}

export interface ClothingAnalyzer {
  analyze(input: ClothingAnalyzerInput): Promise<ClothingAnalyzerResult | null>;
}

type AnalyzerMode = 'local' | 'python' | 'auto';

/**
 * Single entry point for clothing analysis.
 *
 * The Python service is the preferred analyzer (better models, shared with
 * `ai-service`), but it must never make wardrobe uploads depend on a sidecar
 * being up. The local transformers.js pipeline is therefore a real fallback,
 * not a mock: a Python outage degrades quality, not availability.
 *
 * Selection is configuration-driven:
 *   AI_ANALYZER=local   local transformers.js only (default, no sidecar)
 *   AI_ANALYZER=python  Python service, falling back to local on outage
 *   AI_ANALYZER=auto    Python when AI_MODE=http, otherwise local
 */
@Injectable()
export class ClothingAnalyzerService implements ClothingAnalyzer {
  private readonly logger = new Logger(ClothingAnalyzerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly python: AiService,
  ) {}

  async analyze(input: ClothingAnalyzerInput): Promise<ClothingAnalyzerResult | null> {
    const mode = this.mode();

    if (mode === 'python' || (mode === 'auto' && this.python.isHttpMode)) {
      const result = await this.analyzeWithPython(input);
      if (result) return result;
      this.logger.warn('Python analyzer unavailable; using the local pipeline.');
    }

    return this.analyzeLocally(input);
  }

  private mode(): AnalyzerMode {
    const configured = String(this.config.get<string>('ai.analyzer') ?? 'local').toLowerCase();
    if (configured === 'python' || configured === 'auto') return configured;
    return 'local';
  }

  private async analyzeWithPython(
    input: ClothingAnalyzerInput,
  ): Promise<ClothingAnalyzerResult | null> {
    try {
      const response = await this.python.analyze({
        image: input.bytes,
        filename: input.filename,
      });
      // `fallback` means the sidecar was unreachable. A real `success: false`
      // answer (non-clothing image) is still a valid answer and is kept.
      if (response.resolvedBy === 'fallback') return null;
      return this.fromPython(response, input);
    } catch (error) {
      this.logger.warn(`Python analyzer failed: ${(error as Error).message}`);
      return null;
    }
  }

  private async analyzeLocally(
    input: ClothingAnalyzerInput,
  ): Promise<ClothingAnalyzerResult | null> {
    try {
      return (await aiEngine.analyzeClothing(input)) as ClothingAnalyzerResult;
    } catch (error) {
      this.logger.warn(`Local analyzer failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Project the Python service's richer, per-garment payload onto the legacy
   * analyzer shape. The first detected garment is the item being added; extra
   * garments are available to callers through `items` when they need them.
   */
  private fromPython(
    response: AnalyzeImageResponseDto,
    input: ClothingAnalyzerInput,
  ): ClothingAnalyzerResult {
    const item = response.items[0];
    if (!response.success || !item) {
      return {
        success: false,
        source: 'ai-service',
        error_type: 'non_clothing',
        error: response.reason ?? 'No clothing item detected.',
        analyzedAt: new Date().toISOString(),
        filename: input.filename,
      };
    }

    const name = [item.color, item.category?.value].filter(Boolean).join(' ').trim();

    return {
      success: true,
      source: 'ai-service',
      category: item.category?.value ?? undefined,
      color: item.color ?? undefined,
      style: item.style?.value ?? undefined,
      pattern: item.pattern?.value ?? undefined,
      material: item.material?.value ?? undefined,
      suggestedName: name || undefined,
      confidence: item.confidence,
      confidenceKind: 'service',
      colorDetail: {
        primary: item.color,
        primaryHex: item.colorHex,
        secondary: item.secondaryColors,
      },
      uncertainAttributes: item.needsReview ? ['needs_review'] : [],
      model: { id: 'ai-service', provider: 'python' },
      analyzedAt: new Date().toISOString(),
      filename: input.filename,
      items: response.items,
      warnings: response.warnings,
    };
  }
}
