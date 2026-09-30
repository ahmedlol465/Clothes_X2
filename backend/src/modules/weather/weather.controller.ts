import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/auth.decorators';
import { WeatherResponseDto } from './dto/weather.dto';
import { WeatherService } from './weather.service';

@ApiTags('Weather')
@Controller('weather')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get('current')
  @Public()
  @ApiOperation({
    summary: 'Live conditions for a city (keyless Open-Meteo, cached)',
    description:
      'Real data, no API key required. Returns a seasonal estimate with ' +
      '`source: "estimate"` when every provider is unreachable — still ' +
      'usable for outfit scoring, just less precise.',
  })
  @ApiQuery({ name: 'city', required: false, example: 'Cairo' })
  @ApiQuery({
    name: 'lat',
    required: false,
    example: 30.04,
    description: 'Phone GPS latitude. With lon, skips geocoding entirely.',
  })
  @ApiQuery({ name: 'lon', required: false, example: 31.24 })
  @ApiOkResponse({ type: WeatherResponseDto })
  async current(
    @Query('city') city?: string,
    @Query('lat') lat?: string,
    @Query('lon') lon?: string,
  ): Promise<WeatherResponseDto> {
    const latitude = lat === undefined ? undefined : Number(lat);
    const longitude = lon === undefined ? undefined : Number(lon);
    return this.weather.current({
      city,
      lat: latitude,
      lon: longitude,
    });
  }
}
