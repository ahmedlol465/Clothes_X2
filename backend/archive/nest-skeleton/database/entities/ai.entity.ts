import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Outfit } from './outfit.entity';

/** Section 4.6 AI Stylist Chat conversation container. */
@Entity('ai_conversations')
@Index(['userId', 'updatedAt'])
export class AIConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ length: 140, default: 'New conversation' })
  title: string;

  @Column({ length: 20, default: 'stylist' })
  channel: string;

  @Column({ type: 'simple-json', nullable: true })
  context: Record<string, unknown> | null;

  @Column({ type: 'int', default: 0 })
  messageCount: number;

  @Column({ type: 'datetime', nullable: true })
  lastMessageAt: Date | null;

  @Column({ default: false })
  archived: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => AIInteraction, (interaction) => interaction.conversation, {
    cascade: true,
  })
  interactions: AIInteraction[];
}

/** Section 4.6 / 7: a single user or assistant turn. */
@Entity('ai_interactions')
@Index(['conversationId', 'createdAt'])
export class AIInteraction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  conversationId: string;

  @ManyToOne(() => AIConversation, (conversation) => conversation.interactions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversationId' })
  conversation: AIConversation;

  @Column({ length: 20, default: 'user' })
  role: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'simple-json', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ nullable: true })
  outfitId: string | null;

  @ManyToOne(() => Outfit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'outfitId' })
  outfit: Outfit | null;

  @Column({ type: 'simple-array', default: '' })
  referencedItemIds: string[];

  @Column({ type: 'int', default: 0 })
  latencyMs: number;

  @Column({ type: 'int', default: 0 })
  tokens: number;

  @CreateDateColumn()
  createdAt: Date;
}

/** Section 4.17 Admin "AI Usage / Cost". */
@Entity('ai_usage')
@Index(['userId', 'createdAt'])
export class AIUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index()
  @Column({ length: 60 })
  endpoint: string;

  @Column({ length: 60, default: 'rule-engine' })
  provider: string;

  @Column({ type: 'simple-json', nullable: true })
  model: Record<string, unknown> | null;

  @Column({ type: 'int', default: 0 })
  latencyMs: number;

  @Column({ type: 'int', default: 0 })
  tokens: number;

  @Column({ type: 'float', default: 0 })
  costUsd: number;

  @Column({ default: true })
  success: boolean;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}

/** Section 4.11 reminder notifications + section 7 entity `Notification`. */
@Entity('notifications')
@Index(['userId', 'readAt'])
export class AppNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ length: 60 })
  type: string;

  @Column({ length: 160 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'simple-json', nullable: true })
  data: Record<string, unknown> | null;

  @Column({ length: 20, default: 'in_app' })
  channel: string;

  @Column({ type: 'datetime', nullable: true })
  scheduledFor: Date | null;

  @Column({ type: 'datetime', nullable: true })
  readAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
