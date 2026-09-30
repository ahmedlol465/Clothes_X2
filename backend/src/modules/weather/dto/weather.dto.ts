import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/** One day of the 4-day outlook. */
export class ForecastDayDto {
  @ApiProperty({ example: '2026-09-30' })
  @IsString()
  date: string;

  @ApiProperty({ example: 31 })
  @IsNumber()
  highC: number;

  @ApiProperty({ example: 22 })
  @IsNumber()
  lowC: number;

  @ApiProperty({ example: 'partly cloudy' })
  @IsString()
  condition: string;

  @ApiProperty({ example: 5 })
  @IsNumber()
  precipitationChance: number;
}

/** Live conditions plus outlook, as returned by `GET /weather/current`. */
export class WeatherResponseDto {
  @ApiProperty({ example: 28 })
  @IsNumber()
  tempC: number;

  @ApiProperty({ example: 30 })
  @IsNumber()
  feelsLike: number;

  @ApiProperty({ example: 'partly cloudy' })
  @IsString()
  condition: string;

  @ApiProperty({ example: 'partly cloudy cloudy' })
  @IsString()
  tags: string;

  @ApiProperty({ example: 'Cairo' })
  @IsString()
  city: string;

  @ApiPropertyOptional({ example: 'Egypt' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: 55 })
  @IsOptional()
  @IsNumber()
  humidity: number | null;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  precipitationChance: number | null;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsNumber()
  windKph: number | null;

  @ApiProperty({ example: true })
  @IsBoolean()
  isDay: boolean;

  @ApiPropertyOptional({ example: 32 })
  @IsOptional()
  @IsNumber()
  highC: number | null;

  @ApiPropertyOptional({ example: 23 })
  @IsOptional()
  @IsNumber()
  lowC: number | null;

  @ApiProperty({ type: [ForecastDayDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ForecastDayDto)
  forecast: ForecastDayDto[];

  @ApiProperty({
    example: 'open-meteo',
    description:
      '`estimate` means every network call failed and the values are a ' +
      'seasonal guess — still usable for outfit scoring, just less precise.',
  })
  @IsString()
  source: string;

  @ApiProperty({ example: 'Partly Cloudy • 28°C' })
  @IsString()
  summary: string;

  @ApiPropertyOptional({ example: 'fetch failed' })
  @IsOptional()
  @IsString()
  reason?: string;
}
