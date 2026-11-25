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

  /**
   * Budget outfit builder: greedily pick the best-value in-stock product for
   * each outfit slot (top, bottom, shoes, then outerwear and an accessory if
   * the budget stretches), then score the set with the same compatibility
   * engine the stylist uses. Returns withinBudget=false when even the core
   * slots do not fit the budget.
   */
  async buildOutfitWithinBudget(userId: string, body: Record<string, any>) {
    const budget = Number(body?.budget);
    if (!Number.isFinite(budget) || budget <= 0) {
      return { error: 'A positive budget is required.' };
    }
    const occasion = `${body?.occasion ?? 'casual'}`;
    // A budget only makes sense in one currency; mixing EGP with AUD/USD
    // catalog rows would produce nonsense totals.
    const currency = `${body?.currency ?? 'EGP'}`;
    const style = body?.style ? `${body.style}`.toLowerCase() : null;
    const gender = body?.gender === 'male' || body?.gender === 'female' ? body.gender : null;
    const excludeIds = new Set(
      Array.isArray(body?.excludeIds) ? body.excludeIds.map((v: unknown) => `${v}`) : [],
    );

    // Gender is a keyword heuristic on the product name: scraped catalogs
    // carry no gender field, so we only exclude obviously-opposite-gendered
    // items and keep everything unknown/unisex eligible.
    // Keyword heuristic over the product title AND its URL handle: scraped
    // catalogs carry no gender field, and store photos often show the
    // garment on a model, so a feminine-coded name is the only signal we
    // have. For men we filter aggressively - the user would rather see a
    // smaller honest set than a women's piece in his outfit.
    const GENDER_MARKERS: Record<string, RegExp> = {
      male: /(women'?s?|womens|ladies|female|girl|dress|skirt|skort|blouse|bra(let)?|leggings?|heels?|cami|crop(ped)?|sculpt|bustier|cardigan|tunic|midi|maxi|bikini|lingerie|maternity|petal|blush|boat[- ]neck|baby[- ]tee)/i,
      female: /\b(men'?s?|mens|male|menswear|boxers?)\b/i,
    };
    const genderOk = (p: ShoppingItem) =>
      !gender ||
      !GENDER_MARKERS[gender].test(`${p.name ?? ''} ${p.productUrl ?? ''}`);

    const products = await this.productRepo.find({
      where: { inStock: true, currency },
      order: { compatibilityScore: 'DESC' },
    });
    // Real scraped products are the point of the catalog; seed rows only
    // backfill a slot the scraped catalog cannot fill at all.
    const scraped = products.filter((p) => p.source === 'scraper');
    const CORE = ['top', 'bottom', 'shoes'];
    const slotName = (category: string) =>
      (
        { Tops: 'top', Bottoms: 'bottom', Shoes: 'shoes', Outerwear: 'outerwear', Accessories: 'accessory' } as
          Record<string, string>
      )[category];
    const eligible = (list: ShoppingItem[]) =>
      list.filter((p) => !excludeIds.has(p.id) && genderOk(p) && slotName(p.category));
    const scrapedSlots = new Set(eligible(scraped).map((p) => slotName(p.category)));
    const pool = CORE.every((c) => scrapedSlots.has(c)) ? scraped : products;

    const bySlot: Record<string, ShoppingItem[]> = {};
    for (const p of pool) {
      if (excludeIds.has(p.id) || !genderOk(p)) continue;
      const slot = (
        { Tops: 'top', Bottoms: 'bottom', Shoes: 'shoes', Outerwear: 'outerwear', Accessories: 'accessory' } as
          Record<string, string>
      )[p.category];
      if (!slot) continue;
      (bySlot[slot] ??= []).push(p);
    }
    // Within a slot, prefer the requested style but keep every product as a
    // fallback so a niche style never empties the slot.
    if (style) {
      for (const list of Object.values(bySlot)) {
        list.sort(
          (a, b) =>
            Number((b.style ?? '').toLowerCase().includes(style)) -
            Number((a.style ?? '').toLowerCase().includes(style)),
        );
      }
    }

    const toProbe = (p: ShoppingItem) => ({
      id: p.id,
      name: p.name,
      color: p.color || 'Neutral',
      category: p.category,
      style: p.style || 'Casual',
      season: p.season || 'All Season',
      formality: p.style || 'Casual',
    });

    const picked: ShoppingItem[] = [];
    let total = 0;
    const take = (slot: string): boolean => {
      const candidates = (bySlot[slot] ?? []).filter(
        (p) => !picked.includes(p) && total + p.price <= budget,
      );
      if (!candidates.length) return false;
      // Coherence rule: among the strongest affordable candidates, pick the
      // piece that scores best WITH the already-picked ones (color harmony,
      // style, formality) instead of the globally best piece.
      const shortlist = candidates.slice(0, 6);
      let best = shortlist[0];
      let bestScore = -1;
      for (const c of shortlist) {
        const score = picked.length
          ? aiEngine.calculateCompatibility(
              [...picked.map(toProbe), toProbe(c)],
              { occasion, weather: { tempC: 24 } },
            ).match
          : c.compatibilityScore;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      picked.push(best);
      total += best.price;
      return true;
    };

    const coreOk = take('top') && take('bottom') && take('shoes');
    if (coreOk) {
      take('outerwear');
      take('accessory');
    }

    const probeItems = picked.map(toProbe);
    const compat = probeItems.length
      ? aiEngine.calculateCompatibility(probeItems, {
          occasion,
          weather: { tempC: 24 },
        })
      : null;

    const slotOf = (category: string) => slotName(category) ?? 'accessory';

    return {
      budget,
      total,
      currency,
      withinBudget: coreOk,
      match: compat?.match ?? null,
      occasion,
      style,
      gender,
      items: picked.map((p) => ({ ...p, slot: slotOf(p.category) })),
    };
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
      relations: { shoppingItem: true },
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

  async removeWishlist(userId: string, id: string) {
    // Scoped to the caller: deleting someone else's wishlist row is a no-op.
    const row = await this.wishlistRepo.findOne({ where: { id, userId } });
    if (!row) return { removed: false };
    await this.wishlistRepo.remove(row);
    return { removed: true };
  }
}
