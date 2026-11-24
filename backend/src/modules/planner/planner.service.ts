import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { aiEngine } from '../../common/legacy/legacy-modules';
import { readStyleProfile } from '../../common/legacy/legacy-style';
import {
  CalendarEvent,
  EventSchedule,
} from '../../database/entities/planner.entity';
import { WeeklyPlan } from '../../database/entities/weekly-plan.entity';
import { Outfit } from '../../database/entities/outfit.entity';
import { Wardrobe, WardrobeItem } from '../../database/entities/wardrobe.entity';
import { StylistService } from '../stylist/stylist.service';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const OCCASIONS = [
  'Smart Casual',
  'Work',
  'Casual',
  'Dinner',
  'Weekend',
  'Brunch',
  'Relaxed',
];

export function toLegacyItem(item: WardrobeItem) {
  return {
    id: item.id,
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
    archived: item.status === 'archived',
    createdAt: item.createdAt ? item.createdAt.toISOString() : new Date().toISOString(),
  };
}

@Injectable()
export class PlannerService {
  constructor(
    @InjectRepository(CalendarEvent)
    private readonly eventRepo: Repository<CalendarEvent>,
    @InjectRepository(EventSchedule)
    private readonly scheduleRepo: Repository<EventSchedule>,
    @InjectRepository(WeeklyPlan)
    private readonly planRepo: Repository<WeeklyPlan>,
    @InjectRepository(WardrobeItem)
    private readonly itemRepo: Repository<WardrobeItem>,
    @InjectRepository(Wardrobe)
    private readonly wardrobeRepo: Repository<Wardrobe>,
    @InjectRepository(Outfit)
    private readonly outfitRepo: Repository<Outfit>,
    private readonly stylist: StylistService,
  ) {}

  private async userWardrobeLegacyItems(userId: string) {
    const wardrobe = await this.wardrobeRepo.findOne({ where: { userId } });
    if (!wardrobe) return [];
    const items = await this.itemRepo.find({
      where: { wardrobeId: wardrobe.id, status: 'active' },
    });
    return items.map(toLegacyItem);
  }

  events(userId: string) {
    return this.eventRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    }).then((events) => ({ events }));
  }

  async createEvent(userId: string, body: Record<string, any>) {
    const { outfitId, ...eventData } = body || {};
    const event = this.eventRepo.create({
      id: uuidv4(),
      userId,
      ...eventData,
    } as CalendarEvent);
    const saved = await this.eventRepo.save(event);
    if (outfitId) {
      await this.scheduleRepo.save(
        this.scheduleRepo.create({ eventId: saved.id, outfitId }),
      );
    }
    return { event: saved };
  }

  async patchEvent(userId: string, id: string, body: Record<string, unknown>) {
    const event = await this.eventRepo.findOne({ where: { id, userId } });
    if (!event) throw new NotFoundException('Event not found.');
    Object.assign(event, body || {});
    const saved = await this.eventRepo.save(event);
    return { event: saved };
  }

  async deleteEvent(userId: string, id: string) {
    const event = await this.eventRepo.findOne({ where: { id, userId } });
    if (!event) throw new NotFoundException('Event not found.');
    await this.eventRepo.remove(event);
    return { ok: true };
  }

  async week() {
    const plans = await this.planRepo.find({
      order: { createdAt: 'ASC' },
    });
    const ordered = plans.sort(
      (a, b) =>
        WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday),
    );
    return { week: ordered };
  }

  async regenerateWeek(userId: string, body: Record<string, any>) {
    const occasion = body?.occasion || 'casual';
    const items = await this.userWardrobeLegacyItems(userId);
    const weather = await this.stylist.resolveWeather();
    const generated = aiEngine.generateOutfits(items, {
      occasion,
      weather,
      styleProfile: readStyleProfile(null),
      count: 7,
    });

    await this.planRepo.query('DELETE FROM weekly_plans');

    const days = WEEKDAYS.map(
      (weekday, index): Partial<WeeklyPlan> => {
        const pick = generated[index % Math.max(1, generated.length)];
        return {
          id: uuidv4(),
          weekday,
          date: null,
          occasion: OCCASIONS[index],
          outfitName: String(pick?.name) || 'Planned look',
          image: pick?.image || null,
          outfitId: pick?.id || null,
          isToday: index === 0,
        };
      },
    );
    await this.planRepo.save(days);

    const saved = await this.planRepo.find({
      order: { createdAt: 'ASC' },
    });
    const ordered = saved.sort(
      (a, b) =>
        WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday),
    );
    return { week: ordered };
  }

  async packingList(userId: string, body: Record<string, any>) {
    const items = await this.userWardrobeLegacyItems(userId);
    return aiEngine.packingList(items, body || {});
  }
}
