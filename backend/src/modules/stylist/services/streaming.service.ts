import {
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';

import { aiEngine, llm, memoryStore } from '../../../common/legacy/legacy-modules';

import { StylistContextService } from './context.service';
import { StylistConversationService } from './conversation.service';
import { detectLanguage } from '../../../language';

/**
 * Handles Server-Sent Events (SSE) streaming for the stylist chat.
 * Writes frames directly to the response; the Nest envelope is bypassed.
 */
@Injectable()
export class StylistStreamingService {
  constructor(
    private readonly contextService: StylistContextService,
    private readonly conversationService: StylistConversationService,
  ) {}

  /**
   * Streams a stylist response over SSE.
   * Emits: 'delta' (text chunks), 'notice' (recoverable errors), 'done' (final payload), 'error' (fatal).
   */
  async chatStream(
    userId: string,
    body: Record<string, any>,
    res: Response,
  ): Promise<void> {
    const { message = '', history = [], conversationId } = body || {};

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    if (!String(message).trim()) {
      send('error', { error: 'message is required.' });
      res.end();
      return;
    }

    const started = Date.now();
    let ctx: any;
    try {
      ctx = await this.contextService.assembleContext(userId, message);
    } catch (error) {
      send('error', { error: (error as Error).message });
      res.end();
      return;
    }

    const aborter = new AbortController();
    res.on('close', () => aborter.abort());

    let text = '';
    let source = 'rules';
    let tokens: unknown;
    const language =
      body?.language === 'ar' || body?.language === 'en'
        ? body.language
        : detectLanguage(message);

    if (llm.status().configured) {
      try {
        source = llm.status().provider;
        for await (const chunk of llm.streamChat({
          message,
          history: history.length
            ? history
            : await this.conversationService.recallTurns(userId, conversationId),
          wardrobe: ctx.shortlist,
          weather: ctx.weather,
          styleProfile: ctx.styleProfile,
          memoryDigest: memoryStore.digest(ctx.memory),
          language,
        })) {
          if (aborter.signal.aborted) break;
          if (chunk.delta) {
            text += chunk.delta;
            send('delta', { delta: chunk.delta });
          }
          if (chunk.done) tokens = chunk.tokens;
        }
      } catch (error) {
        send('notice', {
          error: (error as Error).message,
          recoverable: true,
          source: 'rules',
        });
        source = 'rules';
      }
    }

    if (!text.trim()) {
      const fallback = aiEngine.chatReply(message, {
        wardrobe: ctx.wardrobe,
        weather: ctx.weather,
        styleProfile: ctx.styleProfile,
        memory: ctx.memory,
        language,
      });
      text = fallback.text;
      source = 'rules';
      ctx.outfit = fallback.outfit || null;
      send('delta', { delta: text, synthetic: true });
    } else {
      const named = this.contextService.buildOutfitFromIds(
        this.contextService.idsMentionedIn(text, ctx.wardrobe),
        ctx,
      );
      ctx.outfit =
        named ||
        aiEngine.generateOutfits(ctx.wardrobe, {
          occasion: ctx.occasion,
          weather: ctx.weather,
          styleProfile: ctx.styleProfile,
          memory: ctx.memory,
          count: 1,
        })[0] ||
        null;
    }

    const outfit = ctx.outfit || null;
    if (!text.trim()) {
      send('error', {
        error: 'The stylist could not produce a reply.',
        recoverable: false,
      });
      res.end();
      return;
    }

    const memoryDb = await this.contextService.readMemoriesDb(userId);
    if (this.contextService.learnTurn(memoryDb, userId, message, null)) {
      await this.contextService.writeMemoriesDb(userId, memoryDb);
    }
    await this.conversationService.saveConversation(userId, conversationId, message, text, outfit?.itemIds || []);
    await this.contextService.trackAi('chat/stream', Date.now() - started, {
      source,
      tokens,
      userId,
    });

    send('done', {
      reply: text,
      outfit,
      weather: ctx.weather,
      memory: {
        confidence: memoryStore.confidence(ctx.memory),
        digest: memoryStore.digest(ctx.memory),
      },
      source,
    });
    res.end();
  }
}