import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

import {
  AnalysisResult,
  AttributePrediction,
  ClothingServiceEnvelope,
  GarmentAnalysis,
} from './ai.types';
import {
  AnalyzedItemDto,
  AnalyzeImageResponseDto,
  ConfidenceStatusDto,
  WardrobeItemPatch,
} from './dto/ai.dto';

/** Options the AI service understands on its multipart form. */
export interface AnalyzeOptions {
  includeEmbedding?: boolean;
  includeMask?: boolean;
}

export interface AnalyzeParams extends AnalyzeOptions {
  image: Buffer;
  filename?: string;
  mimeType?: string;
  requestId?: string;
}

/**
 * Client for the Python clothing-analysis service.
 *
 * The design rule here is that the AI service being down must not take the
 * wardrobe API down with it. An item that arrives with no attributes is a
 * perfectly storable item: the user names it by hand and fills in the fields.
 * The alternative — a 500 on upload because a sidecar is restarting — means the
 * user cannot add their clothes at all.
 *
 * So every failure path ends in a successful, honest response with a warning
 * attached, never an exception. The one exception is a payload the service
 * cannot possibly work with, which is a client error and is reported as one.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: AxiosInstance;

  private readonly serviceUrl: string;
  private readonly timeoutMs: number;
  private readonly mode: string;
  private readonly minConfidence: number;

  constructor(private readonly config: ConfigService) {
    this.serviceUrl = (this.config.get<string>('ai.serviceUrl') ?? 'http://localhost:8000').replace(
      /\/+$/,
      '',
    );
    this.timeoutMs = this.config.get<number>('ai.timeoutMs') ?? 20_000;
    this.mode = this.config.get<string>('ai.mode') ?? 'rule-engine';
    // Below this the service's own answer is not worth trusting, and a later
    // release of the service could raise its floor, so re-check on this side.
    this.minConfidence = this.config.get<number>('ai.minStoreConfidence') ?? 0.2;

    this.client = axios.create({
      baseURL: this.serviceUrl,
      timeout: this.timeoutMs,
      // A 4 s analysis on a busy CPU is slow, not broken.
      maxBodyLength: 64 * 1024 * 1024,
    });
  }

  get isHttpMode(): boolean {
    return this.mode === 'http';
  }

  /**
   * Analyse one image.
   *
   * Never throws for an infrastructure problem. A malformed request is rejected,
   * because that is the caller's mistake and hiding it would just move the
   * debugging somewhere worse.
   */
  async analyze(params: AnalyzeParams): Promise<AnalyzeImageResponseDto> {
    if (!this.isHttpMode) {
      return this.unavailable('ai.mode is "rule-engine"; no analysis performed');
    }
    if (!params.image?.length) {
      throw new BadRequestException('image is empty');
    }

    try {
      const envelope = await this.post(params);
      const payload = envelope?.data;
      if (!payload) {
        throw new Error('malformed envelope: no data field');
      }
      const mapped = this.map(payload, params.requestId);
      return {
        ...mapped,
        resolvedBy: 'ai-service',
        warnings: mapped.warnings,
      };
    } catch (error) {
      const reason = this.describe(error);
      this.logger.warn(`clothing analysis unavailable: ${reason}`);
      return this.unavailable(reason);
    }
  }

  /** Raw call. Kept separate so the mapping can be tested without a network. */
  private async post(params: AnalyzeParams): Promise<ClothingServiceEnvelope> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(params.image)], { type: params.mimeType ?? 'image/jpeg' }), params.filename ?? 'image.jpg');
    if (params.includeEmbedding) form.append('include_embedding', 'true');
    if (params.includeMask) form.append('include_mask', 'true');
    if (params.requestId) form.append('request_id', params.requestId);

    const response = await this.client.post<ClothingServiceEnvelope>('/api/v1/clothing/analyze', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  /** Whether the service is up and its weights are loaded. */
  async health(): Promise<{ reachable: boolean; status?: string; detail?: string }> {
    if (!this.isHttpMode) return { reachable: false, status: 'disabled' };
    try {
      const response = await this.client.get<{ status?: string }>('/health', { timeout: 2_000 });
      return { reachable: true, status: response.data?.status ?? 'unknown' };
    } catch (error) {
      return { reachable: false, status: 'unreachable', detail: this.describe(error) };
    }
  }

  // ------------------------------------------------------------- mapping --

  /**
   * Convert the service payload into this API's shape.
   *
   * A malformed payload is treated as an unavailable service rather than
   * trusted: half-understood data written to the wardrobe is worse than no data.
   */
  private map(
    result: AnalysisResult,
    requestId?: string,
  ): AnalyzeImageResponseDto {
    if (!result || !Array.isArray(result.items)) {
      throw new Error('malformed analysis payload: expected an items array');
    }

    const items = result.items.map((item) => this.mapItem(item));
    return {
      success: items.length > 0,
      items,
      reason: result.reason,
      analysisId: result.analysis_id ?? requestId,
      processingMs: result.processing?.total_ms,
      warnings: this.warningsFor(result, items),
    };
  }

  private mapItem(item: GarmentAnalysis): AnalyzedItemDto {
    const attributes = item.attributes ?? {};
    return {
      id: item.id,
      coarseLabel: item.coarse_label,
      category: this.attribute(attributes.category),
      material: attributes.material ? this.attribute(attributes.material) : undefined,
      pattern: attributes.pattern ? this.attribute(attributes.pattern) : undefined,
      style: attributes.style ? this.attribute(attributes.style) : undefined,
      color: attributes.color?.primary ?? null,
      colorHex: attributes.color?.primary_hex ?? null,
      secondaryColors: attributes.color?.secondary ?? [],
      confidence: item.confidence,
      status: (item.status ?? 'uncertain') as ConfidenceStatusDto,
      needsReview: Boolean(item.needs_review),
      reviewReason: item.review_reason,
      segmentationQuality: item.segmentation_quality,
      embedding: item.embedding,
      attempts: item.attempts,
    };
  }

  /**
   * An attribute the service omitted stays `null`.
   *
   * It does not become `''`, `0` or `'unknown'`. A blank category in the
   * database reads as "we looked and found nothing", which is a different and
   * false claim.
   */
  private attribute(prediction?: AttributePrediction) {
    if (!prediction) return { value: null, confidence: 0 };
    return { value: prediction.value, confidence: prediction.confidence, source: prediction.source };
  }

  /** The AI service's `success: false` is an answer; say why, do not hide it. */
  private warningsFor(result: AnalysisResult, items: AnalyzedItemDto[]): string[] {
    const warnings: string[] = [];
    if (!result.success && !result.reason) {
      warnings.push('ai-service returned no items and no reason');
    }
    if (result.image_quality && !result.image_quality.usable) {
      warnings.push('image quality was below the usable threshold');
    }
    for (const item of items) {
      if (item.needsReview) {
        warnings.push(
          `item ${item.id} needs review${item.reviewReason?.length ? `: ${item.reviewReason.join(', ')}` : ''}`,
        );
      }
    }
    return warnings;
  }

  /**
   * The degraded response.
   *
   * `success: false` with an empty item list, which the client already handles
   * for "nothing detected". Returning that shape rather than throwing is what
   * keeps an AI outage from becoming an upload outage.
   */
  private unavailable(reason: string): AnalyzeImageResponseDto {
    return {
      success: false,
      items: [],
      reason,
      resolvedBy: 'fallback',
      warnings: [reason],
    };
  }

  private describe(error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') return `timed out after ${this.timeoutMs}ms`;
      const status = error.response?.status;
      const detail = (error.response?.data as { detail?: string } | undefined)?.detail;
      return status ? `ai-service returned ${status}${detail ? `: ${detail}` : ''}` : (error.message ?? 'network error');
    }
    return error instanceof Error ? error.message : String(error);
  }

  // -------------------------------------------------------- persistence --

  /**
   * Project an item onto the `WardrobeItem` columns it can hold.
   *
   * Callers should treat a null attribute as "leave whatever the user already
   * set". A second analysis that is *less* certain than the first must not erase
   * a value the user typed, so this returns nulls rather than empty strings and
   * the caller decides how to merge.
   */
  toWardrobePatch(item: AnalyzedItemDto): WardrobeItemPatch {
    const confidenceByAttribute: Record<string, number> = {};
    if (item.category.value !== null) confidenceByAttribute.category = item.category.confidence;
    if (item.material?.value != null) confidenceByAttribute.material = item.material.confidence;
    if (item.pattern?.value != null) confidenceByAttribute.pattern = item.pattern.confidence;
    if (item.style?.value != null) confidenceByAttribute.style = item.style.confidence;
    // Colour is deliberately absent. The service measures it by clustering the
    // garment's own pixels, so the name is a measurement rather than a model's
    // guess, but it publishes no calibrated confidence for it. Writing 1 here
    // would claim certainty the pipeline never expressed, and `confidenceBy-
    // Attribute` is read as "how sure is this field", so an absent key has to
    // mean "not calibrated" rather than being faked to look complete.

    return {
      category: item.category.value,
      color: item.color,
      secondaryColors: item.secondaryColors.length ? item.secondaryColors : null,
      pattern: item.pattern?.value ?? null,
      style: item.style?.value ?? null,
      material: item.material?.value ?? null,
      confidence: item.confidence,
      confidenceByAttribute,
      embeddings: item.embedding ?? null,
    };
  }

  /**
   * Whether a value is confident enough to overwrite a user-entered one.
   *
   * Deliberately not a rule the service enforces: "never overwrite a human with
   * a model" is a wardrobe decision, and it belongs here rather than in the
   * Python service, which has no idea a human was involved.
   */
  isConfidentEnoughToStore(confidence: number): boolean {
    return Number.isFinite(confidence) && confidence >= this.minConfidence;
  }
}
