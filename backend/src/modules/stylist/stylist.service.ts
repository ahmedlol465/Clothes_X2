import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import {
  aiEngine,
  llm,
  memoryStore,
  retrieval,
  scoring,
  taxonomy,
  vision,
  weatherEngine,
} from '../../common/legacy/legacy-modules';
import { ClothingAnalyzerService } from '../ai/analyzers/clothing-analyzer.service';
import { readStyleProfile } from '../../common/legacy/legacy-style';
import { readStoredImage, sniffImageMime } from '../../common/storage/storage';
import { LegacyItem, LegacyUser } from '../../common/legacy/legacy.types';
import {
  AIConversation,
  AIInteraction,
  AIUsage,
} from '../../database/entities/ai.entity';
import { Outfit, OutfitFeedback } from '../../database/entities/outfit.entity';
import { StyleProfile, User } from '../../database/entities/identity.entity';
import { Wardrobe, WardrobeItem } from '../../database/entities/wardrobe.entity';

import { StylistConversationService } from './services/conversation.service';
import { detectLanguage } from '../../language';
import { StylistContextService } from './services/context.service';
import { StylistChatService } from './services/chat.service';
import { StylistStreamingService } from './services/streaming.service';

/**
 * Thin orchestrator that delegates to focused services:
 * - ConversationService: persistence & recall
 * - ContextService: context assembly, helpers, memory, weather
 * - StreamingService: SSE streaming
 *
 * The public API surface is unchanged for consumers (controller, etc.).
 */
@Injectable()
export class StylistService {
  constructor(
    @InjectRepository(WardrobeItem)
    private readonly itemRepo: Repository<WardrobeItem>,
    @InjectRepository(Wardrobe)
    private readonly wardrobeRepo: Repository<Wardrobe>,
    @InjectRepository(AIConversation)
    private readonly conversationRepo: Repository<AIConversation>,
    @InjectRepository(AIInteraction)
    private readonly interactionRepo: Repository<AIInteraction>,
    @InjectRepository(AIUsage)
    private readonly usageRepo: Repository<AIUsage>,
    @InjectRepository(StyleProfile)
    private readonly styleProfileRepo: Repository<StyleProfile>,
    @InjectRepository(Outfit)
    private readonly outfitRepo: Repository<Outfit>,
    @InjectRepository(OutfitFeedback)
    private readonly feedbackRepo: Repository<OutfitFeedback>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly analyzer: ClothingAnalyzerService,
    private readonly conversationService: StylistConversationService,
    private readonly contextService: StylistContextService,
    private readonly streamingService: StylistStreamingService,
    private readonly chatService: StylistChatService,
  ) {}

  // ---------------------------------------------------------- 8.4 analysis

  async analyzeClothing(userId: string, body: Record<string, any>) {
    const started = Date.now();
    const b = body || {};

    let dataUrl = b.dataUrl || null;
    let bytes: Buffer | null = null;

    if (!dataUrl && b.imageBase64) {
      const base64 = String(b.imageBase64).replace(/^data:[^;]+;base64,/, '');
      dataUrl = `data:${b.mime || 'image/jpeg'};base64,${base64}`;
      try {
        bytes = Buffer.from(base64, 'base64');
      } catch {
        bytes = null;
      }
    }
    if (!dataUrl && b.imageUrl) {
      bytes = readStoredImage(b.imageUrl);
      if (bytes) {
        dataUrl = `data:${sniffImageMime(bytes) || 'image/jpeg'};base64,${bytes.toString('base64')}`;
      } else {
        dataUrl = b.imageUrl;
      }
    }

    const local = (await this.analyzer.analyze({ ...b, bytes })) as any;

    if (local && local.success === false) {
      await this.trackAi('analyze-clothing', Date.now() - started, {
        source: 'clothing-vision',
        rejected: local.error_type,
        userId,
      });
      throw new UnprocessableEntityException({
        // The client shows this verbatim; without it the filter can only say
        // "Request failed" and the user never learns why the photo bounced.
        message:
          local.error ||
          'This image does not look like clothing, so it was not added.',
        analysis: local,
        source: 'clothing-vision',
        rejected: true,
      });
    }

    const base = local || aiEngine.filenameAnalysis(b);
    let source = local ? local.source || 'clothing-vision' : 'filename';
    let tokens: unknown;

    if (dataUrl && llm.status().configured) {
      try {
        const visionOut = await llm.analyzeImage({
          dataUrl,
          hint: b.filename || b.name || '',
        });
        const attrs = visionOut.attrs || {};
        const preferLocal = (key: string) =>
          base[key] && !base.uncertain?.includes(key) ? base[key] : undefined;
        base.color = preferLocal('color') || attrs.color || base.color;
        base.category = preferLocal('category') || attrs.category || base.category;
        base.style = attrs.style || base.style;
        base.pattern = attrs.pattern || base.pattern;
        base.material = attrs.material || base.material;
        base.season = attrs.season || base.season;
        if (attrs.confidence != null) base.visionConfidence = attrs.confidence;
        source += `+${llm.status().provider}`;
        tokens = visionOut.tokens;
      } catch {
        /* keep the local result */
      }
    }

    await this.trackAi('analyze-clothing', Date.now() - started, {
      source,
      tokens,
      userId,
    });
    return { analysis: base, source };
  }

