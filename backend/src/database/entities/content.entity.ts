import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Editorial content shown on the Discover tab.
 *
 * This is server-owned content, not a client mock: it lives in the database so
 * it can be curated without shipping a new app build.
 */
@Entity('trend_styles')
export class TrendStyle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name: string;

  @Column({ length: 200 })
  tag: string;

  @Column({ length: 255 })
  imageUrl: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;
}

/** Community look shown in the Discover grid. */
@Entity('community_looks')
export class CommunityLook {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'int', default: 0 })
  likes: number;

  @Column({ length: 255 })
  imageUrl: string;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;
}
