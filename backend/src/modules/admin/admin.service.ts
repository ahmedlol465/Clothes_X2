import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { llm, retrieval } from '../../common/legacy/legacy-modules';
import { User } from '../../database/entities/identity.entity';
import { WardrobeItem } from '../../database/entities/wardrobe.entity';
import { Outfit } from '../../database/entities/outfit.entity';
import { CalendarEvent } from '../../database/entities/planner.entity';
import { OutfitFeedback } from '../../database/entities/outfit.entity';
import { AIUsage } from '../../database/entities/ai.entity';

const groupBy = (rows: any[], key: string) => {
  const out: Record<string, number> = {};
  for (const row of rows) out[row[key]] = (out[row[key]] || 0) + 1;
  return out;
};

const publicUser = (user: User) => {
  const { passwordHash, tokenVersion, ...rest } = user;
  return rest;
};

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(WardrobeItem)
    private readonly itemRepo: Repository<WardrobeItem>,
    @InjectRepository(Outfit)
    private readonly outfitRepo: Repository<Outfit>,
    @InjectRepository(CalendarEvent)
    private readonly eventRepo: Repository<CalendarEvent>,
    @InjectRepository(OutfitFeedback)
    private readonly feedbackRepo: Repository<OutfitFeedback>,
    @InjectRepository(AIUsage)
    private readonly usageRepo: Repository<AIUsage>,
  ) {}

  async dashboard() {
    const [users] = await this.userRepo.findAndCount();
    const wardrobeItems = await this.itemRepo.count({
      where: { status: 'active' },
    });
    const [outfits] = await this.outfitRepo.findAndCount();
    const [events] = await this.eventRepo.findAndCount();
    const [feedbackCount] = await this.feedbackRepo.findAndCount();
    const [aiCalls] = await this.usageRepo.findAndCount();

    return {
      users,
      wardrobeItems,
      outfits,
      events,
      feedbackCount,
      aiCalls,
    };
  }

  async users() {
    const rows = await this.userRepo.find({
      select: {
        id: true, email: true, role: true, avatarUrl: true,
        onboardingCompleted: true, emailVerified: true, createdAt: true,
        updatedAt: true,
      },
      order: { createdAt: 'DESC' },
    });
    return { users: rows.map(publicUser) };
  }

  async aiPerformance() {
    const usage = await this.usageRepo.find({
      order: { createdAt: 'DESC' },
      take: 500,
    });
    const calls = usage.length;
    const avgMs = calls
      ? Math.round(usage.reduce((sum, row) => sum + (row.latencyMs || 0), 0) / calls)
      : 0;
    const tokens = usage.reduce(
      (acc, row) => {
        acc.prompt += Number((row as any).tokens) || 0;
        return acc;
      },
      { prompt: 0, completion: 0 },
    );

    return {
      totalCalls: calls,
      avgLatencyMs: avgMs,
      byEndpoint: groupBy(usage, 'endpoint'),
      tokens,
      llm: llm.status(),
    };
  }

  async reports() {
    const feedback = await this.feedbackRepo.find({
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return { feedback };
  }

  async systemHealth() {
    return {
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      database: {
        type: 'mysql',
        name: process.env.DB_NAME ?? 'smartwardrobe',
        sourceOfTruth: true,
      },
      llm: llm.status(),
      embeddings: await retrieval.status(),
      weather: {
        provider: 'open-meteo',
        keyless: true,
        keyConfigured: Boolean(process.env.WEATHER_KEY),
        cached: process.env.WEATHER_CITY || 'Cairo',
      },
      modules: {
        scoring: '11-factor + completeness gate',
        learning: 'style-memory (per-attribute, confidence weighted)',
        retrieval: 'two-stage, category balanced',
      },
      runtime: 'NestJS + TypeORM',
    };
  }
}
