import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Weekly plan — globally regenerated 7-day outfit plan.
 *
 * Source JSON `weeklyPlan` has no userId and is regenerated on each
 * POST /planner/weekly. Stored as a dedicated table (not a JSON blob)
 * so individual days can be queried and replaced atomically.
 *
 * POST replaces all 7 rows in a single transaction (DELETE + INSERT).
 */
@Entity('weekly_plans')
export class WeeklyPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  weekday: string;

  @Column({ length: 10, nullable: true })
  date: string | null;

  @Column({ length: 160 })
  occasion: string;

  @Column({ length: 200 })
  outfitName: string;

  @Column({ length: 255, nullable: true })
  image: string | null;

  @Column({ nullable: true })
  outfitId: string | null;

  @Column({ default: false })
  isToday: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
