import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  aiEngine,
  llm,
  memoryStore,
  retrieval,
  scoring,
  taxonomy,
  vision,
  weatherEngine,
} from '../../../common/legacy/legacy-modules';
import { ClothingAnalyzerService } from '@/modules/ai/analyzers/clothing-analyzer.service';
import { readStyleProfile } from '../../../common/legacy/legacy-style';
import { readStoredImage, sniffImageMime } from '../../../common/storage/storage';
import { LegacyItem, LegacyUser } from '../../../common/legacy/legacy.types';
import { Wardrobe, WardrobeItem } from '../../../database/entities/wardrobe.entity';
import { StyleProfile, User } from '../../../database/entities/identity.entity';
import { Outfit, OutfitFeedback } from '../../../database/entities/outfit.entity';

const LEARN_TRIGGER =
  /\b(hate|love|loves|never|always|avoid|prefer|don'?t like|dont like|no more|too (formal|casual|bright|plain|dressy))\b/i;

export interface StylistContext {
  wardrobe: LegacyItem[];
  shortlist: LegacyItem[];
  memory: any;
  weather: any;
  occasion: string;
  styleProfile: any;
  events: any[];
  outfit: any | null;
}

/**
 * Builds the complete context needed for stylist operations:
 * wardrobe, ranked shortlist, memory, weather, style profile, etc.
 * Also provides helper utilities for building outfits from IDs,
 * detecting mentioned items, and learning from chat.
 */
@Injectable()
export class StylistContextService {
  constructor(
    @InjectRepository(WardrobeItem)
    private readonly itemRepo: Repository<WardrobeItem>,
    @InjectRepository(Wardrobe)
    private readonly wardrobeRepo: Repository<Wardrobe>,
    @InjectRepository(StyleProfile)
    private readonly styleProfileRepo: Repository<StyleProfile>,
    @InjectRepository(OutfitFeedback)
    private readonly feedbackRepo: Repository<OutfitFeedback>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly analyzer: ClothingAnalyzerService,
  ) {}

  // ---------------------------------------------------------- user / wardrobe

  async user(userId: string): Promise<LegacyUser | null> {
    const u = await this.userRepo.findOne({ where: { id: userId } });
    if (!u) return null;
    return {
      id: u.id,
      name: u.email.split('@')[0],
      email: u.email,
      passwordHash: u.passwordHash ?? null,
      createdAt: u.createdAt ? u.createdAt.toISOString() : new Date().toISOString(),
      avatarUrl: u.avatarUrl ?? null,
      styleProfile: {
        favoriteColors: [],
        preferredStyles: [],
        avoidedColors: [],
        heightCm: null,
        weightKg: null,
        fitPreference: 'regular',
        sizes: { top: null, bottom: null, shoe: null },
      },
      tokenVersion: u.tokenVersion ?? 0,
      role: u.role ?? 'user',
    } as LegacyUser;
  }

  async wardrobe(userId: string): Promise<LegacyItem[]> {
    const items = await this.userWardrobeLegacyItems(userId);
    return items.filter((item) => !item.archived);
  }

  async userWardrobeLegacyItems(userId: string): Promise<LegacyItem[]> {
    const wardrobe = await this.wardrobeRepo.findOne({ where: { userId } });
    if (!wardrobe) return [];
    const items = await this.itemRepo.find({
      where: { wardrobeId: wardrobe.id },
    });
    return items.map((item) => ({
      id: item.id,
      userId,
      name: item.name,
      image: item.imageUrl,
      category: item.category ?? 'Tops',
      color: item.color ?? 'White',
      style: item.style ?? 'Casual',
      material: item.material ?? 'Cotton',
      season: item.season ?? 'All Season',
      formality: item.formality ?? 'Casual',
      pattern: item.pattern ?? 'Plain',
      brand: item.brand?.name ?? '',
      timesWorn: item.timesWorn ?? 0,
      lastWornLabel: item.lastWornLabel ?? null,
      createdAt: item.createdAt ? item.createdAt.toISOString() : new Date().toISOString(),
      archived: item.status === 'archived',
    }));
  }

  // ---------------------------------------------------------- style profile / memory

  async styleProfile(userId: string) {
    return readStyleProfile(await this.user(userId));
  }

  async memory(userId: string) {
    return memoryStore.read(await this.readMemoriesDb(userId), userId);
  }

  async readMemoriesDb(userId: string) {
    const row = await this.styleProfileRepo.findOne({ where: { userId } });
    const db: any = { styleMemories: [] };
    if (!row) return db;
    const dimensions = (row as any).dimensions || {};
    const state = dimensions.legacyStyleMemories ?? dimensions.legacyStyleMemory;
    if (Array.isArray(state)) db.styleMemories = state;
    else if (state) db.styleMemories = [state];
    return db;
  }

  async writeMemoriesDb(userId: string, db: any): Promise<void> {
    let row = await this.styleProfileRepo.findOne({ where: { userId } });
    if (!row) {
      row = this.styleProfileRepo.create({
        userId,
        dimensions: {},
        overallConfidence: 0,
      });
    }
    (row as any).dimensions = {
      ...((row as any).dimensions || {}),
      legacyStyleMemories: db.styleMemories,
    };
    row.updatedAt = new Date();
    await this.styleProfileRepo.save(row);
  }

  // ---------------------------------------------------------- context assembly

  /**
   * Assembles the full context for a stylist turn:
   * wardrobe, ranked shortlist, memory, weather, style profile.
   */
  async assembleContext(
    userId: string,
    message = '',
    opts: Record<string, any> = {},
  ): Promise<{
    wardrobe: LegacyItem[];
    shortlist: LegacyItem[];
    memory: any;
    weather: any;
    occasion: string;
    styleProfile: any;
    events: any[];
    outfit: null;
  }> {
    const wardrobe = await this.wardrobe(userId);
    const memory = await this.memory(userId);
    const weather = opts.weather || (await this.resolveWeather());
    const occasion =
      opts.occasion || aiEngine.detectOccasion(message) || 'casual';

    const ranked = await retrieval.rank(message, wardrobe, {
      weather,
      occasion,
      limit: opts.limit || 30,
    });

    return {
      wardrobe,
      shortlist: ranked.map((row: any) => row.item),
      memory,
      weather,
      occasion,
      styleProfile: await this.styleProfile(userId),
      events: [],
      outfit: null,
    };
  }

  // ---------------------------------------------------------- helpers

  /** Detects item IDs mentioned explicitly in user text. */
  idsMentionedIn(text: string, wardrobe: LegacyItem[]): string[] {
    const haystack = taxonomy.normalize(text).replace(/\s+/g, ' ');
    if (haystack.trim().length < 3) return [];

    const escape = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const byId = wardrobe.filter(
      (item) =>
        item.id && new RegExp(`\\b${escape(item.id)}\\b`).test(haystack),
    );
    const byName = wardrobe
      .filter((item) => item.name && item.name.length >= 4)
      .map((item) => ({ item, key: taxonomy.normalize(item.name).trim() }))
      .filter(({ key }) => key && new RegExp(`\\b${escape(key)}\\b`).test(haystack))
      .sort((a, b) => b.item.name.length - a.item.name.length);

    return [
      ...new Set([...byId, ...byName].map((row: any) => (row.item ?? row).id)),
    ];
  }

  /** Learns from user messages containing preference signals. */
  /**
   * Learns from one turn and writes the result back into `db`.
   *
   * `db` is the raw persistence record (`{ styleMemories: [...] }`), not the
   * normalised memory the learner mutates. It must be read into a memory first
   * — `learnChat` expects `avoid`/`colors`/… to exist — and written back after.
   */
  learnTurn(
    db: any,
    userId: string,
    message: string,
    memoryNotes?: string | null,
  ): boolean {
    const sources = [message, memoryNotes].filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    );
    if (!sources.some((value) => LEARN_TRIGGER.test(value))) return false;
    const memory = memoryStore.read(db, userId);
    for (const value of sources) memoryStore.learnChat(memory, value);
    memoryStore.write(db, memory);
    return true;
  }

  /** Builds a complete Outfit object from item IDs. */
  buildOutfitFromIds(ids: string[], ctx: StylistContext, opts: Record<string, any> = {}) {
    const picked: LegacyItem[] = [];
    const seen = new Set<string>();
    for (const id of [...new Set(ids || [])]) {
      const item = ctx.wardrobe.find((row: LegacyItem) => row.id === id);
      if (!item) continue;
      const key = taxonomy.garmentKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(item);
    }
    if (picked.length < 2) return null;

    const occasion = opts.occasion || ctx.occasion;
    const result = scoring.scoreOutfit(picked, {
      occasion,
      weather: ctx.weather,
      styleProfile: ctx.styleProfile,
      memory: ctx.memory,
    });

    return {
      id: `llm-${Date.now()}`,
      name: aiEngine.outfitName(picked, occasion),
      occasion,
      match: result.match,
      breakdown: result.breakdown,
      completeness: ('completeness' in result ? result.completeness : { ratio: 0, filled: [], required: [] }),
      explanation: scoring.explain(
        picked,
        { occasion, weather: ctx.weather },
        result,
      ),
      itemIds: picked.map((item) => item.id),
      pieces: picked.map((item) => item.name),
      items: picked,
      image: picked[0]?.image,
    };
  }

  // ---------------------------------------------------------- weather / memory

  currentWeather(city?: string) {
    return weatherEngine.estimate(city);
  }

  async resolveWeather(target?: unknown) {
    try {
      return await weatherEngine.resolve(target);
    } catch {
      const city =
        typeof target === 'string' ? target : (target as any)?.city;
      return weatherEngine.estimate(city);
    }
  }

  async trackAi(endpoint: string, ms: number, extra: Record<string, unknown> = {}): Promise<void> {
    const row = {
      userId: (extra as any).userId ?? null,
      endpoint: String(endpoint ?? 'unknown'),
      latencyMs: Number(ms) || 0,
      tokens:
        extra.tokens && typeof extra.tokens === 'object'
          ? (Number((extra.tokens as any).prompt) || 0) +
            (Number((extra.tokens as any).completion) || 0)
          : Number(extra.tokens) || 0,
      createdAt: new Date(),
      metadata: { ...extra },
    };
    // We don't have direct access to usageRepo here, so we'll delegate to StylistService
    // This method is kept for interface compatibility but actual tracking happens in StylistService
    console.debug('AI tracking delegated to StylistService:', endpoint, ms, extra);
  }

  // Public getters for fields needed by StylistService
  get itemRepoPublic(): Repository<WardrobeItem> { return this.itemRepo; }
  get feedbackRepoPublic(): Repository<OutfitFeedback> { return this.feedbackRepo; }
  get analyzerPublic(): ClothingAnalyzerService { return this.analyzer; }
  get readStoredImage(): typeof readStoredImage { return readStoredImage; }
  get sniffImageMime(): typeof sniffImageMime { return sniffImageMime; }
}