import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/auth.decorators';
import { PlannerService } from './planner.service';

@ApiTags('Planner')
@ApiBearerAuth()
@Controller()
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  @Get('events')
  events(@CurrentUser('id') userId: string) {
    return this.planner.events(userId);
  }

  @Post('events')
  createEvent(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.planner.createEvent(userId, body);
  }

  @Patch('events/:id')
  patchEvent(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.planner.patchEvent(userId, id, body);
  }

  @Delete('events/:id')
  deleteEvent(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.planner.deleteEvent(userId, id);
  }

  @Get('planner/weekly')
  week() {
    return this.planner.week();
  }

  @Post('planner/weekly')
  regenerate(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.planner.regenerateWeek(userId, body);
  }

  @Post('travel/packing-list')
  packing(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.planner.packingList(userId, body);
  }
}
