/**
 * The wire contract of the Python clothing-analysis service.
 *
 * These mirror `clothing_ai/schemas/models.py`. They are declared as plain
 * interfaces rather than DTO classes because they describe what the *service*
 * returns, not what this API accepts; they are never used as request bodies and
 * validating them on the way in would only cost time.
 *
 * Two things are load-bearing and easy to break:
 *
 * 1. `success: false` is a valid 200 response, not a transport error. "No
 *    clothing item detected" is an answer. Treating it as a failure makes every
 *    ordinary photo look like an outage.
 * 2. An attribute that the service declined to claim is **absent**, not empty
 *    and not null-with-a-fake-score. `category` being `undefined` means the
 *    service would not guess; writing `''` into the database instead would turn
 *    a refusal into a fact.
 */

export type ConfidenceStatus =
  | 'accepted'
  | 'accepted_with_uncertainty'
  | 'uncertain'
  | 'rejected';

/** The seven coarse groups the detector can emit. */
export type CoarseLabel =
  | 'bag'
  | 'bottom'
  | 'dress'
  | 'hat'
  | 'shoes'
  | 'outer'
  | 'top';

export interface AttributePrediction {
  value: string;
  confidence: number;
  /** Which model said it: `fashion`, `detector`, `color`, or `secondary`. */
  source: string;
  /** Full score distribution, useful for showing alternatives in the UI. */
  scores?: Record<string, number>;
  alternatives?: Array<{ value: string; confidence: number }>;
}

export interface ColorResult {
  primary: string;
  primary_hex: string;
  secondary: string[];
  /** Colour name to fraction of masked pixels. Sums to ~1. */
  distribution: Record<string, number>;
  is_multicolor: boolean;
  color_space: string;
  swatches?: string[];
  pixel_count?: number;
  notes?: string[];
}

export interface GarmentAttributes {
  category?: AttributePrediction;
  subcategory?: AttributePrediction;
  color?: ColorResult;
  material?: AttributePrediction;
  pattern?: AttributePrediction;
  style?: AttributePrediction;
}

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GarmentAnalysis {
  id: string;
  bbox: BoundingBox;
  coarse_label: CoarseLabel | string;
  attributes: GarmentAttributes;
  confidence: number;
  status: ConfidenceStatus;
  needs_review: boolean;
  /** Rule codes that fired, e.g. `color_source_disagreement`. */
  review_reason?: string[];
  segmentation_quality?: number;
  /** Base64 PNG of the garment mask, only when requested. */
  mask_png_base64?: string;
  embedding?: number[];
  embedding_model?: string;
  timing_ms?: Record<string, number>;
  attempts?: number;
}

export interface StageTiming {
  model_load_ms?: number;
  decode_ms?: number;
  quality_ms?: number;
  detection_ms?: number;
  segmentation_ms?: number;
  classification_ms?: number;
  color_ms?: number;
  embeddings_ms?: number;
  total_ms?: number;
}

export interface ImageQualityResult {
  score: number;
  usable: boolean;
  issues?: Array<{ code: string; severity: string; message?: string }>;
  metrics?: Record<string, number>;
}

export interface ModelVersions {
  detector?: string | null;
  segmenter?: string | null;
  classifier?: string | null;
  embedder?: string | null;
  pipeline_version?: string | null;
}

export interface AnalysisResult {
  success: boolean;
  items: GarmentAnalysis[];
  image_quality?: ImageQualityResult;
  processing?: StageTiming;
  models?: ModelVersions;
  /** Why there are no items. Present when `success` is false. */
  reason?: string;
  analysis_id?: string;
  request_id?: string;
}

/** The envelope the FastAPI service returns, matching this API's own. */
export interface ClothingServiceEnvelope {
  success: boolean;
  data: AnalysisResult;
  timestamp?: string;
}
