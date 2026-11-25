import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsIn, IsBooleanString } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { CLOTHING_CATEGORIES } from '../../../common/vocabularies';

/** `All` is a UI filter, not a stored category, so it is added at the edge. */
export const WARDROBE_CATEGORY_FILTERS = ['All', ...CLOTHING_CATEGORIES];

export class CreateWardrobeItemDto {
  @ApiProperty({ example: 'White Cotton Tee' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Tops' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'White' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ example: 'Casual' })
  @IsOptional()
  @IsString()
  style?: string;

  @ApiPropertyOptional({ example: 'Cotton' })
  @IsOptional()
  @IsString()
  material?: string;

  @ApiPropertyOptional({ example: 'All Season' })
  @IsOptional()
  @IsString()
  season?: string;

  @ApiPropertyOptional({ example: 'Casual' })
  @IsOptional()
  @IsString()
  formality?: string;

  @ApiPropertyOptional({ description: 'Save even if the same piece already exists.' })
  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;

  @ApiPropertyOptional({ example: 'Unisex', enum: ['Male', 'Female', 'Unisex'] })
  @IsOptional()
  @IsIn(['Male', 'Female', 'Unisex'])
  gender?: string;

  @ApiPropertyOptional({ example: 'Plain' })
  @IsOptional()
  @IsString()
  pattern?: string;

  @ApiPropertyOptional({ example: '' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ example: 'assets/images/item_tee_white.jpg' })
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional({ example: 'https://...' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'photo.jpg' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  mime?: string;

  @ApiPropertyOptional({ example: 'base64encoded...' })
  @IsOptional()
  @IsString()
  imageBase64?: string;

  @ApiPropertyOptional({ example: 'analysis data' })
  @IsOptional()
  analysis?: Record<string, unknown>;
}

export class UpdateWardrobeItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  style?: string;
}

export class QueryWardrobeDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '', description: 'Search across name, color, style, category, material' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'All', enum: WARDROBE_CATEGORY_FILTERS })
  @IsOptional()
  @IsString()
  @IsIn(WARDROBE_CATEGORY_FILTERS)
  category?: string;

  @ApiPropertyOptional({ example: 'recent', enum: ['recent', 'worn'] })
  @IsOptional()
  @IsString()
  @IsIn(['recent', 'worn'])
  sort?: string;
}
