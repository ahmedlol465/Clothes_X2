import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/auth.decorators';
import { ShopService } from './shop.service';

@ApiTags('Shopping')
@ApiBearerAuth()
@Controller('shop')
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  @Get('recommended')
  recommended(@CurrentUser('id') userId: string) {
    return this.shop.recommended(userId);
  }

  @Get('products')
  products(@Query() query: Record<string, any>) {
    return this.shop.products(query);
  }

  @Get('products/facets')
  facets() {
    return this.shop.facets();
  }

  @Get('products/:id')
  product(@Param('id') id: string) {
    return this.shop.product(id);
  }

  @Post('outfit-builder')
  outfitBuilder(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.shop.buildOutfitWithinBudget(userId, body);
  }

  @Post('before-you-buy')
  beforeYouBuy(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.shop.beforeYouBuy(userId, body);
  }

  @Get('wishlist')
  wishlist(@CurrentUser('id') userId: string) {
    return this.shop.wishlist(userId);
  }

  @Post('wishlist')
  addWishlist(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.shop.addWishlist(userId, body);
  }
}
