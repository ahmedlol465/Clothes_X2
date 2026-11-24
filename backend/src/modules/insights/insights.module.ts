import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StyleProfile } from '../../database/entities/identity.entity';
import { Wardrobe, WardrobeItem } from '../../database/entities/wardrobe.entity';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

@Module({
  imports: [TypeOrmModule.forFeature([StyleProfile, Wardrobe, WardrobeItem])],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
