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

  @Column({ type: 'float' })
  price: number;

  @Column({ length: 3, default: 'USD' })
  currency: string;

  @Column({ length: 120, nullable: true })
  brand: string | null;

  @Column({ length: 255, nullable: true })
  productUrl: string | null;

  /** How many outfits in the user's wardrobe this would complete. */
  @Column({ type: 'int', default: 0 })
  completesOutfits: number;

  @Column({ type: 'float', default: 0 })
  compatibilityScore: number;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'simple-array', default: '' })
  compatibleColors: string[];

  @Column({ type: 'simple-json', nullable: true })
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

  @Column({ type: 'float', nullable: true })
  price: number | null;

  @Column({ length: 255, nullable: true })
  productUrl: string | null;

  @Column({ type: 'float', nullable: true })
  lowestPrice: number | null;

  @Column({ type: 'float', nullable: true })
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

  @Column({ type: 'float' })
  price: number;

  @Column({ length: 3, default: 'USD' })
  currency: string;

  @Column({ length: 120, nullable: true })
  brand: string | null;

  @Column({ length: 40, nullable: true })
  category: string | null;

  @Column({ type: 'date' })
  purchasedOn: string;

  @Column({ length: 120, nullable: true })
  store: string | null;

  @Column({ length: 255, nullable: true })
  receiptImageUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
