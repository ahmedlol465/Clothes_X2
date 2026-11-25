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

import { ItemStatus } from '../../common/vocabularies';
import { User } from './identity.entity';

@Entity('wardrobes')
export class Wardrobe {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

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

  @Column({ length: 255 })
  imageUrl: string;

  @Column({ type: 'json', nullable: true })
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

  /** Male | Female | Unisex, from the photo analysis (or set by the user). */
  @Column({ length: 20, nullable: true })
  gender: string | null;

  @Column({ length: 40, nullable: true })
  fit: string | null;

  @Column({ length: 30, default: 'New' })
  condition: string;

  @Column({ type: 'json', default: () => "('[]')" })
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

  @Column({ type: 'json', nullable: true })
  confidenceByAttribute: Record<string, number> | null;

  @Column({ type: 'json', nullable: true })
  tags: string[] | null;

  @Column({ type: 'json', nullable: true })
  compatibleColors: string[] | null;

  @ManyToOne(() => Brand, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'brandId' })
  brand: Brand | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number | null) => value === null ? null : value,
      from: (value: string | null) => value === null ? null : Number(value),
    },
  })
  purchasePrice: number | null;

  @Column({ type: 'datetime', nullable: true })
  purchaseDate: Date | null;

  /** Denormalised counters kept in sync by the wardrobe service. */
  @Column({ type: 'int', default: 0 })
  timesWorn: number;

  @Column({ type: 'datetime', nullable: true })
  lastWornAt: Date | null;

  /** Human label shown in the Flutter card ("Worn 4 days ago"). */
  @Column({ length: 120, nullable: true })
  lastWornLabel: string | null;

  /**
   * Vision-provenance bundle: `analysis`, `analysisSource`,
   * `analysisRejected`, `analysisConfidence`, `confidenceKind`, `agreement`,
   * `uncertainAttributes`, `colorDetail`, `analysisModel`, `analyzedAt`.
   *
   * Kept as one JSON column so the pipeline can evolve without a migration per
   * field, while the item row itself stays relational and queryable.
   */
  @Column({ type: 'json', nullable: true })
  legacy: Record<string, unknown> | null;

  @Column({ type: 'int', default: 1 })
  timesRecommended: number;

  @Column({ length: 8, default: ItemStatus.ACTIVE })
  status: ItemStatus | string;

  @Column({ type: 'json', nullable: true })
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
