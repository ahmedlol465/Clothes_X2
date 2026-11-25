import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import * as crypto from 'node:crypto';

import { ItemStatus, OutfitSlot, OutfitSource, StyleMemorySource, UserRole } from '../common/vocabularies';
import {
  StyleMemory,
  StyleProfile,
  Subscription,
  User,
  UserProfile,
} from './entities/identity.entity';
import { Wardrobe, WardrobeItem } from './entities/wardrobe.entity';
import { Outfit, OutfitFeedback, OutfitItem } from './entities/outfit.entity';
import { CalendarEvent } from './entities/planner.entity';
import { WeeklyPlan } from './entities/weekly-plan.entity';
import { ShoppingItem } from './entities/shopping.entity';
import { CommunityLook, TrendStyle } from './entities/content.entity';
import {
  DEMO_COMMUNITY_LOOKS,
  DEMO_EMAIL,
  DEMO_EVENTS,
  DEMO_FEEDBACK,
  DEMO_OUTFITS,
  DEMO_PASSWORD,
  DEMO_PRODUCTS,
  DEMO_STYLE_DNA,
  DEMO_STYLE_MEMORY_ID,
  DEMO_STYLE_PROFILE_ID,
  DEMO_TRENDS,
  DEMO_USER_ID,
  DEMO_USER_PROFILE_ID,
  DEMO_WARDROBE,
  DEMO_WARDROBE_ID,
  DEMO_WEEKLY_PLAN,
} from './demo-data';

const SHA256_PASSWORD = crypto.createHash('sha256').update(DEMO_PASSWORD).digest('hex');

export interface SeedReport {
  created: Record<string, number>;
  skipped: Record<string, number>;
}

/**
 * Inserts the demo dataset into whichever database is configured.
 *
 * This is the replacement for the old JSON file store and the client-side
 * `MockData` fallback. It is safe to call repeatedly: every row is checked by
 * its deterministic id first.
 */
export async function seedDemoDatabase(ds: DataSource): Promise<SeedReport> {
  const report: SeedReport = { created: {}, skipped: {} };

  await ds.transaction(async (manager) => {
    await seedUser(manager, report);
    await seedWardrobe(manager, report);
    await seedOutfits(manager, report);
    await seedPlanner(manager, report);
    await seedShopping(manager, report);
    await seedDiscover(manager, report);
  });

  return report;
}

function mark(
  report: SeedReport,
  bucket: 'created' | 'skipped',
  key: string,
): void {
  report[bucket][key] = (report[bucket][key] ?? 0) + 1;
}

async function seedUser(manager: EntityManager, report: SeedReport): Promise<void> {
  const users = manager.getRepository(User);
  const existing = await users.findOne({ where: { email: DEMO_EMAIL } });
  if (existing) {
    mark(report, 'skipped', 'user');
  } else {
    await users.save(
      users.create({
        id: DEMO_USER_ID,
        email: DEMO_EMAIL,
        name: 'Karim Hassan',
        passwordHash: SHA256_PASSWORD,
        role: UserRole.USER,
        emailVerified: true,
        onboardingCompleted: true,
        defaultLocationCountry: 'EG',
        defaultLocationCity: 'Cairo',
      }),
    );
    mark(report, 'created', 'user');
  }

  const profiles = manager.getRepository(UserProfile);
  if (!(await profiles.findOne({ where: { userId: DEMO_USER_ID } }))) {
    await profiles.save(
      profiles.create({
        id: DEMO_USER_PROFILE_ID,
        userId: DEMO_USER_ID,
        firstName: 'Karim',
        lastName: 'Hassan',
        topSize: 'M',
        bottomSize: '32',
        shoeSize: '42',
        heightCm: 178,
        weightKg: 72,
        preferredColors: ['Black', 'White', 'Blue', 'Beige'],
        avoidedColors: [],
        preferredStyles: ['Casual', 'Smart Casual', 'Minimalist', 'Preppy'],
        occasions: ['University', 'Work', 'Casual', 'Formal'],
        fashionStyle: 'minimalist',
        fitPreference: 'regular',
        patternTolerance: 2,
        layeringPreference: 3,
        comfortPreference: 4,
        riskTaking: 4,
        budgetTier: 'balanced',
      }),
    );
    mark(report, 'created', 'userProfile');
  } else {
    mark(report, 'skipped', 'userProfile');
  }

  const styleProfiles = manager.getRepository(StyleProfile);
  if (!(await styleProfiles.findOne({ where: { userId: DEMO_USER_ID } }))) {
    await styleProfiles.save(
      styleProfiles.create({
        id: DEMO_STYLE_PROFILE_ID,
        userId: DEMO_USER_ID,
        archetype: DEMO_STYLE_DNA.archetype,
        dimensions: DEMO_STYLE_DNA.dimensions as unknown as Record<string, number>,
        palette: DEMO_STYLE_DNA.palette,
        categoryMix: DEMO_STYLE_DNA.categoryMix,
        evolution: DEMO_STYLE_DNA.evolution,
        minimalism: DEMO_STYLE_DNA.dimensions.minimalism,
        streetwear: DEMO_STYLE_DNA.dimensions.streetwear,
        formalityBias: DEMO_STYLE_DNA.dimensions.formalityBias,
        colorPreference: DEMO_STYLE_DNA.dimensions.colorPreference,
        patternTolerance: DEMO_STYLE_DNA.dimensions.patternTolerance,
        layeringPreference: DEMO_STYLE_DNA.dimensions.layeringPreference,
        favoriteSilhouettes: ['straight-leg trousers', 'overshirt', 'minimal sneakers'],
        brandPreference: ['COS', 'Uniqlo', 'Arket'],
        overallConfidence: DEMO_STYLE_DNA.overallConfidence,
        lastComputedAt: new Date(),
      }),
    );
    mark(report, 'created', 'styleProfile');
  } else {
    mark(report, 'skipped', 'styleProfile');
  }

  const memories = manager.getRepository(StyleMemory);
  if (!(await memories.findOne({ where: { userId: DEMO_USER_ID, preference: 'neutral_colors' } }))) {
    await memories.save(
      memories.create({
        id: DEMO_STYLE_MEMORY_ID,
        userId: DEMO_USER_ID,
        preference: 'neutral_colors',
        value: 0.91,
        confidence: 0.88,
        source: StyleMemorySource.OUTFIT_FEEDBACK,
        observations: 12,
      }),
    );
    mark(report, 'created', 'styleMemory');
  } else {
    mark(report, 'skipped', 'styleMemory');
  }

  const subscriptions = manager.getRepository(Subscription);
  if (!(await subscriptions.findOne({ where: { userId: DEMO_USER_ID } }))) {
    await subscriptions.save(
      subscriptions.create({
        userId: DEMO_USER_ID,
        plan: 'free',
        status: 'active',
      }),
    );
    mark(report, 'created', 'subscription');
  } else {
    mark(report, 'skipped', 'subscription');
  }
}

