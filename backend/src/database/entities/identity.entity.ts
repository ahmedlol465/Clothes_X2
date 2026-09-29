import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ItemStatus, StyleMemorySource, UserRole } from '../../common/vocabularies';

/** Core account. `passwordHash` is nullable so Google/Apple sign-in works. */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 180 })
  email: string;

  @Column({ length: 255, nullable: true, select: false })
  passwordHash: string | null;

  @Column({ length: 255, nullable: true })
  phone: string | null;

  @Column({ length: 8, default: UserRole.USER })
  role: UserRole;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({ default: false })
  onboardingCompleted: boolean;

  @Column({ length: 5, nullable: true })
  defaultLocationCountry: string | null;

  @Column({ length: 120, nullable: true })
  defaultLocationCity: string | null;

  @Column({ length: 500, nullable: true })
  avatarUrl: string | null;

  /** Bumped on refresh-token rotation so old tokens can be rejected. */
  @Column({ default: 0 })
  tokenVersion: number;

  @Column({ type: 'datetime', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => UserProfile, (profile) => profile.user, { cascade: true })
  profile: UserProfile;

  @OneToOne(() => StyleProfile, (style) => style.user, { cascade: true })
  styleProfile: StyleProfile;

  @OneToMany(() => StyleMemory, (memory) => memory.user)
  styleMemories: StyleMemory[];

  @OneToOne(() => Subscription, (subscription) => subscription.user)
  subscription: Subscription;
}

/** Section 4.1 onboarding answers: sizes, fit, colors, style, occasions. */
@Entity('user_profiles')
export class UserProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  userId: string;

  @OneToOne(() => User, (user) => user.profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ length: 80 })
  firstName: string;

  @Column({ length: 80, nullable: true })
  lastName: string | null;

  @Column({ length: 12, nullable: true })
  topSize: string | null;

  @Column({ length: 12, nullable: true })
  bottomSize: string | null;

  @Column({ length: 12, nullable: true })
  shoeSize: string | null;

  @Column({ type: 'int', nullable: true })
  heightCm: number | null;

  @Column({ type: 'float', nullable: true })
  weightKg: number | null;

  @Column({ type: 'simple-array', default: '' })
  preferredColors: string[];

  @Column({ type: 'simple-array', default: '' })
  avoidedColors: string[];

  @Column({ type: 'simple-array', default: '' })
  preferredStyles: string[];

  @Column({ type: 'simple-array', default: '' })
  occasions: string[];

  @Column({ length: 40, default: 'minimalist' })
  fashionStyle: string;

  @Column({ length: 40, default: 'balanced' })
  fitPreference: string;

  @Column({ type: 'int', default: 3 })
  patternTolerance: number;

  @Column({ type: 'int', default: 3 })
  layeringPreference: number;

  @Column({ type: 'int', default: 3 })
  comfortPreference: number;

  /** 0-10, drives the risk-taking Style DNA axis. */
  @Column({ type: 'float', default: 5 })
  riskTaking: number;

  @Column({ length: 40, default: 'balanced' })
  budgetTier: string;

  @Column({ default: true })
  notificationsEnabled: boolean;

  @Column({ default: false })
  analyticsOptIn: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Section 4.10 Style DNA / personal style profile. */
@Entity('style_profiles')
export class StyleProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  userId: string;

  @OneToOne(() => User, (user) => user.styleProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ length: 60, nullable: true })
  archetype: string | null;

  @Column({ type: 'simple-json', nullable: true })
  dimensions: Record<string, number> | null;

  @Column({ type: 'simple-json', nullable: true })
  palette: Array<{ name: string; hex: string; count: number }> | null;

  @Column({ type: 'simple-json', nullable: true })
  categoryMix: Array<{ name: string; count: number }> | null;

  @Column({ type: 'simple-json', nullable: true })
  evolution: Array<{ month: string; score: number }> | null;

  @Column({ type: 'float', nullable: true })
  minimalism: number | null;

  @Column({ type: 'float', nullable: true })
  streetwear: number | null;

  @Column({ type: 'float', nullable: true })
  formalityBias: number | null;

  @Column({ type: 'float', nullable: true })
  colorPreference: number | null;

  @Column({ type: 'float', nullable: true })
  patternTolerance: number | null;

  @Column({ type: 'float', nullable: true })
  layeringPreference: number | null;

  @Column({ type: 'float', nullable: true })
  fitPreference: number | null;

  @Column({ type: 'float', nullable: true })
  comfortPreference: number | null;

  @Column({ type: 'float', nullable: true })
  riskTaking: number | null;

  @Column({ type: 'simple-json', nullable: true })
  favoriteSilhouettes: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  brandPreference: string[] | null;

  @Column({ type: 'float', default: 0 })
  overallConfidence: number;

  @Column({ type: 'datetime', nullable: true })
  lastComputedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Explicit, user-editable style preference (colour, silhouette, ...). */
@Entity('style_preferences')
export class StylePreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index()
  @Column({ length: 80 })
  preference: string;

  @Column({ length: 120 })
  value: string;

  @Column({ type: 'float', default: 0.5 })
  weight: number;

  @CreateDateColumn()
  createdAt: Date;
}

/**
 * Section 7 "Important entity: StyleMemory".
 *   -user_id -preference -value -confidence -source -created_at -updated_at
 * Example: preference="neutral_colors" value=0.91 confidence=0.87
 *          source="outfit_feedback"
 */
