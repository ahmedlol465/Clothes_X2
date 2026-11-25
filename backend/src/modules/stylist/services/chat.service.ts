import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  aiEngine,
  llm,
  memoryStore,
} from '../../../common/legacy/legacy-modules';
import { AIUsage } from '../../../database/entities/ai.entity';
import { detectLanguage } from '../../../language';
import { StylistContextService } from './context.service';
import { StylistConversationService } from './conversation.service';

/**
 * The chat turn, non-streaming: assemble context, let the LLM answer when
 * configured, fall back to the rule engine, learn from the turn, persist the
 * conversation and track usage. Extracted from StylistService so the
 * orchestrator stays thin; the public API surface is unchanged.
 */
@Injectable()
export class StylistChatService {
  constructor(
    @InjectRepository(AIUsage)
    private readonly usageRepo: Repository<AIUsage>,
    private readonly conversationService: StylistConversationService,
    private readonly contextService: StylistContextService,
  ) {}

  async chat(userId: string, body: Record<string, any>) {
    const started = Date.now();
    const { message = '', history = [], conversationId } = body || {};
    if (!String(message).trim()) {
      throw new BadRequestException('message is required.');
    }

    const ctx = await this.contextService.assembleContext(userId, message);
    const language =
      body?.language === 'ar' || body?.language === 'en'
        ? body.language
        : detectLanguage(message);
    let source = 'rules';
    let reply = '';
    let intent = 'chat';
    let followUp: any = null;
    let constraints: any = { colors: [], styles: [], avoid: [] };
    let occasion = ctx.occasion;
    let tokens: unknown;
    let memoryNotes: string | null = null;

    const serverHistory = history.length
      ? history
      : await this.conversationService.recallTurns(userId, conversationId);

    if (llm.status().configured) {
      try {
        const generated = await llm.stylistChat({
          message,
          history: serverHistory,
          wardrobe: ctx.shortlist,
          weather: ctx.weather,
          styleProfile: ctx.styleProfile,
          memoryDigest: memoryStore.digest(ctx.memory),
          events: ctx.events,
          imageUrl: body?.dataUrl || body?.imageUrl || null,
          language,
        });
        reply = generated.text;
        intent = generated.intent;
        followUp = generated.followUp;
        constraints = generated.constraints;
        memoryNotes = generated.memoryNotes;
        occasion = generated.occasion || occasion;
        tokens = generated.tokens;
        source = llm.status().provider;
        ctx.outfit = this.contextService.buildOutfitFromIds(generated.itemIds, ctx, { occasion }) as any;
      } catch {
        /* rule engine rescues below */
      }
    }

    if (!reply) {
      const fallback = aiEngine.chatReply(message, {
        wardrobe: ctx.wardrobe,
        weather: ctx.weather,
        styleProfile: ctx.styleProfile,
        memory: ctx.memory,
        language,
      });
      reply = fallback.text;
      intent = fallback.intent || 'chat';
      occasion = String(fallback.occasion) || occasion;
      ctx.outfit = (fallback.outfit || null) as any;
      const fbConstraints = (fallback as { constraints?: { colors: unknown[]; styles: unknown[]; avoid: unknown[] } })?.constraints;
      if (!constraints.colors.length && fbConstraints) {
        constraints = fbConstraints;
      }
    }

    const outfit = ctx.outfit || null;
    const memoryDb = await this.contextService.readMemoriesDb(userId);
    if (this.contextService.learnTurn(memoryDb, userId, message, memoryNotes)) {
      await this.contextService.writeMemoriesDb(userId, memoryDb);
    }

    await this.conversationService.saveConversation(userId, conversationId, message, reply, outfit?.itemIds || []);
    await this.trackAi('chat', Date.now() - started, { source, tokens, userId });

    return {
      reply,
      language,
      outfit,
      followUp,
      intent,
      occasion,
      constraints,
      weather: ctx.weather,
      memory: {
        confidence: memoryStore.confidence(ctx.memory),
        digest: memoryStore.digest(ctx.memory),
      },
      conversationId: conversationId || null,
      source,
    };
  }

  private async trackAi(endpoint: string, ms: number, extra: Record<string, unknown> = {}): Promise<void> {
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