async function seedWardrobe(manager: EntityManager, report: SeedReport): Promise<void> {
  const wardrobes = manager.getRepository(Wardrobe);
  if (!(await wardrobes.findOne({ where: { id: DEMO_WARDROBE_ID } }))) {
    await wardrobes.save(
      wardrobes.create({
        id: DEMO_WARDROBE_ID,
        userId: DEMO_USER_ID,
        name: 'My Wardrobe',
        kind: 'primary',
        itemCount: DEMO_WARDROBE.length,
      }),
    );
    mark(report, 'created', 'wardrobe');
  } else {
    mark(report, 'skipped', 'wardrobe');
  }

  const items = manager.getRepository(WardrobeItem);
  for (const row of DEMO_WARDROBE) {
    if (await items.findOne({ where: { id: row.id } })) {
      mark(report, 'skipped', 'wardrobeItems');
      continue;
    }
    await items.save(
      items.create({
        id: row.id,
        wardrobeId: DEMO_WARDROBE_ID,
        name: row.name,
        category: row.category,
        imageUrl: row.image,
        color: row.color,
        pattern: row.pattern,
        style: row.style,
        material: row.material,
        season: row.season,
        formality: row.formality,
        timesWorn: row.timesWorn,
        lastWornLabel: row.lastWornLabel,
        confidence: 0.94,
        occasions: [row.style, row.formality],
        status: ItemStatus.ACTIVE,
      }),
    );
    mark(report, 'created', 'wardrobeItems');
  }
}

function slotForCategory(category: string): string {
  switch (category) {
    case 'Outerwear':
      return OutfitSlot.OUTERWEAR;
    case 'Bottoms':
      return OutfitSlot.BOTTOM;
    case 'Shoes':
      return OutfitSlot.SHOES;
    case 'Accessories':
      return OutfitSlot.ACCESSORY;
    default:
      return OutfitSlot.TOP;
  }
}

