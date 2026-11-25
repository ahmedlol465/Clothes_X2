import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Section 4.14 Smart Shopping - a candidate product for the user. */
@Entity('shopping_items')
export class ShoppingItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  name: string;

  @Column({ length: 40 })
  category: string;

  @Column({ length: 255, nullable: true })
  imageUrl: string | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number | null) => value === null ? null : value,
      from: (value: string | null) => value === null ? null : Number(value),
    },
  })
  price: number;

  @Column({ length: 3, default: 'USD' })
  currency: string;

  @Column({ length: 120, nullable: true })
  brand: string | null;

  /** Store this product comes from ('Demo Store' for seed data, a real
   * store name for scraped rows). */
  @Column({ length: 80, default: 'Demo Store' })
  store: string;

  /** Where the row came from: 'seed' for bundled demo data, 'scraper' for
   * store scrapers. Lets the UI label demo data honestly. */
  @Column({ length: 20, default: 'seed' })
  source: string;

  /** The store's own product id/sku, unique per store for scraper upserts. */
  @Index()
  @Column({ length: 120, nullable: true })
  externalId: string | null;

  @Column({ length: 60, nullable: true })
  color: string | null;

  @Column({ length: 60, nullable: true })
  style: string | null;

  @Column({ length: 40, nullable: true })
  season: string | null;

  @Column({ type: 'json', nullable: true })
  sizes: string[] | null;

  @Column({ default: true })
  inStock: boolean;

  /** Pre-discount price when the item is on sale; null when full price. */
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
  originalPrice: number | null;

  /** When a scraper last refreshed this row; null for seed data. */
  @Column({ type: 'datetime', nullable: true })
  scrapedAt: Date | null;

  @Column({ length: 255, nullable: true })
  productUrl: string | null;

  /** How many outfits in the user's wardrobe this would complete. */
  @Column({ type: 'int', default: 0 })
  completesOutfits: number;

  @Column({ type: 'float', default: 0 })
  compatibilityScore: number;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'json', default: () => "('[]')" })
  compatibleColors: string[];

  @Column({ type: 'json', nullable: true })
  gapTags: string[] | null;

  @Column({ default: false })
  beforeYouBuyVerified: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Section 7 entity `WishlistItem`. */
@Entity('wishlist_items')
@Index(['userId', 'productUrl'], { unique: true })
export class WishlistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index()
  @Column({ nullable: true })
  shoppingItemId: string | null;

  @ManyToOne(() => ShoppingItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'shoppingItemId' })
  shoppingItem: ShoppingItem | null;

  @Column({ length: 200 })
  name: string;

  @Column({ length: 40, nullable: true })
  category: string | null;

  @Column({ length: 255, nullable: true })
  imageUrl: string | null;

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
  price: number | null;

  @Column({ length: 255, nullable: true })
  productUrl: string | null;

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
  lowestPrice: number | null;

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
  targetPrice: number | null;

  @Column({ default: false })
  priceAlertEnabled: boolean;

  @Column({ length: 20, default: 'active' })
  status: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Section 7 entity `Purchase` - feeds cost-per-wear analytics. */
@Entity('purchases')
export class Purchase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Index()
  @Column({ nullable: true })
  wardrobeItemId: string | null;

  @Column({ length: 200 })
  itemName: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number | null) => value === null ? null : value,
      from: (value: string | null) => value === null ? null : Number(value),
    },
  })
  price: number;

  @Column({ length: 3, default: 'USD' })
  currency: string;

  @Column({ length: 120, nullable: true })
  brand: string | null;

  @Column({ length: 40, nullable: true })
  category: string | null;

  @Column({ type: 'date', nullable: true })
  purchasedOn: string | null;

  @Column({ type: 'text', nullable: true })
  purchasedOnRaw: string | null;

  @Column({ length: 120, nullable: true })
  store: string | null;

  @Column({ length: 255, nullable: true })
  receiptImageUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
