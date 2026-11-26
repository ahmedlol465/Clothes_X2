import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { Injectable, NotFoundException } from '@nestjs/common';
import sharp, { OverlayOptions } from 'sharp';

import { readStoredImage, STORAGE_DIR } from '../../common/storage/storage';
import { removePlainBackground } from '../shop/cutout.util';
import { OutfitsService } from '../outfits/outfits.service';

const COLLAGE_DIR = path.join(STORAGE_DIR, 'collages');
// Repo-root assets: imageUrl values like `assets/images/x.jpg` are the
// Flutter bundle's files, which live next to backend/ in the repo.
const REPO_ASSETS = path.resolve(__dirname, '../../../../assets');

/** Bumped whenever the layout changes so old cached files are not reused. */
const LAYOUT_VERSION = 'v4-flatlay';

const CANVAS = 1024;
const BACKGROUND = '#f4f0e8';

interface Slot {
  /** Center position and target width on the 1024px canvas. */
  cx: number;
  cy: number;
  w: number;
}

/**
 * Where each garment kind sits in the flat-lay, arranged the way someone
 * would lay an outfit on a bed: outer layer on the left, top above bottom,
 * shoes underneath, accessories to the side. No grid, pieces may breathe.
 */
const SLOT_LAYOUT: Record<string, Slot> = {
  outerwear: { cx: 250, cy: 310, w: 340 },
  top: { cx: 580, cy: 270, w: 350 },
  dress: { cx: 512, cy: 480, w: 470 },
  bottom: { cx: 580, cy: 620, w: 370 },
  shoes: { cx: 390, cy: 870, w: 300 },
  accessory: { cx: 830, cy: 720, w: 220 },
};
/** Center spill-over for kinds beyond the six slots. */
const FALLBACK_SLOT: Slot = { cx: 780, cy: 350, w: 240 };

/** Composite order: layers further back first so overlaps read naturally. */
const SLOT_ORDER = ['outerwear', 'dress', 'top', 'bottom', 'shoes', 'accessory'];

function slotOf(item: any): string {
  const cat = `${item?.category ?? ''} ${item?.name ?? ''}`.toLowerCase();
  if (/outerwear|jacket|blazer|coat|cardigan|hoodie/.test(cat)) return 'outerwear';
  if (/dress|gown|jumpsuit/.test(cat)) return 'dress';
  if (/shoe|sneaker|boot|heel|footwear|loafer|sandals?/.test(cat)) return 'shoes';
  if (/bottom|pants|jeans|trouser|chino|skirt|shorts?/.test(cat)) return 'bottom';
  if (/top|shirt|tee|blouse|knit|sweater|polo|tank/.test(cat)) return 'top';
  return 'accessory';
}

/** Soft elliptical shadow to ground a piece, as an SVG the item's width. */
function shadowSvg(w: number): Buffer {
  const h = Math.max(18, Math.round(w * 0.09));
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h * 2}">` +
      `<ellipse cx="${w / 2}" cy="${h}" rx="${w * 0.42}" ry="${h * 0.8}" ` +
      `fill="#3a332a" opacity="0.12"/></svg>`,
  );
}

/**
 * One styled flat-lay image per daily outfit: the pieces of the user's
 * recommended outfit with their plain studio backgrounds removed, laid out
 * as an outfit (not a grid) on one clean background with soft shadows.
 * Cached on disk so the same day's outfit is composed only once.
 */
@Injectable()
export class CollageService {
  constructor(private readonly outfits: OutfitsService) {
    fs.mkdirSync(COLLAGE_DIR, { recursive: true });
  }

