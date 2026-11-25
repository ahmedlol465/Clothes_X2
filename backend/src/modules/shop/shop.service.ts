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
    const products = await this.productRepo.find({
      where: { inStock: true },
      order: { compatibilityScore: 'DESC' },
      take: 12,
    });
    const picks = products.map((product, index) => ({
      ...product,
      reason: gap.gaps[index]?.reason || product.reason,
    }));
    return { picks, gaps: gap.gaps };
  }

  /** Browseable catalog with optional filters. */
  async products(query: Record<string, any>) {
    const qb = this.productRepo
      .createQueryBuilder('p')
      .orderBy('p.compatibilityScore', 'DESC');
    const store = `${query?.store ?? ''}`.trim();
    const category = `${query?.category ?? ''}`.trim();
    const color = `${query?.color ?? ''}`.trim();
    const q = `${query?.q ?? ''}`.trim();
    const maxPrice = Number(query?.maxPrice);
    if (store) qb.andWhere('p.store = :store', { store });
    if (category && category.toLowerCase() !== 'all') {
      qb.andWhere('p.category = :category', { category });
    }
    if (color) qb.andWhere('p.color = :color', { color });
    if (Number.isFinite(maxPrice) && maxPrice > 0) {
      qb.andWhere('p.price <= :maxPrice', { maxPrice });
    }
    if (q) qb.andWhere('p.name LIKE :q', { q: `%${q}%` });
    if (query?.inStock !== 'all') qb.andWhere('p.inStock = true');
    const rows = await qb.take(100).getMany();
    return { products: rows, count: rows.length };
  }

  async product(id: string) {
    const row = await this.productRepo.findOne({ where: { id } });
    return { product: row };
  }

  /** Distinct filter values for the catalog UI. */
  async facets() {
    const rows = await this.productRepo.find();
    const uniq = (vals: (string | null)[]) =>
      [...new Set(vals.filter((v): v is string => !!v && !!v.trim()))].sort();
    return {
      stores: uniq(rows.map((r) => r.store)),
      categories: uniq(rows.map((r) => r.category)),
      colors: uniq(rows.map((r) => r.color)),
    };
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