@Entity('style_memories')
@Index(['userId', 'preference'], { unique: true })
export class StyleMemory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.styleMemories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ length: 80 })
  preference: string;

  @Column({ type: 'float' })
  value: number;

  @Column({ type: 'float', default: 0.5 })
  confidence: number;

  @Column({ length: 40, default: StyleMemorySource.ONBOARDING })
  source: StyleMemorySource | string;

  @Column({ type: 'int', default: 1 })
  observations: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  userId: string;

  @OneToOne(() => User, (user) => user.subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ length: 20, default: 'free' })
  plan: string;

  @Column({ length: 20, default: 'active' })
  status: string;

  @Column({ type: 'datetime', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ length: 60, nullable: true })
  provider: string | null;

  @Column({ length: 120, nullable: true })
  providerSubscriptionId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('wardrobes')
export class Wardrobe {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ length: 80, default: 'My Wardrobe' })
  name: string;

  @Column({ length: 40, default: 'primary' })
  kind: string;

  @Column({ type: 'int', default: 0 })
  itemCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('brands')
export class Brand {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 120 })
  name: string;

  @Column({ length: 255, nullable: true })
  logoUrl: string | null;

  @Column({ length: 60, nullable: true })
  country: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 60 })
  name: string;

  @Column({ length: 40, default: 'apparel' })
  group: string;

  @Column({ length: 40, default: 'shirt' })
  icon: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}

/** A single garment. Mirrors the Flutter `ClothingItem` model field-for-field. */
@Entity('wardrobe_items')
@Index(['wardrobeId', 'status'])
export class WardrobeItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  wardrobeId: string;

  @ManyToOne(() => Wardrobe, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'wardrobeId' })
  wardrobe: Wardrobe;

  @Column({ length: 160 })
  name: string;

  @Column({ length: 60, nullable: true })
  category: string | null;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoryId' })
  categoryRef: Category | null;

  @Column({ nullable: true })
  categoryId: string | null;

  @Column({ length: 255 })
  imageUrl: string;

  @Column({ type: 'simple-json', nullable: true })
  secondaryColors: string[] | null;

  @Column({ length: 60, nullable: true })
  color: string | null;

  @Column({ length: 40, nullable: true })
  pattern: string | null;

  @Column({ length: 60, nullable: true })
  style: string | null;

  @Column({ length: 80, nullable: true })
  material: string | null;

  @Column({ length: 40, nullable: true })
  season: string | null;

  @Column({ length: 40, nullable: true })
  formality: string | null;

  @Column({ length: 40, nullable: true })
  fit: string | null;

  @Column({ length: 30, default: 'New' })
  condition: string;

  @Column({ type: 'simple-array', default: '' })
  occasions: string[];

  /** 1 (very light) .. 5 (insulated). Section 4.5 "Warmth". */
  @Column({ type: 'int', default: 3 })
  warmth: number;

  /** 1 (single layer) .. 5 (goes under anything). Section 4.5 "Layerability". */
  @Column({ type: 'int', default: 3 })
  layerability: number;

  /** 0-1, the vision model certainty shown in the item detail screen. */
  @Column({ type: 'float', default: 0 })
  confidence: number;

  @Column({ type: 'simple-json', nullable: true })
  confidenceByAttribute: Record<string, number> | null;

  @Column({ type: 'simple-json', nullable: true })
  tags: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  compatibleColors: string[] | null;

  @ManyToOne(() => Brand, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'brandId' })
  brand: Brand | null;

  @Column({ nullable: true })
  brandId: string | null;

  @Column({ type: 'float', nullable: true })
  purchasePrice: number | null;

  @Column({ type: 'datetime', nullable: true })
  purchaseDate: Date | null;

  /** Denormalised counters kept in sync by the wardrobe service. */
  @Column({ type: 'int', default: 0 })
  timesWorn: number;

  @Column({ type: 'datetime', nullable: true })
  lastWornAt: Date | null;

  @Column({ type: 'int', default: 1 })
  timesRecommended: number;

  @Column({ length: 8, default: ItemStatus.ACTIVE })
  status: ItemStatus | string;

  @Column({ type: 'simple-json', nullable: true })
  embeddings: number[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ClothingAttribute, (attribute) => attribute.item, {
    cascade: true,
  })
  attributes: ClothingAttribute[];
}

/** Section 7 entity: per-item attribute rows produced by the vision model. */
@Entity('clothing_attributes')
@Index(['itemId', 'name'], { unique: true })
export class ClothingAttribute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  itemId: string;

  @OneToOne(() => WardrobeItem, (item) => item.attributes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'itemId' })
  item: WardrobeItem;

  @Column({ length: 60 })
  name: string;

  @Column({ length: 160 })
  value: string;

  @Column({ type: 'float', default: 0 })
  confidence: number;

  @Column({ default: false })
  correctedByUser: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Section 4.9 / Insights "Most worn": one row per time an item went out. */
@Entity('wear_events')
@Index(['itemId', 'wornAt'])
export class WearEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index()
  @Column()
  itemId: string;

  @ManyToOne(() => WardrobeItem, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'itemId' })
  item: WardrobeItem;

  @Index()
  @Column({ nullable: true })
  outfitId: string | null;

  @Column({ length: 40, nullable: true })
  occasion: string | null;

  @Column({ length: 120, nullable: true })
  location: string | null;

  @Column({ type: 'int', nullable: true })
  temperatureC: number | null;

  @Column({ length: 40, nullable: true })
  weatherCondition: string | null;

  @Column({ nullable: true })
  calendarEventId: string | null;

  @Column({ default: false })
  fromPlanner: boolean;

  @CreateDateColumn({ name: 'wornAt' })
  wornAt: Date;
}
