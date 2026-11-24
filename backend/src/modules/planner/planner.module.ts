import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  CalendarEvent,
  EventSchedule,
  Outfit,
  Wardrobe,
  WardrobeItem,
  WeeklyPlan,
} from '../../database/entities';
import { StylistModule } from '../stylist/stylist.module';
import { PlannerController } from './planner.controller';
import { PlannerService } from './planner.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CalendarEvent,
      EventSchedule,
      WeeklyPlan,
      WardrobeItem,
      Wardrobe,
      Outfit,
    ]),
    StylistModule,
  ],
  controllers: [PlannerController],
  providers: [PlannerService],
})
export class PlannerModule {}
