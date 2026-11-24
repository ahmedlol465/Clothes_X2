import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Wardrobe, WardrobeItem } from '../../database/entities';
import { AiModule } from '../ai/ai.module';
import { WardrobeController } from './wardrobe.controller';
import { WardrobeService } from './wardrobe.service';

@Module({
  imports: [TypeOrmModule.forFeature([Wardrobe, WardrobeItem]), AiModule],
  controllers: [WardrobeController],
  providers: [WardrobeService],
  exports: [WardrobeService],
})
export class WardrobeModule {}
