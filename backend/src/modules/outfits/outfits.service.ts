import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { aiEngine, memoryStore } from '../../common/legacy/legacy-modules';
import { readStyleProfile } from '../../common/legacy/legacy-style';
import { LegacyItem } from '../../common/legacy/legacy.types';
import {
  Outfit,
  OutfitItem,
  OutfitFeedback,
} from '../../database/entities/outfit.entity';
import { StyleProfile } from '../../database/entities/identity.entity';
import { CreateOutfitDto } from './dto/create-outfit.dto';
import { Wardrobe, WardrobeItem } from '../../database/entities/wardrobe.entity';

@Injectable()
export class OutfitsService {
  constructor(
    @InjectRepository(Outfit)
    private readonly outfitRepo: Repository<Outfit>,
    @InjectRepository(OutfitItem)
    private readonly outfitItemRepo: Repository<OutfitItem>,
    @InjectRepository(OutfitFeedback)
    private readonly feedbackRepo: Repository<OutfitFeedback>,
    @InjectRepository(WardrobeItem)
    private readonly itemRepo: Repository<WardrobeItem>,
    @InjectRepository(Wardrobe)
    private readonly wardrobeRepo: Repository<Wardrobe>,
    @InjectRepository(StyleProfile)
    private readonly styleProfileRepo: Repository<StyleProfile>,
  ) {}

  private async userWardrobeIds(userId: string): Promise<string[]> {
    const wardrobe = await this.wardrobeRepo.findOne({ where: { userId } });
    if (!wardrobe) return [];
    const items = await this.itemRepo.find({
      where: { wardrobeId: wardrobe.id, status: 'active' },
      select: ['id'],
    });
    return items.map((item) => item.id);
  }

  private async userItems(userId: string, itemIds: string[]): Promise<WardrobeItem[]> {
    const ids = await this.userWardrobeIds(userId);
    const allowed = new Set(ids);
    const validIds = itemIds.filter((id) => allowed.has(id));
    if (validIds.length === 0) return [];
    return this.itemRepo.findByIds(validIds);
  }

  private async readMemories(userId: string): Promise<any[]> {
    const row = await this.styleProfileRepo.findOne({ where: { userId } });
    if (!row) return [];
    const dimensions = (row as any).dimensions || {};
    const state = dimensions.legacyStyleMemories ?? dimensions.legacyStyleMemory;
    return Array.isArray(state) ? state : (state ? [state] : []);
  }

