import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  Outfit,
  OutfitFeedback,
  OutfitItem,
  StyleProfile,
  Wardrobe,
  WardrobeItem,
} from '../../database/entities';
import { OutfitsController } from './outfits.controller';
import { OutfitIntentService } from './outfit-intent.service';
import { OutfitReasonService } from './outfit-reason.service';
import { OutfitsService } from './outfits.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Outfit,
      OutfitItem,
      OutfitFeedback,
      Wardrobe,
      WardrobeItem,
      StyleProfile,
    ]),
  ],
  controllers: [OutfitsController],
  providers: [OutfitsService, OutfitIntentService, OutfitReasonService],
  exports: [OutfitsService],
})
export class OutfitsModule {}
