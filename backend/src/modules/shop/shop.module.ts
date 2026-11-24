import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  ShoppingItem,
  Wardrobe,
  WardrobeItem,
  WishlistItem,
} from '../../database/entities';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WardrobeItem, Wardrobe, ShoppingItem, WishlistItem]),
  ],
  controllers: [ShopController],
  providers: [ShopService],
})
export class ShopModule {}