  private async writeMemories(userId: string, memories: any[]): Promise<void> {
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
      legacyStyleMemories: memories,
    };
    row.updatedAt = new Date();
    await this.styleProfileRepo.save(row);
  }

  recommended(userId: string, query: Record<string, unknown>) {
    const occasion = String(query.occasion ?? 'casual');
    const tempC = Number(query.tempC ?? 24);
    const count = Number(query.count ?? 3);
    const weather = {
      tempC,
      condition: tempC >= 26 ? 'sunny' : 'partly cloudy',
    };
    return this.userWardrobeIds(userId).then((itemIds) => {
      if (itemIds.length === 0) return Promise.resolve([]);
      return this.itemRepo.find({ where: { id: In(itemIds) } });
    }).then((items) =>
          aiEngine.generateOutfits(items, {
            occasion,
            weather,
            styleProfile: readStyleProfile(null),
            count,
          }),
        )
        .then((outfits) => ({ outfits, weather, occasion }));
  }

  async list(userId: string, query: Record<string, unknown>) {
    const outfits = await this.outfitRepo.find({
      where: { userId },
      relations: ['outfitItems', 'outfitItems.item'],
      order: { createdAt: 'DESC' },
    });
    let filtered = outfits;
    if (String(query.favorite) === 'true') {
      filtered = filtered.filter((outfit) => outfit.isFavorite);
    }
    return { outfits: filtered.map((outfit) => this.toDto(outfit)), total: filtered.length };
  }

  async get(userId: string, id: string) {
    const outfit = await this.outfitRepo.findOne({
      where: { id, userId },
      relations: ['outfitItems', 'outfitItems.item'],
    });
    if (!outfit) throw new NotFoundException('Outfit not found.');
    return { outfit: this.toDto(outfit) };
  }

  private toDto(outfit: Outfit) {
    const links = (outfit.outfitItems ?? [])
      .slice()
      .sort((a, b) => a.layerOrder - b.layerOrder);
    return {
      id: outfit.id,
      name: outfit.name,
      image: outfit.imageUrl,
      occasion: outfit.occasion,
      match: outfit.matchScore,
      pieces: links.map((link) => link.item?.name ?? '').filter(Boolean),
      itemIds: links.map((link) => link.itemId),
      summary: outfit.summary,
      explanation: outfit.explanation,
      favorite: outfit.isFavorite,
      source: outfit.source,
      rating: outfit.rating,
      timesWorn: outfit.timesWorn,
      lastWornAt: outfit.lastWornAt,
      createdAt: outfit.createdAt,
      updatedAt: outfit.updatedAt,
    };
  }


  async create(userId: string, dto: CreateOutfitDto) {
    const b = dto;
    if (!b.name || !b.itemIds?.length) {
      throw new BadRequestException('name and itemIds are required.');
    }

    const items = await this.userItems(userId, b.itemIds);
    if (items.length === 0) {
      throw new BadRequestException('None of those items are in your wardrobe.');
    }

    const compat = aiEngine.calculateCompatibility(
      items.length >= 2 ? items : [],
      {
        occasion: b.occasion || 'casual',
        weather: { tempC: 24 },
        styleProfile: readStyleProfile(null),
      },
    );

    const outfit = this.outfitRepo.create({
      userId,
      name: b.name,
      occasion: b.occasion || 'Casual',
      imageUrl: b.image || items[0]?.imageUrl || null,
      matchScore: compat.match,
      factorBreakdown: (Array.isArray(compat.breakdown)
        ? Object.fromEntries(
            (compat.breakdown as Array<{ key: string; value: number }>).map((f) => [f.key, f.value]),
          )
        : null),
      source: 'manual',
      isFavorite: false,
    });
    const saved = await this.outfitRepo.save(outfit);

    const links = items.map((item, index) =>
      this.outfitItemRepo.create({
        outfitId: saved.id,
        itemId: item.id,
        slot: `piece_${index}`,
        layerOrder: index,
      }),
    );
    if (links.length) await this.outfitItemRepo.save(links);

    return {
      outfit: {
        ...saved,
        itemIds: items.map((item) => item.id),
        pieces: items.map((item) => item.name),
      },
    };
  }

  async patch(userId: string, id: string, body: Record<string, unknown>) {
    const outfit = await this.outfitRepo.findOne({ where: { id, userId } });
    if (!outfit) throw new NotFoundException('Outfit not found.');
    Object.assign(outfit, body || {});
    await this.outfitRepo.save(outfit);
    return { outfit };
  }

  async remove(userId: string, id: string) {
    const outfit = await this.outfitRepo.findOne({ where: { id, userId } });
    if (!outfit) throw new NotFoundException('Outfit not found.');
    await this.outfitRepo.remove(outfit);
    return { ok: true };
  }

  async favorite(userId: string, id: string) {
    const outfit = await this.outfitRepo.findOne({ where: { id, userId } });
    if (!outfit) throw new NotFoundException('Outfit not found.');
    outfit.isFavorite = !outfit.isFavorite;
    outfit.favoritedAt = outfit.isFavorite ? new Date() : null;
    await this.outfitRepo.save(outfit);
    return { outfit };
  }

  async feedback(
    userId: string,
    id: string,
    body: Record<string, any>,
  ) {
    const rating = Number(body?.rating ?? 5);
    const comment = body?.comment ?? '';
    const outfit = await this.outfitRepo.findOne({
      where: { id, userId },
      relations: ['outfitItems', 'outfitItems.item'],
    });
    if (!outfit) throw new NotFoundException('Outfit not found.');

    const feedback = this.feedbackRepo.create({
      id: uuidv4(),
      userId,
      outfitId: id,
      type: 'rated',
      rating,
      comment: comment || null,
    });
    await this.feedbackRepo.save(feedback);

    const items = (outfit.outfitItems || [])
      .map((link) => link.item)
      .filter(Boolean) as unknown as LegacyItem[];

    const db = { styleMemories: await this.readMemories(userId) };
    const memory = memoryStore.record(db, userId, {
      rating,
      items,
      message: comment || null,
    });
    await this.writeMemories(userId, db.styleMemories);

    return {
      ok: true,
      learned: {
        confidence: memoryStore.confidence(memory),
        ratings: memory.totals.ratings,
        signals: memory.totals.chats,
        palette: Object.entries(memory.colors)
          .sort(
            (a, b) =>
              Math.abs((b[1] as number) - 0.5) -
              Math.abs((a[1] as number) - 0.5),
          )
          .slice(0, 5)
          .map(([label, value]) => ({
            label,
            value: Number((value as number).toFixed(3)),
          })),
        notes: memory.facts.slice(0, 3).map((fact: any) => fact.text),
      },
    };
  }
}
