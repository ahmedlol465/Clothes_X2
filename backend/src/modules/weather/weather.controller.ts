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
  @ApiOkResponse({ type: WeatherResponseDto })
  async current(@Query('city') city?: string): Promise<WeatherResponseDto> {
    return this.weather.current(city);
  }
}
