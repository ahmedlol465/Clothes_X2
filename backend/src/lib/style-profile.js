/** Style profile vocabulary, normalisation and whitelisting (§8.2). */
'use strict';
const { publicUser } = require('./users');

// ------------------------------------------------------- style profile (§8.2)
// The style profile is a free-form object on the user record, so every read
// normalises it and every write is whitelisted. Without this the old handlers
// used `Object.assign(user, body)`, which let any client rewrite `id` or
// `passwordHash`, and silently accepted junk that later broke the UI.

/** Colour vocabulary offered by the Profile editor (§16 favouriteColors). */
const STYLE_COLORS = [
  'Black', 'White', 'Beige', 'Navy', 'Blue', 'Denim', 'Grey', 'Charcoal',
  'Brown', 'Tan', 'Cream', 'Green', 'Olive', 'Red', 'Burgundy', 'Pink',
  'Purple', 'Yellow', 'Orange', 'Multicolor',
];

/** Style vocabulary offered by the Profile editor (§16 preferredStyles). */
const STYLE_STYLES = [
  'Casual', 'Smart Casual', 'Minimalist', 'Classic', 'Vintage', 'Modern',
  'Formal', 'Elegant', 'Streetwear', 'Sporty', 'Bohemian', 'Preppy',
  'Raw Indigo', 'Minimal',
];

/** Fit vocabulary (§16 body/fit information). */
const STYLE_FITS = ['slim', 'regular', 'relaxed', 'oversized'];

/** Top / bottom / shoe size vocabularies (§16 size). */
const STYLE_SIZES = {
  top: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  bottom: ['28', '30', '32', '34', '36', '38', '40'],
  shoe: ['38', '39', '40', '41', '42', '43', '44', '45'],
};

const str = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

const num = (v, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
};

const list = (v, allowed, max) => {
  if (!Array.isArray(v)) return null;
  const seen = [];
  for (const raw of v) {
    const value = str(raw, 40);
    if (value && allowed.includes(value) && !seen.includes(value)) seen.push(value);
    if (seen.length >= max) break;
  }
  return seen;
};

/**
 * Default style profile for a user that has never edited theirs, so the
 * Profile screen always renders a complete, valid shape.
 */
function defaultStyleProfile() {
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

/** Read a stored style profile as a complete, valid object. */
function readStyleProfile(user) {
  const stored = user?.styleProfile || {};
  const sizes = stored.sizes || {};
  return {
    favoriteColors: list(stored.favoriteColors, STYLE_COLORS, 12) || [],
    preferredStyles: list(stored.preferredStyles, STYLE_STYLES, 12) || [],
    avoidedColors: list(stored.avoidedColors, STYLE_COLORS, 12) || [],
    heightCm: num(stored.heightCm, 80, 250),
    weightKg: num(stored.weightKg, 25, 300),
    fitPreference: STYLE_FITS.includes(stored.fitPreference)
      ? stored.fitPreference
      : 'regular',
    sizes: {
      top: STYLE_SIZES.top.includes(sizes.top) ? sizes.top : null,
      bottom: STYLE_SIZES.bottom.includes(sizes.bottom) ? sizes.bottom : null,
      shoe: STYLE_SIZES.shoe.includes(sizes.shoe ?? sizes.shoes)
        ? (sizes.shoe ?? sizes.shoes)
        : null,
    },
  };
}

/**
 * Apply a client patch to a style profile. Only whitelisted keys are read and
 * only whitelisted vocabulary values are stored, so a crafted body cannot
 * inject arbitrary keys or oversized values into the user record.
 */
function writeStyleProfile(user, body = {}) {
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
    next.fitPreference = STYLE_FITS.includes(b.fitPreference) ? b.fitPreference : 'regular';
  }
  if (b.sizes !== undefined && b.sizes && typeof b.sizes === 'object') {
    for (const slot of Object.keys(STYLE_SIZES)) {
      // `shoes` is accepted as a legacy alias for `shoe`.
      const raw = b.sizes[slot] ?? (slot === 'shoe' ? b.sizes.shoes : undefined);
      if (raw === undefined) continue;
      const value = str(raw, 8);
      next.sizes[slot] = value && STYLE_SIZES[slot].includes(value) ? value : null;
    }
  }

  user.styleProfile = next;
  return next;
}

/** The profile payload rendered by the Profile screen (§16). */
function profilePayload(user) {
  return {
    ...publicUser(user),
    styleProfile: readStyleProfile(user),
  };
}

module.exports = { STYLE_COLORS, STYLE_STYLES, STYLE_FITS, STYLE_SIZES, str, num, list, defaultStyleProfile, readStyleProfile, writeStyleProfile, profilePayload };
