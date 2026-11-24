import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { aiEngine } from '../../common/legacy/legacy-modules';
import { toLegacyItem } from '../planner/planner.service';
import { Wardrobe, WardrobeItem } from '../../database/entities/wardrobe.entity';
import { ShoppingItem, WishlistItem } from '../../database/entities/shopping.entity';

@Injectable()
export class ShopService {
  constructor(
    @InjectRepository(WardrobeItem)
    private readonly itemRepo: Repository<WardrobeItem>,
    @InjectRepository(Wardrobe)
    private readonly wardrobeRepo: Repository<Wardrobe>,
    @InjectRepository(ShoppingItem)
    private readonly productRepo: Repository<ShoppingItem>,
    @InjectRepository(WishlistItem)
    private readonly wishlistRepo: Repository<WishlistItem>,
  ) {}

  private async userWardrobeLegacyItems(userId: string) {
    const wardrobe = await this.wardrobeRepo.findOne({ where: { userId } });
    if (!wardrobe) return [];
    const items = await this.itemRepo.find({
      where: { wardrobeId: wardrobe.id, status: 'active' },
    });
    return items.map(toLegacyItem);
  }

  async recommended(userId: string) {
    const wardrobe = await this.userWardrobeLegacyItems(userId);
    const gap = aiEngine.wardrobeGap(wardrobe);
    const products = await this.productRepo.find({ order: { createdAt: 'ASC' } });
    const picks = products.map((product, index) => ({
      ...product,
      reason: gap.gaps[index]?.reason || product.reason,
    }));
    return { picks, gaps: gap.gaps };
  }

  async beforeYouBuy(userId: string, body: Record<string, any>) {
    const productName = body?.productName || '';
    const color = body?.color || 'White';
    const category = body?.category || 'Tops';
    const probe = {
      id: 'probe',
      name: productName,
      color,
      category,
      style: 'Casual',
      season: 'All Season',
      formality: 'Casual',
    };

    const wardrobe = await this.userWardrobeLegacyItems(userId);
    let best: any = null;
    for (const base of wardrobe.slice(0, 8)) {
      const compat = aiEngine.calculateCompatibility([probe, base], {
        occasion: 'casual',
        weather: { tempC: 24 },
      });
      if (!best || compat.match > best.match) {
        best = { with: base.name, ...compat };
      }
    }

    return {
      productName,
      verdict: (best?.match ?? 0) >= 82 ? 'Worth buying' : 'Skip for now',
      bestMatch: best,
    };
  }

  async wishlist(userId: string) {
    const wishlist = await this.wishlistRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return { wishlist };
  }

  async addWishlist(userId: string, body: Record<string, any>) {
    const entry = this.wishlistRepo.create({
      ...(body || {}),
      userId,
      createdAt: new Date(),
    });
    const saved = await this.wishlistRepo.save(entry);
    return { entry: saved };
  }
}