  /** JPEG bytes for today's recommended outfit collage. */
  async dailyCollage(userId: string): Promise<{ file: string; bytes: Buffer }> {
    const rec: any = await this.outfits.recommended(userId, { count: 1 });
    const outfit = rec?.outfits?.[0];
    const items: any[] = outfit?.items ?? [];
    if (!items.length) {
      throw new NotFoundException('No outfit to compose yet.');
    }

    const day = new Date().toISOString().slice(0, 10);
    const key = createHash('sha1')
      .update(
        `${LAYOUT_VERSION}|${userId}|${day}|${items.map((i) => i.id).sort().join(',')}`,
      )
      .digest('hex')
      .slice(0, 16);
    const file = path.join(COLLAGE_DIR, `daily-${key}.jpg`);
    if (fs.existsSync(file)) {
      return { file, bytes: fs.readFileSync(file) };
    }

    // Assign each piece a slot; a kind that appears twice keeps the first.
    const placed = new Map<string, { item: any; bytes: Buffer }>();
    for (const item of items) {
      const bytes = this.itemImageBytes(`${item.imageUrl ?? ''}`);
      if (!bytes) continue;
      const slot = slotOf(item);
      if (!placed.has(slot)) placed.set(slot, { item, bytes });
    }
    if (!placed.size) {
      throw new NotFoundException('No readable item photos to compose.');
    }

    const composites: OverlayOptions[] = [];
    const ordered = [
      ...SLOT_ORDER.filter((s) => placed.has(s)),
    ];
    // Any piece that lost its slot to a duplicate kind still gets shown.
    const extras = [...placed.keys()].filter((s) => !SLOT_ORDER.includes(s));
    for (const s of extras) ordered.push(s);

    let extraCount = 0;
    for (const slot of ordered) {
      const { bytes } = placed.get(slot)!;
      const layout = SLOT_LAYOUT[slot] ?? {
        ...FALLBACK_SLOT,
        cx: FALLBACK_SLOT.cx - (extraCount % 2) * 120,
        cy: FALLBACK_SLOT.cy + extraCount * 130,
      };
      if (!SLOT_LAYOUT[slot]) extraCount++;

      const cut = await this.cutout(bytes, layout.w);
      if (!cut) continue;
      const meta = await sharp(cut).metadata();
      const w = meta.width ?? layout.w;
      const h = meta.height ?? layout.w;
      const left = Math.round(layout.cx - w / 2);
      const top = Math.round(layout.cy - h / 2);
      // Shadow first, slightly below the piece's bottom edge.
      composites.push({
        input: shadowSvg(Math.round(w * 0.9)),
        left: Math.round(layout.cx - w * 0.45),
        top: Math.round(top + h - h * 0.08),
      });
      composites.push({ input: cut, left, top });
    }
    if (!composites.length) {
      throw new NotFoundException('No readable item photos to compose.');
    }

    const bytes = await sharp({
      create: {
        width: CANVAS,
        height: CANVAS,
        channels: 3,
        background: BACKGROUND,
      },
    })
      .composite(composites)
      .jpeg({ quality: 90 })
      .toBuffer();

    fs.writeFileSync(file, bytes);
    return { file, bytes };
  }

  /**
   * A piece photo with its plain background removed, trimmed and resized to
   * the slot width. Falls back to the original (flattened) when removal
   * leaves nothing usable, e.g. a busy bedroom photo.
   */
  private async cutout(bytes: Buffer, targetWidth: number): Promise<Buffer | null> {
    // Downscale first: the flood fill is per-pixel, so this is ~4x cheaper.
    const small = await sharp(bytes)
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();
    try {
      const png = await removePlainBackground(small);
      // Sanity: a white garment on a near-white studio background gets eaten
      // by the fill (its edge is within tolerance), and a busy bedroom photo
      // keeps almost everything. Both cases look wrong, so they fall back to
      // the original photo with soft rounded corners.
      const { data, info } = await sharp(png)
        .raw()
        .toBuffer({ resolveWithObject: true });
      let kept = 0;
      const total = info.width * info.height;
      for (let i = 3; i < data.length; i += info.channels) {
        if (data[i] > 8) kept++;
      }
      const ratio = kept / total;
      if (ratio < 0.06 || ratio > 0.97) {
        return this.roundedOriginal(small, targetWidth);
      }
      const trimmed = await sharp(png).trim({ threshold: 12 }).toBuffer();
      const meta = await sharp(trimmed).metadata();
      if (!meta.width || !meta.height || meta.width < 24 || meta.height < 24) {
        return this.roundedOriginal(small, targetWidth);
      }
      return await sharp(trimmed)
        .resize(targetWidth, null, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch {
      return this.roundedOriginal(small, targetWidth);
    }
  }

  /** The untouched photo with soft rounded corners, for photos the plain
   * background removal cannot handle (white-on-white, busy scenes). */
  private async roundedOriginal(bytes: Buffer, targetWidth: number): Promise<Buffer | null> {
    try {
      const resized = await sharp(bytes)
        .resize(targetWidth, null, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      const meta = await sharp(resized).metadata();
      const w = meta.width ?? targetWidth;
      const h = meta.height ?? targetWidth;
      const r = Math.round(Math.min(w, h) * 0.06);
      const mask = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
          `<rect x="0" y="0" width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`,
      );
      return await sharp(resized)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    } catch {
      return null;
    }
  }

  /** Bytes for one wardrobe item photo, or null when unreadable. */
  private itemImageBytes(imageUrl: string): Buffer | null {
    if (!imageUrl) return null;
    const stored = readStoredImage(imageUrl);
    if (stored) return stored;
    if (imageUrl.startsWith('assets/')) {
      const file = path.join(REPO_ASSETS, imageUrl.slice('assets/'.length));
      if (file.startsWith(REPO_ASSETS) && fs.existsSync(file)) {
        return fs.readFileSync(file);
      }
    }
    return null;
  }
}
