import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/auth.decorators';
import { InsightsService } from './insights.service';

@ApiTags('Insights')
@ApiBearerAuth()
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('style-dna')
  styleDna(@CurrentUser('id') userId: string) {
    return this.insights.styleDna(userId);
  }
}
