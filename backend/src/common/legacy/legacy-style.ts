/**
 * Style-profile vocabulary and validation.
 *
 * Ported from the Express runtime so the Profile screen keeps the exact same
 * whitelist semantics: unknown keys are ignored, out-of-vocabulary values are
 * dropped, and a missing measurement stays `null` instead of clamping to the
 * minimum (which used to report every unset height as 80 cm).
 */
import {
  defaultStyleProfile,
  LegacyStyleProfile,
  LegacyUser,
  normalizeStyleProfile,
} from './legacy.types';

export const STYLE_COLORS = [
  'Black', 'White', 'Beige', 'Navy', 'Blue', 'Denim', 'Grey', 'Charcoal',
  'Brown', 'Tan', 'Cream', 'Green', 'Olive', 'Red', 'Burgundy', 'Pink',
  'Purple', 'Yellow', 'Orange', 'Multicolor',
];

export const STYLE_STYLES = [
  'Casual', 'Smart Casual', 'Minimalist', 'Classic', 'Vintage', 'Modern',
  'Formal', 'Elegant', 'Streetwear', 'Sporty', 'Bohemian', 'Preppy',
  'Raw Indigo', 'Minimal',
];

export const STYLE_FITS = ['slim', 'regular', 'relaxed', 'oversized'];

export const STYLE_SIZES: Record<string, string[]> = {
  top: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  bottom: ['28', '30', '32', '34', '36', '38', '40'],
  shoe: ['38', '39', '40', '41', '42', '43', '44', '45'],
};

const str = (v: unknown, max: number): string | null =>
  v == null ? null : String(v).trim().slice(0, max) || null;

const num = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
};

const list = (v: unknown, allowed: string[], max: number): string[] | null => {
  if (!Array.isArray(v)) return null;
  const seen: string[] = [];
  for (const raw of v) {
    const value = str(raw, 40);
    if (value && allowed.includes(value) && !seen.includes(value)) seen.push(value);
    if (seen.length >= max) break;
  }
  return seen;
};

/** Read a stored profile as a complete, valid object. */
export function readStyleProfile(user: Partial<LegacyUser> | null | undefined): LegacyStyleProfile {
  const stored = normalizeStyleProfile(user?.styleProfile);
  const fallback = defaultStyleProfile();
  return {
    favoriteColors: list(stored.favoriteColors, STYLE_COLORS, 12) || fallback.favoriteColors,
    preferredStyles: list(stored.preferredStyles, STYLE_STYLES, 12) || fallback.preferredStyles,
    avoidedColors: list(stored.avoidedColors, STYLE_COLORS, 12) || fallback.avoidedColors,
    heightCm: num(stored.heightCm, 80, 250),
    weightKg: num(stored.weightKg, 25, 300),
    fitPreference: STYLE_FITS.includes(stored.fitPreference) ? stored.fitPreference : 'regular',
    sizes: {
      top: STYLE_SIZES.top.includes(stored.sizes.top) ? stored.sizes.top : null,
      bottom: STYLE_SIZES.bottom.includes(stored.sizes.bottom) ? stored.sizes.bottom : null,
      shoe: STYLE_SIZES.shoe.includes(stored.sizes.shoe) ? stored.sizes.shoe : null,
    },
  };
}

/** Apply a client patch to a style profile, whitelisting every field. */
export function writeStyleProfile(
  user: LegacyUser,
  body: Record<string, unknown> = {},
): LegacyStyleProfile {
  const next = readStyleProfile(user);
  const b = body || {};

  if (b.favoriteColors !== undefined) {
    next.favoriteColors = list(b.favoriteColors, STYLE_COLORS, 12) || [];
  }
  if (b.preferredStyles !== undefined) {
    next.preferredStyles = list(b.preferredStyles, STYLE_STYLES, 12) || [];
  }
  if (b.avoidedColors !== undefined) {
    next.avoidedColors = list(b.avoidedColors, STYLE_COLORS, 12) || [];
  }
  if (b.heightCm !== undefined) {
    next.heightCm = b.heightCm === null || b.heightCm === '' ? null : num(b.heightCm, 80, 250);
  }
  if (b.weightKg !== undefined) {
    next.weightKg = b.weightKg === null || b.weightKg === '' ? null : num(b.weightKg, 25, 300);
  }
  if (b.fitPreference !== undefined) {
    next.fitPreference = STYLE_FITS.includes(String(b.fitPreference))
      ? String(b.fitPreference)
      : 'regular';
  }
  if (b.sizes !== undefined && b.sizes && typeof b.sizes === 'object') {
    const sizes = b.sizes as Record<string, unknown>;
    for (const slot of Object.keys(STYLE_SIZES)) {
      const raw = sizes[slot] ?? (slot === 'shoe' ? sizes.shoes : undefined);
      if (raw === undefined) continue;
      const value = str(raw, 8);
      next.sizes[slot as 'top' | 'bottom' | 'shoe'] =
        value && STYLE_SIZES[slot].includes(value) ? value : null;
    }
  }

  user.styleProfile = next;
  return next;
}

/** Strip the password hash before anything reaches a client. */
export function publicUser(user: LegacyUser | null | undefined) {
  if (!user) return null;
  const { passwordHash, tokenVersion, ...rest } = user;
  return rest;
}

/** The profile payload rendered by the Profile screen. */
export function profilePayload(user: LegacyUser) {
  return {
    ...publicUser(user),
    name: user.name,
    styleProfile: readStyleProfile(user),
  };
}
