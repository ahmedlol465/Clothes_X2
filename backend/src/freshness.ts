/**
 * Freshness / rotation pressure (ported from the Express-era
 * recommendation-engine.js, upgraded to real dates).
 *
 * The old module parsed a `lastWornLabel` string ("3 days ago"); the MySQL
 * entities store a real `lastWornAt` timestamp, so the port reads that
 * instead. The scoring itself is unchanged: worn today → 0, a few days ago
 * → 40–70, 10+ days or never worn → 100. Slots whose rotation actually
 * matters are top/bottom/outerwear — shoes and belts are worn too often to
 * judge, and unknown slots fall back to the whole outfit's mean.
 */
import * as tax from './taxonomy';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WornItem {
  category?: string | null;
  lastWornAt?: Date | string | null;
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function mean(list: number[]): number {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
}

/**
 * Days since the piece was worn; null (never worn) counts as 999. An
 * unparseable timestamp returns null so the caller can stay neutral rather
 * than guessing.
 */
export function daysSinceWorn(
  item: WornItem,
  now: Date = new Date(),
): number | null {
  const raw = item.lastWornAt;
  if (!raw) return 999;
  const when = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(when.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - when.getTime()) / DAY_MS));
}

/**
 * Per-garment rotation pressure, 0–100, from how long ago the piece was worn:
 * worn today → 0, sliding up to 100 at 10+ days, never worn → 100. Unknown
 * dates stay neutral (60) rather than guessing.
 */
export function freshnessOf(item: WornItem, now: Date = new Date()): number {
  const days = daysSinceWorn(item, now);
  return days == null ? 60 : clamp100(100 - Math.max(0, 10 - days) * 10);
}

/** Slots whose rotation actually matters. */
export const FRESHNESS_SLOTS = new Set(['top', 'bottom', 'outerwear']);

/** Mean freshness over the pieces whose rotation matters. */
export function freshnessOfItems(items: WornItem[], now: Date = new Date()): number {
  if (!items.length) return 0;
  const core = items.filter((i) =>
    FRESHNESS_SLOTS.has(tax.slotOf(i as Parameters<typeof tax.slotOf>[0])),
  );
  return mean((core.length ? core : items).map((i) => freshnessOf(i, now)));
}

export interface RankedOutfit {
  match: number;
  itemIds: string[];
}

/**
 * Re-rank generated outfits by blending the match score with freshness, the
 * same 0.90/0.10 split the old engine gave compatibility/freshness after
 * renormalising away the signals the Home path does not carry. Ties break on
 * the original match, then on item ids, so ordering stays deterministic.
 */
export function applyFreshnessRotation<T extends RankedOutfit>(
  outfits: T[],
  itemsById: Map<string, WornItem>,
  weight = 0.1,
  now: Date = new Date(),
): T[] {
  const w = Math.max(0, Math.min(1, weight));
  return [...outfits]
    .map((outfit, index) => {
      const items = outfit.itemIds
        .map((id) => itemsById.get(id))
        .filter((i): i is WornItem => Boolean(i));
      const freshness = freshnessOfItems(items, now);
      const combined = (1 - w) * Number(outfit.match ?? 0) + w * freshness;
      return { outfit, index, combined };
    })
    .sort((a, b) => b.combined - a.combined || a.index - b.index)
    .map((entry) => entry.outfit);
}
