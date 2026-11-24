import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AIUsage,
  CalendarEvent,
  Outfit,
  OutfitFeedback,
  User,
  WardrobeItem,
} from '../../database/entities';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      WardrobeItem,
      Outfit,
      CalendarEvent,
      OutfitFeedback,
      AIUsage,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
