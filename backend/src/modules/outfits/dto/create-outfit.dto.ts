import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsString, IsOptional, MinLength } from 'class-validator';

export class CreateOutfitDto {
  @ApiProperty({ example: 'Friday Casual' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ example: ['item_id_1', 'item_id_2', 'item_id_3'] })
  @IsArray()
  @IsString({ each: true })
  itemIds: string[];

  @ApiPropertyOptional({ example: 'Casual' })
  @IsOptional()
  @IsString()
  occasion?: string;

  @ApiPropertyOptional({ example: 'https://...' })
  @IsOptional()
  @IsString()
  image?: string;
}
