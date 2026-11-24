/**
 * The wire shape the Flutter client has always spoken (the old JSON store).
 *
 * NestJS + TypeORM own persistence now, but the API contract is unchanged so
 * the app keeps working without a rewrite. These types describe the in-memory
 * working set that is hydrated from MySQL at boot and written back on change.
 */

export interface LegacyStyleProfile {
  favoriteColors: string[];
  preferredStyles: string[];
  avoidedColors: string[];
  heightCm: number | null;
  weightKg: number | null;
  fitPreference: string;
  sizes: { top: string | null; bottom: string | null; shoe: string | null };
}

export interface LegacyUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  createdAt: string;
  avatarUrl: string | null;
  styleProfile: LegacyStyleProfile;
  tokenVersion: number;
  role: string;
}

export interface LegacyItem {
  id: string;
  userId?: string | null;
  name: string;
  image: string;
  category: string;
  color: string;
  style: string;
  material: string;
  season: string;
  formality: string;
  pattern: string;
  brand: string;
  timesWorn: number;
  lastWornLabel?: string | null;
  createdAt: string;
  archived?: boolean;
  [key: string]: unknown;
}

export interface LegacyOutfit {
  id: string;
  userId?: string | null;
  name: string;
  image: string;
  occasion: string;
  match: number;
  pieces: string[];
  itemIds: string[];
  favorite: boolean;
  createdAt: string;
  [key: string]: unknown;
}

export interface LegacyConversation {
  id: string;
  userId: string | null;
  conversationId: string | null;
  at: string;
  message: string;
  reply: string;
  itemIds: string[];
}

export interface LegacyEvent {
  id: string;
  userId?: string | null;
  title: string;
  date: string | null;
  type: string;
  location: string | null;
  dressCode: string | null;
  outfitId: string | null;
  [key: string]: unknown;
}

export interface LegacyPlanDay {
  weekday: string;
  date: string | null;
  occasion: string;
  outfitName: string;
  image: string | null;
  outfitId: string | null;
  isToday: boolean;
}

export interface LegacyProduct {
  id: string;
  name: string;
  price: string;
  image: string | null;
  reason: string | null;
  [key: string]: unknown;
}

export interface LegacyWishlistEntry {
  id: string;
  userId?: string | null;
  name: string;
  price?: string | null;
  image?: string | null;
  [key: string]: unknown;
}

export interface LegacyAiUsage {
  endpoint: string;
  ms: number;
  at: string;
  userId?: string | null;
  [key: string]: unknown;
}

export interface LegacyDb {
  users: LegacyUser[];
  sessions: Array<{ token: string; userId: string; createdAt: string }>;
  wardrobe: LegacyItem[];
  outfits: LegacyOutfit[];
  wearEvents: unknown[];
  feedback: Array<Record<string, unknown>>;
  styleMemory: Array<Record<string, unknown>>;
  conversations: LegacyConversation[];
  events: LegacyEvent[];
  weeklyPlan: LegacyPlanDay[];
  wishlist: LegacyWishlistEntry[];
  products: LegacyProduct[];
  aiUsage: LegacyAiUsage[];
  /** Per-user state for the style-memory learning loop (`src/style-memory.js`). */
  styleMemories: Array<Record<string, unknown>>;
}

export function emptyLegacyDb(): LegacyDb {
  return {
    users: [],
    sessions: [],
    wardrobe: [],
    outfits: [],
    wearEvents: [],
    feedback: [],
    styleMemory: [],
    conversations: [],
    events: [],
    weeklyPlan: [],
    wishlist: [],
    products: [],
    aiUsage: [],
    styleMemories: [],
  };
}

export function defaultStyleProfile(): LegacyStyleProfile {
  return {
    favoriteColors: [],
    preferredStyles: [],
    avoidedColors: [],
    heightCm: null,
    weightKg: null,
    fitPreference: 'regular',
    sizes: { top: null, bottom: null, shoe: null },
  };
}

/** Ensure a value parsed from MySQL/JSON is a complete, valid style profile. */
export function normalizeStyleProfile(raw: unknown): LegacyStyleProfile {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const sizes = (value.sizes && typeof value.sizes === 'object' ? value.sizes : {}) as Record<string, any>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const numOrNull = (v: unknown) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    favoriteColors: list(value.favoriteColors),
    preferredStyles: list(value.preferredStyles),
    avoidedColors: list(value.avoidedColors),
    heightCm: numOrNull(value.heightCm),
    weightKg: numOrNull(value.weightKg),
    fitPreference: typeof value.fitPreference === 'string' ? value.fitPreference : 'regular',
    sizes: {
      top: sizes.top ?? null,
      bottom: sizes.bottom ?? null,
      shoe: sizes.shoe ?? sizes.shoes ?? null,
    },
  };
}
