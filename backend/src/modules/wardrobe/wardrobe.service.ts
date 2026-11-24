import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { aiEngine } from '../../common/legacy/legacy-modules';
import { ClothingAnalyzerService } from '../ai/analyzers/clothing-analyzer.service';
import {
  readStoredImage,
  storageUrl,
} from '../../common/storage/storage';
import { Wardrobe, WardrobeItem } from '../../database/entities/wardrobe.entity';
import { ItemStatus } from '../../common/vocabularies';
import {
  CreateWardrobeItemDto,
  UpdateWardrobeItemDto,
  QueryWardrobeDto,
  WARDROBE_CATEGORY_FILTERS,
} from './dto/create-wardrobe-item.dto';

const DEFAULT_IMAGE = 'assets/images/item_tee_white.jpg';

@Injectable()
export class WardrobeService {
  constructor(
    @InjectRepository(WardrobeItem)
    private readonly itemRepo: Repository<WardrobeItem>,
    @InjectRepository(Wardrobe)
    private readonly wardrobeRepo: Repository<Wardrobe>,
    private readonly analyzer: ClothingAnalyzerService,
  ) {}

  private async userWardrobe(userId: string): Promise<Wardrobe> {
    let wardrobe = await this.wardrobeRepo.findOne({ where: { userId } });
    if (!wardrobe) {
      wardrobe = this.wardrobeRepo.create({
        userId,
        name: 'My Wardrobe',
        kind: 'primary',
      });
      wardrobe = await this.wardrobeRepo.save(wardrobe);
    }
    return wardrobe;
  }

  async list(userId: string, query: QueryWardrobeDto) {
    const search = String(query.search ?? '').toLowerCase();
    const category = String(query.category ?? 'All');
    const sort = String(query.sort ?? 'recent');
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(50, Math.max(1, Number(query.limit ?? 20)));

    const wardrobe = await this.wardrobeRepo.findOne({ where: { userId } });
    if (!wardrobe) {
      return {
        items: [],
        total: 0,
        page,
        limit,
        categories: WARDROBE_CATEGORY_FILTERS,
      };
    }

    const qb = this.itemRepo
      .createQueryBuilder('item')
      .where('item.wardrobeId = :wardrobeId', { wardrobeId: wardrobe.id })
      .andWhere('item.status != :archived', { archived: ItemStatus.ARCHIVED });

    if (category && category !== 'All') {
      qb.andWhere('item.category = :category', { category });
    }
    if (search) {
      qb.andWhere(
        '(LOWER(item.name) LIKE :search OR LOWER(item.color) LIKE :search OR LOWER(item.style) LIKE :search OR LOWER(item.category) LIKE :search OR LOWER(item.material) LIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (sort === 'worn') {
      qb.orderBy('item.timesWorn', 'DESC');
    } else {
      qb.orderBy('item.createdAt', 'DESC');
    }

    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      categories: WARDROBE_CATEGORY_FILTERS,
    };
  }

  async find(userId: string, id: string): Promise<WardrobeItem> {
    const wardrobe = await this.wardrobeRepo.findOne({ where: { userId } });
    if (!wardrobe) throw new NotFoundException('Item not found.');
    const item = await this.itemRepo.findOne({
      where: { id, wardrobeId: wardrobe.id },
    });
    if (!item) throw new NotFoundException('Item not found.');
    return item;
  }

