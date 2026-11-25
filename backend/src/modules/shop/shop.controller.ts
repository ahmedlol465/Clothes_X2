import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Public } from '../../common/decorators/auth.decorators';
import { STORAGE_DIR } from '../../common/storage/storage';
import sharp from 'sharp';

import { removePlainBackground } from './cutout.util';
import {
  BeforeYouBuyDto,
  OutfitBuilderDto,
  WishlistEntryDto,
} from './dto/shop.dto';
import { ShopService } from './shop.service';

/** Image hosts of the verified scraped stores (Shopify CDN). */
const CUTOUT_HOSTS = new Set([
  'cdn.shopify.com',
]);

@ApiTags('Shopping')
@ApiBearerAuth()
@Controller('shop')
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  /**
   * Product photo with its plain studio background removed, so pieces can be
   * layered on the avatar figure. Public (it transforms public images), but
   * restricted to the scraped stores' image hosts so it is not an open
   * proxy. Results are cached on disk.
   */
  @Public()
  @Get('cutout')
  async cutout(@Query('u') u: string, @Res() res: Response) {
    let url: URL;
    try {
      url = new URL(`${u ?? ''}`);
    } catch {
      throw new BadRequestException('A valid u=<image url> is required.');
    }
    if (url.protocol !== 'https:' || !CUTOUT_HOSTS.has(url.host)) {
      throw new BadRequestException('Only scraped store images are supported.');
    }
    const key = createHash('sha1').update(url.toString()).digest('hex');
    const dir = path.join(STORAGE_DIR, 'cutouts');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${key}.png`);
    if (!fs.existsSync(file)) {
      const resUp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resUp.ok) throw new NotFoundException('Image not found upstream.');
      const bytes = await sharp(
        Buffer.from(await resUp.arrayBuffer()),
      )
        .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
        .toBuffer();
      fs.writeFileSync(file, await removePlainBackground(bytes));
    }
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    res.send(fs.readFileSync(file));
  }

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
    @Body() body: OutfitBuilderDto,
  ) {
    return this.shop.buildOutfitWithinBudget(userId, body);
  }

  @Post('before-you-buy')
  beforeYouBuy(
    @CurrentUser('id') userId: string,
    @Body() body: BeforeYouBuyDto,
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
    @Body() body: WishlistEntryDto,
  ) {
    return this.shop.addWishlist(userId, body);
  }

  @Delete('wishlist/:id')
  removeWishlist(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.shop.removeWishlist(userId, id);
  }
}
