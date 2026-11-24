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

import { StyleMemorySource, UserRole } from '../../common/vocabularies';

/** Core account. `passwordHash` is nullable so Google/Apple sign-in works. */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 180 })
  email: string;

  @Column({ length: 120, nullable: true })
  name: string | null;

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

  /**
   * Relation properties use `InstanceType<typeof X>` instead of `X` so
   * `emitDecoratorMetadata` emits `void 0` rather than a runtime reference to
   * a class declared later in this file. A plain `X` annotation makes the
   * generated `design:type` metadata throw a TDZ ReferenceError at load time.
   * The relation itself is resolved lazily by the `() => X` decorator above,
   * and the TypeScript type is preserved.
   */
  @OneToOne(() => UserProfile, (profile) => profile.user, { cascade: true })
  profile: InstanceType<typeof UserProfile>;

  @OneToOne(() => StyleProfile, (style) => style.user, { cascade: true })
  styleProfile: InstanceType<typeof StyleProfile>;

  @OneToMany(() => StyleMemory, (memory) => memory.user)
  styleMemories: StyleMemory[];

  @OneToOne(() => Subscription, (subscription) => subscription.user)
  subscription: InstanceType<typeof Subscription>;
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

  @Column({ type: 'json', default: () => "('[]')" })
  preferredColors: string[];

  @Column({ type: 'json', default: () => "('[]')" })
  avoidedColors: string[];

  @Column({ type: 'json', default: () => "('[]')" })
  preferredStyles: string[];

  @Column({ type: 'json', default: () => "('[]')" })
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

  @Column({ type: 'json', nullable: true })
  dimensions: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  palette: Array<{ name: string; hex: string; count: number }> | null;

  @Column({ type: 'json', nullable: true })
  categoryMix: Array<{ name: string; count: number }> | null;

  @Column({ type: 'json', nullable: true })
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

  @Column({ type: 'json', nullable: true })
  favoriteSilhouettes: string[] | null;

  @Column({ type: 'json', nullable: true })
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

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

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
