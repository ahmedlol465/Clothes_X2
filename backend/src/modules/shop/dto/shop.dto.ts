import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class WishlistEntryDto {
  @IsOptional()
  @IsString()
  shoppingItemId?: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;
}

export class BeforeYouBuyDto {
  @IsString()
  @MaxLength(200)
  productName: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;
}

export class OutfitBuilderDto {
  @IsNumber()
  @IsPositive()
  budget: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  occasion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}
