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

import {
  FeedbackType,
  OutfitSlot,
  OutfitSource,
  RecommendationMode,
} from '../../common/vocabularies';
import { WardrobeItem } from './identity.entity';

/** Section 4.7 / 7: an occasion the user dresses for. */
@Entity('occasions')
export class Occasion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 40 })
  type: string;

  @Column({ length: 40, default: 'Smart Casual' })
  requiredFormality: string;

  @Column({ type: 'simple-array', default: '' })
  tags: string[];

  @Column({ default: false })
  isRecurring: boolean;

  @CreateDateColumn()
  createdAt: Date;
}

/** Section 7 entity `Outfit`. */
@Entity('outfits')
@Index(['userId', 'status'])
export class Outfit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ length: 120 })
  name: string;

  @Column({ length: 255, nullable: true })
  imageUrl: string | null;

  @Column({ length: 40, default: 'Daily' })
  occasion: string;

  @Column({ length: 40, default: OutfitSource.AI_RECOMMENDED })
  source: OutfitSource | string;

  @Column({ type: 'int', default: 0 })
  matchScore: number;

  @Column({ type: 'simple-json', nullable: true })
  factorBreakdown: Record<string, number> | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  /** The documented "Why this outfit?" explanation. */
  @Column({ type: 'text', nullable: true })
  explanation: string | null;

  @Column({ type: 'simple-json', nullable: true })
  reasons: Array<{ label: string; detail: string; weight: number }> | null;

  @Column({ type: 'simple-json', nullable: true })
  weatherContext: Record<string, unknown> | null;

  @Column({ length: 8, default: 'active' })
  status: string;

  @Column({ default: false })
  isFavorite: boolean;

  @Column({ type: 'datetime', nullable: true })
  favoritedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  rating: number | null;

  @Column({ type: 'int', default: 0 })
  timesWorn: number;

  @Column({ type: 'datetime', nullable: true })
  lastWornAt: Date | null;

  @Column({ nullable: true })
  calendarEventId: string | null;

  @Column({ nullable: true })
  parentOutfitId: string | null;

  @Column({ length: 40, nullable: true })
  remixVariant: string | null;

  @Column({ default: false })
  wornToday: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * The `outfit_items` join rows carry the slot + layer order, so the relation
   * is modelled through {@link OutfitItem} rather than a plain ManyToMany.
   */
  @OneToMany(() => OutfitItem, (outfitItem) => outfitItem.outfit, {
    cascade: true,
  })
  outfitItems: OutfitItem[];

  @OneToMany(() => OutfitFeedback, (feedback) => feedback.outfit)
  feedbacks: OutfitFeedback[];
}

/** Section 7 entity `OutfitItem` — the join row carries slot + order. */
@Entity('outfit_items')
@Index(['outfitId', 'slot'], { unique: true })
export class OutfitItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  outfitId: string;

  @ManyToOne(() => Outfit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'outfitId' })
  outfit: Outfit;

  @Index()
  @Column()
  itemId: string;

  @ManyToOne(() => WardrobeItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemId' })
  item: WardrobeItem;

  @Column({ length: 40, default: OutfitSlot.TOP })
  slot: OutfitSlot | string;

  @Column({ type: 'int', default: 0 })
  layerOrder: number;

  @Column({ type: 'float', nullable: true })
  contribution: number | null;

  @CreateDateColumn()
  createdAt: Date;
}

/** Section 4.9 "Outfit feedback loop". */
@Entity('outfit_feedback')
export class OutfitFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index()
  @Column()
  outfitId: string;

  @ManyToOne(() => Outfit, (outfit) => outfit.feedbacks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'outfitId' })
  outfit: Outfit;

  @Column({ length: 20, default: FeedbackType.RATED })
  type: FeedbackType | string;

  @Column({ type: 'int', nullable: true })
  rating: number | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'simple-array', default: '' })
  tags: string[];

  @CreateDateColumn()
  createdAt: Date;
}

/** Section 7 entity `Recommendation` — the generated candidate outfit. */
@Entity('recommendations')
@Index(['userId', 'createdAt'])
export class Recommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index()
  @Column({ nullable: true })
  outfitId: string | null;

  @ManyToOne(() => Outfit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'outfitId' })
  outfit: Outfit | null;

  @Column({ length: 40, default: RecommendationMode.WHAT_SHOULD_I_WEAR })
  mode: RecommendationMode | string;

  @Column({ length: 40, nullable: true })
  occasion: string | null;

  @Column({ type: 'simple-array', default: '' })
  itemIds: string[];

  @Column({ type: 'int', default: 0 })
  score: number;

  @Column({ type: 'simple-json', nullable: true })
  factors: Record<string, number> | null;

  @Column({ type: 'text', nullable: true })
  explanation: string | null;

  @Column({ type: 'simple-json', nullable: true })
  context: Record<string, unknown> | null;

  @Column({ length: 20, default: 'pending' })
  status: string;

  @Column({ type: 'datetime', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => RecommendationFeedback, (feedback) => feedback.recommendation)
  feedbacks: RecommendationFeedback[];
}

@Entity('recommendation_feedback')
export class RecommendationFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index()
  @Column()
  recommendationId: string;

  @ManyToOne(() => Recommendation, (recommendation) => recommendation.feedbacks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'recommendationId' })
  recommendation: Recommendation;

  @Column({ length: 20, default: FeedbackType.LIKED })
  action: FeedbackType | string;

  @Column({ type: 'simple-json', nullable: true })
  perItemReaction: Record<string, string> | null;

  @CreateDateColumn()
  createdAt: Date;
}
