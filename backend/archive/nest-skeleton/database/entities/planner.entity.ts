import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { OutfitSlot } from '../../common/vocabularies';
import { Outfit } from './outfit.entity';
import { WardrobeItem } from './identity.entity';

/** Section 4.11 Event Scheduler / Calendar. */
@Entity('calendar_events')
@Index(['userId', 'startsAt'])
export class CalendarEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ length: 160 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ length: 40, default: 'Meeting' })
  eventType: string;

  @Column({ length: 40, nullable: true })
  occasion: string | null;

  @Column({ type: 'datetime' })
  startsAt: Date;

  @Column({ type: 'datetime', nullable: true })
  endsAt: Date | null;

  @Column({ length: 160, nullable: true })
  location: string | null;

  @Column({ length: 40, nullable: true })
  dressCode: string | null;

  @Column({ length: 40, default: 'internal' })
  source: string;

  @Column({ length: 255, nullable: true })
  externalId: string | null;

  @Column({ type: 'simple-json', nullable: true })
  attendees: string[] | null;

  @Column({ default: false })
  outfitAssigned: boolean;

  @Column({ type: 'int', nullable: true })
  reminderMinutesBefore: number | null;

  @Column({ default: true })
  remindEnabled: boolean;

  @Column({ default: false })
  reminderSent: boolean;

  @Column({ type: 'simple-json', nullable: true })
  weatherSnapshot: Record<string, unknown> | null;

  @Column({ type: 'simple-array', default: '' })
  tags: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => EventSchedule, (schedule) => schedule.event, {
    cascade: true,
  })
  schedules: EventSchedule[];
}

/** Section 4.11 "Outfit assignment" + section 7 entity `EventSchedule`. */
@Entity('event_schedules')
@Index(['eventId', 'status'])
export class EventSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  eventId: string;

  @ManyToOne(() => CalendarEvent, (event) => event.schedules, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'eventId' })
  event: CalendarEvent;

  @Index()
  @Column()
  outfitId: string;

  @ManyToOne(() => Outfit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'outfitId' })
  outfit: Outfit | null;

  @Column({ length: 20, default: 'planned' })
  status: string;

  @Column({ type: 'int', default: 0 })
  matchScore: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** "Prepare outfit in advance" - how long before the event to be ready. */
  @Column({ default: false })
  prepareInAdvance: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Section 7 entity `WeatherSnapshot`; also powers the Home weather card. */
@Entity('weather_snapshots')
@Index(['userId', 'capturedAt'])
export class WeatherSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ length: 120 })
  location: string;

  @Column({ length: 10, nullable: true })
  country: string | null;

  @Column({ type: 'float' })
  temperatureC: number;

  @Column({ type: 'float', nullable: true })
  feelsLikeC: number | null;

  @Column({ type: 'float', nullable: true })
  tempMinC: number | null;

  @Column({ type: 'float', nullable: true })
  tempMaxC: number | null;

  @Column({ length: 60 })
  condition: string;

  @Column({ length: 60, nullable: true })
  description: string | null;

  @Column({ length: 40, nullable: true })
  icon: string | null;

  @Column({ type: 'int', nullable: true })
  humidity: number | null;

  @Column({ type: 'float', nullable: true })
  windSpeed: number | null;

  @Column({ type: 'int', nullable: true })
  precipitationChance: number | null;

  @Column({ type: 'float', nullable: true })
  uvIndex: number | null;

  @Column({ length: 20, default: 'forecast' })
  kind: string;

  @Column({ length: 20, default: 'openweathermap' })
  provider: string;

  @Column({ type: 'simple-json', nullable: true })
  forecast: Array<{
    date: string;
    tempMinC: number;
    tempMaxC: number;
    condition: string;
    precipitationChance: number;
  }> | null;

  @CreateDateColumn({ name: 'capturedAt' })
  capturedAt: Date;
}

/** Section 4.12 Travel Mode. */
@Entity('trips')
@Index(['userId', 'startsOn'])
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ length: 120 })
  destination: string;

  @Column({ length: 10, nullable: true })
  country: string | null;

  @Column({ type: 'date' })
  startsOn: string;

  @Column({ type: 'date' })
  endsOn: string;

  @Column({ type: 'int', default: 0 })
  days: number;

  @Column({ type: 'int', nullable: true })
  luggageLimit: number | null;

  @Column({ type: 'simple-array', default: '' })
  activities: string[];

  @Column({ type: 'simple-array', default: '' })
  formalEventTitles: string[];

  @Column({ type: 'simple-json', nullable: true })
  weatherForecast: Array<{ date: string; condition: string; tempMinC: number; tempMaxC: number }> | null;

  @Column({ type: 'int', default: 0 })
  optimisedOutfitCount: number;

  @Column({ type: 'int', default: 0 })
  optimisedItemCount: number;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ length: 20, default: 'upcoming' })
  status: string;

  @Column({ length: 255, nullable: true })
  coverImageUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => PackingList, (packingList) => packingList.trip, {
    cascade: true,
  })
  packingLists: PackingList[];
}

/** Section 7 entity `PackingList`; "You can create 8 outfits using only 9 items." */
@Entity('packing_lists')
export class PackingList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  tripId: string;

  @ManyToOne(() => Trip, (trip) => trip.packingLists, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tripId' })
  trip: Trip;

  @Index()
  @Column()
  itemId: string;

  @ManyToOne(() => WardrobeItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemId' })
  item: WardrobeItem;

  @Column({ length: 40, default: OutfitSlot.TOP })
  slot: OutfitSlot | string;

  @Column({ default: false })
  packed: boolean;

  @Column({ type: 'int', default: 0 })
  outfitCount: number;

  @Column({ type: 'simple-array', default: '' })
  dayPlan: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