  async generateOutfit(userId: string, body: Record<string, any>) {
    const started = Date.now();
    const b = body || {};
    const weather = b.weather || (await this.contextService.resolveWeather());
    const items = await this.contextService.wardrobe(userId);
    const outfits = aiEngine.generateOutfits(items, {
      occasion: b.occasion || 'casual',
      weather,
      styleProfile: await this.contextService.styleProfile(userId),
      memory: await this.contextService.memory(userId),
      count: b.count || 3,
      anchorItemId: b.anchorItemId,
      excludeIds: b.excludeIds || [],
      focus: b.focus || '',
    });
    await this.trackAi('generate-outfit', Date.now() - started, { userId });
    return { outfits, weather };
  }

  async calculateCompatibility(userId: string, body: Record<string, any>) {
    const started = Date.now();
    const b = body || {};
    const resolved = b.weather || (await this.contextService.resolveWeather());
    const itemIds = b.itemIds || [];
    const items = await Promise.all(
      itemIds.map((id: string) =>
        this.itemRepo.findOne({ where: { id } }),
      ),
    ).then((rows) => rows.filter(Boolean));
    if (items.length < 2) {
      throw new BadRequestException('Provide at least 2 itemIds.');
    }
    const legacyItems = items.map((item) => ({
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
      createdAt: item.createdAt ? item.createdAt.toISOString() : new Date().toISOString(),
      archived: item.status === 'archived',
    }));
    const result = scoring.scoreOutfit(legacyItems, {
      occasion: b.occasion || 'casual',
      weather: resolved,
      styleProfile: await this.contextService.styleProfile(userId),
      memory: await this.contextService.memory(userId),
    });
    await this.trackAi('calculate-compatibility', Date.now() - started, { userId });
    return { ...result, weather: resolved };
  }

  async styleProfileSummary(userId: string) {
    const memory = memoryStore.read(await this.contextService.readMemoriesDb(userId), userId);
    const wardrobe = await this.contextService.wardrobe(userId);
    const feedback = await this.feedbackRepo.find({ where: { userId } });
    return {
      styleProfile: aiEngine.styleProfileFromWardrobe(
        wardrobe,
        feedback.map((f) => ({
          outfitId: f.outfitId,
          rating: f.rating,
          comment: f.comment ?? '',
          at: f.createdAt ? f.createdAt.toISOString() : new Date().toISOString(),
          userId: f.userId,
        })),
      ),
      styleDna: memoryStore.styleDna(memory, wardrobe),
      digest: memoryStore.digest(memory),
    };
  }

  async wardrobeGap(userId: string) {
    const wardrobe = await this.contextService.wardrobe(userId);
    return aiEngine.wardrobeGap(wardrobe);
  }

  async packingList(userId: string, body: Record<string, any>) {
    const wardrobe = await this.contextService.wardrobe(userId);
    return aiEngine.packingList(wardrobe, body || {});
  }

  // ---------------------------------------------------------- chat (non-streaming)

  async chat(userId: string, body: Record<string, any>) {
    return this.chatService.chat(userId, body);
  }

  // ---------------------------------------------------------- SSE streaming

  async chatStream(
    userId: string,
    body: Record<string, any>,
    res: Response,
  ): Promise<void> {
    return this.streamingService.chatStream(userId, body, res);
  }

  // ---------------------------------------------------------- match outfit

