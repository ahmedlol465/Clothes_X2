import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ChatDto {
  @IsString()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsArray()
  history?: Record<string, any>[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  conversationId?: string;

  /** Reply language override from AI Stylist Settings; omit for auto-detect. */
  @IsOptional()
  @IsIn(['ar', 'en'])
  language?: 'ar' | 'en';
}