async function seedOutfits(manager: EntityManager, report: SeedReport): Promise<void> {
  const outfits = manager.getRepository(Outfit);
  const outfitItems = manager.getRepository(OutfitItem);
  const feedback = manager.getRepository(OutfitFeedback);

  for (const row of DEMO_OUTFITS) {
    if (!(await outfits.findOne({ where: { id: row.id } }))) {
      await outfits.save(
        outfits.create({
          id: row.id,
          userId: DEMO_USER_ID,
          name: row.name,
          imageUrl: row.image,
          occasion: row.occasion,
          source: OutfitSource.AI_RECOMMENDED,
          matchScore: row.match,
          summary: row.pieces.join(' + '),
          explanation: `A curated ${row.occasion.toLowerCase()} look built from your wardrobe.`,
          isFavorite: row.favorite ?? false,
          favoritedAt: row.favorite ? new Date() : null,
          rating: row.favorite ? 5 : null,
        }),
      );
      mark(report, 'created', 'outfits');
    } else {
      mark(report, 'skipped', 'outfits');
    }

    for (let index = 0; index < row.itemIds.length; index += 1) {
      const itemId = row.itemIds[index];
      const existing = await outfitItems.findOne({
        where: { outfitId: row.id, itemId },
      });
      if (existing) {
        mark(report, 'skipped', 'outfitItems');
        continue;
      }
      const item = await manager.getRepository(WardrobeItem).findOne({ where: { id: itemId } });
      await outfitItems.save(
        outfitItems.create({
          outfitId: row.id,
          itemId,
          slot: slotForCategory(item?.category ?? 'Tops'),
          layerOrder: index,
          contribution: 0.8,
        }),
      );
      mark(report, 'created', 'outfitItems');
    }
  }

  for (const row of DEMO_FEEDBACK) {
    if (await feedback.findOne({ where: { id: row.id } })) {
      mark(report, 'skipped', 'outfitFeedback');
      continue;
    }
    await feedback.save(
      feedback.create({
        id: row.id,
        userId: DEMO_USER_ID,
        outfitId: row.outfitId,
        rating: row.rating,
        comment: row.comment,
      }),
    );
    mark(report, 'created', 'outfitFeedback');
  }
}

async function seedPlanner(manager: EntityManager, report: SeedReport): Promise<void> {
  const events = manager.getRepository(CalendarEvent);
  for (const row of DEMO_EVENTS) {
    if (await events.findOne({ where: { id: row.id } })) {
      mark(report, 'skipped', 'events');
      continue;
    }
    await events.save(
      events.create({
        id: row.id,
        userId: DEMO_USER_ID,
        title: row.title,
        startsAtRaw: row.startsAtRaw,
        eventType: row.eventType,
        location: row.location,
        dressCode: row.dressCode,
        source: 'internal',
      }),
    );
    mark(report, 'created', 'events');
  }

  const plan = manager.getRepository(WeeklyPlan);
  if ((await plan.count()) > 0) {
    mark(report, 'skipped', 'weeklyPlan');
    return;
  }
  for (const day of DEMO_WEEKLY_PLAN) {
    await plan.save(
      plan.create({
        weekday: day.weekday,
        date: day.date,
        occasion: day.occasion,
        outfitName: day.outfitName,
        image: day.image,
        outfitId: day.outfitId,
        isToday: day.isToday ?? false,
      }),
    );
    mark(report, 'created', 'weeklyPlan');
  }
}

async function seedShopping(manager: EntityManager, report: SeedReport): Promise<void> {
  const products = manager.getRepository(ShoppingItem);
  for (const row of DEMO_PRODUCTS) {
    if (await products.findOne({ where: { id: row.id } })) {
      mark(report, 'skipped', 'products');
      continue;
    }
    await products.save(
      products.create({
        id: row.id,
        name: row.name,
        category: row.category,
        imageUrl: row.image,
        price: row.price,
        originalPrice: row.originalPrice ?? null,
        currency: 'EGP',
        store: 'Demo Store',
        source: 'seed',
        color: row.color ?? null,
        style: row.style ?? null,
        season: row.season ?? null,
        sizes: row.sizes ?? null,
        inStock: row.inStock ?? true,
        reason: row.reason,
        completesOutfits: 6,
        compatibilityScore: row.compatibilityScore ?? 0.8,
        compatibleColors: ['White', 'Black', 'Beige', 'Navy'],
      }),
    );
    mark(report, 'created', 'products');
  }
}

async function seedDiscover(manager: EntityManager, report: SeedReport): Promise<void> {
  const trends = manager.getRepository(TrendStyle);
  for (const row of DEMO_TRENDS) {
    if (await trends.findOne({ where: { id: row.id } })) {
      mark(report, 'skipped', 'trends');
      continue;
    }
    await trends.save(
      trends.create({
        id: row.id,
        name: row.name,
        tag: row.tag,
        imageUrl: row.image,
        sortOrder: row.sortOrder,
      }),
    );
    mark(report, 'created', 'trends');
  }

  const looks = manager.getRepository(CommunityLook);
  for (const row of DEMO_COMMUNITY_LOOKS) {
    if (await looks.findOne({ where: { id: row.id } })) {
      mark(report, 'skipped', 'communityLooks');
      continue;
    }
    await looks.save(
      looks.create({
        id: row.id,
        name: row.name,
        likes: row.likes,
        imageUrl: row.image,
        sortOrder: row.sortOrder,
      }),
    );
    mark(report, 'created', 'communityLooks');
  }
}

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!(this.config.get<boolean>('seedOnBoot') ?? true)) return;

    const users = this.ds.getRepository(User);
    const count = await users.count();
    if (count > 0) {
      this.logger.log('Database already has users; demo seed skipped.');
      return;
    }

    this.logger.log('Empty database detected; inserting the demo dataset...');
    const report = await seedDemoDatabase(this.ds);
    this.logger.log(`Demo seed complete: ${JSON.stringify(report.created)}`);
  }
}
