import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from './identity.entity';

/**
 * Session entity mirroring the existing JSON session structure.
 *
 * Existing auth stores: { token, userId, createdAt }
 * Login returns the same token as both accessToken and refreshToken.
 * Refresh creates a new session; the old session stays valid.
 * No expiration, no tokenVersion, no separate refreshToken column.
 */
@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 64 })
  token: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;
}
