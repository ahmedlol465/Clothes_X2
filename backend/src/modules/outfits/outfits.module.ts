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
  providers: [OutfitsService],
  exports: [OutfitsService],
})
export class OutfitsModule {}
