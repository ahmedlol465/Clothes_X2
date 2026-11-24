import {
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AIConversation, AIInteraction } from '../../../database/entities/ai.entity';

/**
 * Handles conversation persistence, retrieval and capping.
 * Keeps the last N conversations per user.
 *
 * The Flutter client sends its own `conversationId`, which is not the row id.
 * It is stored in `context.conversationId` so a thread keeps appending to the
 * same conversation (and therefore remembers earlier turns) instead of starting
 * a new row on every message.
 */
@Injectable()
export class StylistConversationService {
  constructor(
    @InjectRepository(AIConversation)
    private readonly conversationRepo: Repository<AIConversation>,
    @InjectRepository(AIInteraction)
    private readonly interactionRepo: Repository<AIInteraction>,
  ) {}

  /** The client thread key stored on a conversation row, if any. */
  private keyOf(conversation: AIConversation): string | null {
    const value = (conversation.context as { conversationId?: unknown } | null)
      ?.conversationId;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private async findThread(
    userId: string,
    conversationId: string,
  ): Promise<AIConversation | null> {
    const rows = await this.conversationRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 400,
    });
    return rows.find((row) => this.keyOf(row) === conversationId) ?? null;
  }

  /** Persists a user/assistant turn pair. */
  async saveConversation(
    userId: string,
    conversationId: string | null | undefined,
    message: string,
    reply: string,
    itemIds: string[],
  ): Promise<string> {
    const clientKey = conversationId || null;

    let conv = clientKey ? await this.findThread(userId, clientKey) : null;
    if (conv) {
      conv.messageCount = (conv.messageCount ?? 0) + 2;
      conv.lastMessageAt = new Date();
    } else {
      conv = this.conversationRepo.create({
        id: uuidv4(),
        userId,
        title: message.slice(0, 140),
        channel: 'stylist',
        context: { conversationId: clientKey },
        messageCount: 2,
        lastMessageAt: new Date(),
      } as unknown as AIConversation);
    }
    const savedConv: AIConversation = await this.conversationRepo.save(conv);

    await this.interactionRepo.save([
      this.interactionRepo.create({
        conversationId: savedConv.id,
        role: 'user',
        content: message,
        referencedItemIds: itemIds,
        createdAt: new Date(),
      }),
      this.interactionRepo.create({
        conversationId: savedConv.id,
        role: 'assistant',
        content: reply,
        referencedItemIds: itemIds,
        createdAt: new Date(Date.now() + 1),
      }),
    ]);

    // Cap conversations per user at 400 (keep newest).
    const all = await this.conversationRepo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    if (all.length > 400) {
      const toRemove = all.slice(0, all.length - 400);
      for (const c of toRemove) {
        await this.interactionRepo.delete({ conversationId: c.id });
        await this.conversationRepo.remove(c);
      }
    }

    return savedConv.id;
  }

  /**
   * Returns the real turns of one conversation (oldest first). Without a
   * conversation key it recalls the user's most recent turns across threads.
   */
  async recallTurns(
    userId: string,
    conversationId?: string | null,
    limit = 10,
  ): Promise<{ fromUser: boolean; text: string }[]> {
    const conversations = await this.conversationRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 400,
    });

    const selected = conversationId
      ? conversations.filter((row) => this.keyOf(row) === conversationId)
      : conversations;
    if (selected.length === 0) return [];

    const ids = selected.slice(0, Math.max(1, limit)).map((row) => row.id);
    const interactions = await this.interactionRepo.find({
      where: { conversationId: In(ids) },
      order: { createdAt: 'ASC' },
    });

    return interactions
      .slice(-Math.max(1, limit) * 2)
      .map((row) => ({ fromUser: row.role === 'user', text: row.content }));
  }

  /** Lists conversations for a user (most recent first). */
  async listConversations(userId: string, limit = 40): Promise<{
    turns: { id: string; userId: string; conversationId: string | null; at: string; message: string; reply: string; itemIds: string[] }[];
    total: number;
  }> {
    const capped = Math.min(100, Number(limit) || 40);
    const conversations = await this.conversationRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: capped,
    });

    const turns = [];
    for (const conversation of conversations) {
      const interactions = await this.interactionRepo.find({
        where: { conversationId: conversation.id },
        order: { createdAt: 'ASC' },
        take: 20,
      });
      const userTurn = interactions.find((row) => row.role === 'user');
      const assistantTurn = [...interactions].reverse().find((row) => row.role === 'assistant');
      turns.push({
        id: conversation.id,
        userId: conversation.userId,
        conversationId: this.keyOf(conversation),
        at: conversation.createdAt
          ? conversation.createdAt.toISOString()
          : new Date().toISOString(),
        message: userTurn?.content ?? conversation.title,
        reply: assistantTurn?.content ?? '',
        itemIds: userTurn?.referencedItemIds ?? [],
      });
    }

    return { turns, total: turns.length };
  }

  /** Deletes all conversations for a user. */
  async clearConversations(userId: string): Promise<{ ok: boolean }> {
    const conversations = await this.conversationRepo.find({ where: { userId } });
    for (const conversation of conversations) {
      await this.interactionRepo.delete({ conversationId: conversation.id });
    }
    await this.conversationRepo.delete({ userId });
    return { ok: true };
  }
}
