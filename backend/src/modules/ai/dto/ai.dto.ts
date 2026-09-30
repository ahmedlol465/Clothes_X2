import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * What this API returns to the Flutter client, already mapped onto the columns
 * `WardrobeItem` actually has.
 *
 * The mapping is lossy on purpose and the losses are named rather than hidden:
 * the service reports a `status` and a `needs_review` flag that the entity has
 * no column for, so they are surfaced here for the client to decide what to do
 * with, instead of being dropped on the floor or smuggled into a field that
 * already means something else.
 */

/** The values `confidence.status` may take. Mirrors ConfidenceStatus. */
export const CONFIDENCE_STATUSES = [
  'accepted',
  'accepted_with_uncertainty',
  'uncertain',
  'rejected',
] as const;

export type ConfidenceStatusDto = (typeof CONFIDENCE_STATUSES)[number];

/** One analysed garment, flattened for storage. */
export class AnalyzedAttributeDto {
  @ApiProperty({ example: 't-shirt', description: 'Null when the service declined to claim it.' })
  @IsString()
  value: string | null;

  @ApiProperty({ example: 0.66, minimum: 0, maximum: 1 })
  @IsNumber()
  confidence: number;

  @ApiPropertyOptional({ example: 'fashion', description: 'Which model asserted this.' })
  @IsOptional()
  @IsString()
  source?: string;
}

export class AnalyzedItemDto {
  @ApiProperty({ example: 'garment-0', description: 'Identifier from the AI service.' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'top', description: 'Coarse detector group.' })
  @IsString()
  coarseLabel: string;

  @ApiProperty({ type: AnalyzedAttributeDto })
  @ValidateNested()
  @Type(() => AnalyzedAttributeDto)
  category: AnalyzedAttributeDto;

  @ApiPropertyOptional({ type: AnalyzedAttributeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalyzedAttributeDto)
  material?: AnalyzedAttributeDto;

  @ApiPropertyOptional({ type: AnalyzedAttributeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalyzedAttributeDto)
  pattern?: AnalyzedAttributeDto;

  @ApiPropertyOptional({ type: AnalyzedAttributeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalyzedAttributeDto)
  style?: AnalyzedAttributeDto;

  @ApiProperty({ example: 'blue' })
  @IsString()
  color: string | null;

  @ApiProperty({ example: '#2e5aac' })
  @IsString()
  colorHex: string | null;

  @ApiProperty({ type: [String], example: ['white'] })
  @IsArray()
  @IsString({ each: true })
  secondaryColors: string[];

  @ApiProperty({ example: 0.66, minimum: 0, maximum: 1 })
  @IsNumber()
  confidence: number;

  @ApiProperty({ enum: CONFIDENCE_STATUSES })
  @IsIn(CONFIDENCE_STATUSES as unknown as string[])
  status: ConfidenceStatusDto;

  /**
   * True when a validation rule fired or a primary attribute is missing. There
   * is no column for this on `WardrobeItem`, so it is returned rather than
   * persisted. Storing it would need a schema change, which is a deliberate
   * decision rather than something to smuggle in through a service call.
   */
  @ApiProperty({ example: true })
  @IsBoolean()
  needsReview: boolean;

  @ApiPropertyOptional({
    type: [String],
    example: ['color_source_disagreement'],
    description: 'Rule codes that fired.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reviewReason?: string[];

  @ApiProperty({ example: 0.82, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  segmentationQuality?: number;

  @ApiPropertyOptional({ type: [Number], description: '768-d FashionSigLIP embedding.' })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  embedding?: number[];

  @ApiPropertyOptional({ example: 1, description: 'Inference passes, including any retry.' })
  @IsOptional()
  @IsNumber()
  attempts?: number;
}

export class AnalyzeImageResponseDto {
  @ApiProperty({
    example: true,
    description:
      'False means "no clothing found", not "request failed". A rejected photo is a ' +
      'valid answer and is returned with HTTP 200.',
  })
  @IsBoolean()
  success: boolean;

  @ApiProperty({ type: [AnalyzedItemDto] })
  @IsArray()
  @Type(() => AnalyzedItemDto)
  items: AnalyzedItemDto[];

  @ApiPropertyOptional({ example: 'Image quality score too low to analyse' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ example: '9f2c1a...' })
  @IsOptional()
  @IsString()
  analysisId?: string;

  @ApiPropertyOptional({ example: 168.9, description: 'Wall-clock milliseconds in the AI service.' })
  @IsOptional()
  @IsNumber()
  processingMs?: number;

  @ApiPropertyOptional({
    example: 'http',
    description: 'Which path produced this: the AI service, or the in-process fallback.',
  })
  @IsOptional()
  @IsString()
  resolvedBy?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Set when the service was unavailable and the fallback was used.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  warnings?: string[];
}

/** The subset that maps straight onto `WardrobeItem` columns. */
export interface WardrobeItemPatch {
  category: string | null;
  color: string | null;
  secondaryColors: string[] | null;
  pattern: string | null;
  style: string | null;
  material: string | null;
  confidence: number;
  confidenceByAttribute: Record<string, number>;
  embeddings: number[] | null;
}