  async matchOutfit(
    userId: string,
    body: Record<string, any>,
    file?: Express.Multer.File,
  ) {
    const started = Date.now();
    const wardrobe = await this.contextService.wardrobe(userId);
    if (!wardrobe.length) {
      throw new BadRequestException('Add a few items to your wardrobe first.');
    }

    let dataUrl = body?.dataUrl || body?.imageUrl || null;
    if (!dataUrl && file) {
      const bytes = require('node:fs').readFileSync(file.path);
      dataUrl = `data:${file.mimetype || 'image/jpeg'};base64,${bytes.toString('base64')}`;
    }

    let source = 'rules';
    let tokens: unknown;
    let spec: any;

    try {
      if (dataUrl && llm.status().configured) {
        const visionOut = await llm.describeOutfit({
          dataUrl,
          hint: body?.note || '',
        });
        spec = vision.normaliseSpec(visionOut.spec);
        source = `${llm.status().provider}-vision`;
        tokens = visionOut.tokens;
      } else {
        spec = vision.specFromFilename(body?.filename || '', body?.note || '');
        source = 'filename';
      }
    } catch (error) {
      spec = vision.specFromFilename(body?.filename || '', body?.note || '');
      source = 'filename';
      await this.trackAi('match-outfit', Date.now() - started, {
        source,
        error: (error as Error).message,
        userId,
      });
      return {
        ...vision.matchSpec(spec, wardrobe),
        source: 'filename',
        degraded: true,
      };
    }

    const weather = body?.weather || this.contextService.currentWeather();
    const result = vision.matchSpec(spec, wardrobe, { weather });

    if (result.items.length >= 2) {
      const scored = scoring.scoreOutfit(result.items, {
        occasion: result.reference.occasion || 'casual',
        weather,
        styleProfile: await this.contextService.styleProfile(userId),
        memory: await this.contextService.memory(userId),
      });
      (result as { outfit?: { id: string; name: string; match: number; breakdown: any; explanation: string; itemIds: any[]; pieces: string[]; items: any[]; image: string | null } }).outfit = {
        id: `match-${Date.now()}`,
        name: result.reference.title,
        match: scored.match,
        breakdown: scored.breakdown,
        explanation: scoring.explain(
          result.items,
          { occasion: result.reference.occasion || 'casual', weather },
          scored,
        ),
        itemIds: result.itemIds,
        pieces: result.items.map((item: LegacyItem) => item.name),
        items: result.items,
        image: result.items[0]?.image,
      };
    }

    await this.trackAi('match-outfit', Date.now() - started, {
      source,
      tokens,
      userId,
    });
    return { ...result, source };
  }

  async remix(userId: string, body: Record<string, any>) {
    const started = Date.now();
    const { itemIds = [], variant = 'casual', weather } = body || {};
    const wardrobe = await this.contextService.wardrobe(userId);

    if (!aiEngine.REMIX_TARGETS[variant]) {
      throw new BadRequestException(
        `Unknown variant "${variant}". Try: ${Object.keys(aiEngine.REMIX_TARGETS).join(', ')}.`,
      );
    }
    if (!itemIds.length) throw new BadRequestException('itemIds is required.');

    const items = itemIds
      .map((id: string) => wardrobe.find((item) => item.id === id))
      .filter(Boolean);
    if (!items.length) {
      throw new NotFoundException('None of those items are in your wardrobe.');
    }

    const result = aiEngine.remixOutfit(wardrobe, {
      itemIds: items.map((item: LegacyItem) => item.id),
      variant,
      weather: weather || (await this.contextService.resolveWeather()),
      styleProfile: await this.contextService.styleProfile(userId),
      memory: await this.contextService.memory(userId),
    });
    await this.trackAi('remix', Date.now() - started, {
      source: 'rules',
      variant,
      userId,
    });
    return result;
  }

  async styleDna(userId: string) {
    const memory = memoryStore.read(await this.contextService.readMemoriesDb(userId), userId);
    const wardrobe = await this.contextService.wardrobe(userId);
    return {
      styleDna: memoryStore.styleDna(memory, wardrobe),
      digest: memoryStore.digest(memory),
    };
  }

  async conversations(userId: string, limit = 40) {
    return this.conversationService.listConversations(userId, limit);
  }

  async clearConversations(userId: string) {
    return this.conversationService.clearConversations(userId);
  }

  async capabilities(userId: string) {
    const llmStatus = llm.status();
    const embeddings = await retrieval.status();
    const memory = await this.contextService.memory(userId);
    return {
      llm: llmStatus,
      embeddings,
      weather: { keyless: true, provider: 'open-meteo' },
      memory: memoryStore.digest(memory),
      features: {
        conversationMemory: true,
        streaming: llmStatus.configured,
        visionAnalysis: llmStatus.configured && llmStatus.vision,
        visionOutfitMatching: llmStatus.configured && llmStatus.vision,
        semanticRetrieval: embeddings.embeddings,
        learnedRanking: true,
        remix: true,
        keylessWeather: true,
      },
    };
  }

  // ---------------------------------------------------------- delegation to context service

  async resolveWeather(target?: unknown) {
    return this.contextService.resolveWeather(target);
  }

  async trackAi(endpoint: string, ms: number, extra: Record<string, unknown> = {}): Promise<void> {
    const row = this.usageRepo.create({
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
    });
    await this.usageRepo.save(row);
  }
}