  async create(userId: string, dto: CreateWardrobeItemDto) {
    const b = dto;
    const wardrobe = await this.userWardrobe(userId);

    let analysis = b.analysis || null;

    const bytes =
      aiEngine.imageBytesFor(b) || readStoredImage(b.imageUrl || b.image);
    if (bytes) {
      const result = await this.analyzer
        .analyze({
          filename: b.filename,
          bytes,
          ...(b.name ? { name: b.name } : {}),
          ...(b.category ? { category: b.category } : {}),
          ...(b.color ? { color: b.color } : {}),
          ...(b.style ? { style: b.style } : {}),
          ...(b.pattern ? { pattern: b.pattern } : {}),
          ...(b.material ? { material: b.material } : {}),
          ...(b.season ? { season: b.season } : {}),
          ...(b.formality ? { formality: b.formality } : {}),
        });

      if (result) {
        analysis = result;
        if (result.success !== false) {
          b.category = b.category || result.category;
          b.color = b.color || result.color;
          b.style = b.style || result.style;
          b.pattern = b.pattern || result.pattern;
          b.material = b.material || result.material;
          b.season = b.season || result.season;
          b.formality = b.formality || result.formality;
          b.name = b.name || result.suggestedName;
        }
      }
    }

    const name = b.name;
    if (!name) throw new BadRequestException('name is required.');

    const item = this.itemRepo.create({
      wardrobeId: wardrobe.id,
      name,
      imageUrl: b.image || b.imageUrl || DEFAULT_IMAGE,
      category: b.category || 'Tops',
      color: b.color || 'White',
      style: b.style || 'Casual',
      material: b.material || 'Cotton',
      season: b.season || 'All Season',
      formality: b.formality || 'Casual',
      pattern: b.pattern || 'Plain',
      // `brand` is a relation to the `brands` table, not free text: assigning a
      // string here writes `brandId = ''` and fails the foreign key. A typed
      // brand name is kept as provenance until it can be linked to a row.
      timesWorn: 0,
      lastWornLabel: 'Just added',
      status: ItemStatus.ACTIVE,
      legacy: analysis || b.brand
        ? {
            ...(b.brand ? { brandText: b.brand } : {}),
            analysis,
            analysisSource: analysis.source
              ? analysis.source
              : analysis.success === false
                ? analysis.error_type
                : 'clothing-vision',
            analysisRejected:
              analysis && analysis.success === false
                ? {
                    error_type: analysis.error_type,
                    error: analysis.error,
                    closest: (analysis as any)?.rejected?.closestNonClothing ?? null,
                  }
                : null,
            analysisConfidence:
              Number.isFinite(analysis?.confidence) ? analysis.confidence : null,
            confidenceKind: analysis?.confidenceKind || null,
            agreement:
              Number.isFinite(analysis?.agreement) ? analysis.agreement : null,
            uncertainAttributes: analysis?.uncertainAttributes || [],
            colorDetail: analysis?.colorDetail || null,
            analysisModel: analysis?.model || null,
            analyzedAt: analysis?.analyzedAt || null,
          }
        : null,
    } as any);

    await this.itemRepo.save(item);
    return item;
  }

  async patch(userId: string, id: string, dto: UpdateWardrobeItemDto) {
    const item = await this.find(userId, id);
    Object.assign(item, dto || {});
    await this.itemRepo.save(item);
    return item;
  }

  async archive(userId: string, id: string) {
    const item = await this.find(userId, id);
    item.status = ItemStatus.ARCHIVED;
    await this.itemRepo.save(item);
    return { ok: true };
  }

  async batchUpload(userId: string, body: Record<string, any>) {
    const wardrobe = await this.userWardrobe(userId);
    const rows = Array.isArray(body?.items) ? body.items : [];
    const created = rows.map((b: Record<string, any>) =>
      this.itemRepo.create({
        wardrobeId: wardrobe.id,
        name: b.name || 'Imported piece',
        imageUrl: b.image || b.imageUrl || DEFAULT_IMAGE,
        category: b.category || 'Tops',
        color: b.color || 'White',
        style: b.style || 'Casual',
        material: b.material || 'Cotton',
        season: b.season || 'All Season',
        formality: b.formality || 'Casual',
        pattern: b.pattern || 'Plain',
        // See `create`: brand is a relation, so free text must not go here.
        timesWorn: 0,
        lastWornLabel: 'Just added',
        status: ItemStatus.ACTIVE,
      }),
    );
    await this.itemRepo.save(created);
    return { items: created, total: created.length };
  }

  async collections(userId: string) {
    const wardrobe = await this.wardrobeRepo.findOne({ where: { userId } });
    if (!wardrobe) {
      return { collections: [] };
    }
    const items = await this.itemRepo.find({
      where: { wardrobeId: wardrobe.id, status: ItemStatus.ACTIVE },
    });

    const byCategory: Record<string, WardrobeItem[]> = {};
    for (const item of items) {
      const cat = item.category || 'Tops';
      (byCategory[cat] = byCategory[cat] || []).push(item);
    }
    return {
      collections: Object.entries(byCategory).map(([name, items]) => ({
        name,
        count: items.length,
      })),
    };
  }

  upload(req: Request, files?: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Attach at least one image as photos[].');
    }
    return {
      files: files.map((file) => ({
        url: storageUrl(req, file.filename),
        filename: file.originalname || file.filename,
        storedAs: file.filename,
        mime: file.mimetype,
        size: file.size,
      })),
    };
  }
}
