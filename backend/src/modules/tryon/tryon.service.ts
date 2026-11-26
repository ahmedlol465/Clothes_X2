import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';

import { readStoredImage, STORAGE_DIR } from '../../common/storage/storage';
import { CollageService } from '../collage/collage.service';
import { OutfitsService } from '../outfits/outfits.service';

const TRYON_DIR = path.join(STORAGE_DIR, 'tryon');
// Repo-root assets: imageUrl values like `assets/images/x.jpg` are the
// Flutter bundle's files, which live next to backend/ in the repo.
const REPO_ASSETS = path.resolve(__dirname, '../../../../assets');
const PERSON_ASSET = path.join(REPO_ASSETS, 'images', 'tryon_person.jpg');

/** Bumped whenever the prompt or input layout changes. */
const TRYON_VERSION = 'v2-flux-klein';

const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const OUT_W = 512;
const OUT_H = 768;
/** Inputs must stay small; the model accepts at most four. */
const MAX_INPUT_PX = 512;
const REQUEST_TIMEOUT_MS = 45_000;

const PROMPT_NO_LAYER =
  'Photorealistic studio photo of the man from the first image wearing ' +
  'the top from the second image, the full-length pants from the third ' +
  'image (not shorts), and the shoes and belt from the fourth image. ' +
  'Keep his face, pose, body and background unchanged.';
const PROMPT_WITH_LAYER =
  'Photorealistic studio photo of the man from the first image wearing ' +
  'the two upper-body garments from the second image, the shirt under ' +
  'the open outer layer, plus the full-length pants from the third ' +
  'image (not shorts), and the shoes and belt from the fourth image. ' +
  'Keep his face, pose, body and background unchanged.';

interface OutfitSlots {
  top?: { item: any; bytes: Buffer };
  bottom?: { item: any; bytes: Buffer };
  shoes?: { item: any; bytes: Buffer };
  accessory?: { item: any; bytes: Buffer };
  outerwear?: { item: any; bytes: Buffer };
}

function slotOf(item: any): keyof OutfitSlots {
  const cat = `${item?.category ?? ''} ${item?.name ?? ''}`.toLowerCase();
  if (/outerwear|jacket|blazer|coat|cardigan|hoodie/.test(cat)) return 'outerwear';
  if (/shoe|sneaker|boot|heel|footwear|loafer|sandals?/.test(cat)) return 'shoes';
  if (/bottom|pants|jeans|trouser|chino|skirt|shorts?/.test(cat)) return 'bottom';
  if (/top|shirt|tee|blouse|knit|sweater|polo|tank|t-shirt/.test(cat)) return 'top';
  return 'accessory';
}

/**
 * AI try-on: today's recommended outfit rendered onto a person photo by
 * Cloudflare Workers AI (FLUX.2 klein 4B, image-to-image with reference
 * inputs). The model takes at most four inputs, so shoes and belt share
 * one side-by-side image.
 *
 * Results are cached per outfit (not per day) so the free daily neuron
 * allowance is only spent when the recommended outfit actually changes.
 * Every failure - missing credentials, rate limit, content filter,
 * timeout - falls back to the local flat-lay collage, and the response
 * header says which one it is.
 */
@Injectable()
export class TryonService {
  private readonly log = new Logger(TryonService.name);

  constructor(
    private readonly outfits: OutfitsService,
    private readonly collage: CollageService,
  ) {
    fs.mkdirSync(TRYON_DIR, { recursive: true });
  }

  /**
   * JPEG bytes of today's outfit on a person, or of the flat-lay collage
   * when the AI path is unavailable. `source` says which.
   */
  async dailyTryOn(
    userId: string,
  ): Promise<{ file: string; bytes: Buffer; source: 'ai' | 'collage' }> {
    const rec: any = await this.outfits.recommended(userId, { count: 1 });
    const outfit = rec?.outfits?.[0];
    const items: any[] = outfit?.items ?? [];
    if (!items.length) {
      throw new NotFoundException('No outfit to try on yet.');
    }

    const key = createHash('sha1')
      .update(
        `${TRYON_VERSION}|${userId}|${items.map((i) => i.id).sort().join(',')}`,
      )
      .digest('hex')
      .slice(0, 16);
    const file = path.join(TRYON_DIR, `tryon-${key}.jpg`);
    if (fs.existsSync(file)) {
      return { file, bytes: fs.readFileSync(file), source: 'ai' };
    }

    try {
      const bytes = await this.renderWithCloudflare(items);
      fs.writeFileSync(file, bytes);
      return { file, bytes, source: 'ai' };
    } catch (e) {
      this.log.warn(
        `AI try-on unavailable (${(e as Error).message}); using collage.`,
      );
      const fallback = await this.collage.dailyCollage(userId);
      return { file: fallback.file, bytes: fallback.bytes, source: 'collage' };
    }
  }

  private async renderWithCloudflare(items: any[]): Promise<Buffer> {
    const accountId = process.env.CF_ACCOUNT_ID;
    const token = process.env.CF_API_TOKEN;
    if (!accountId || !token) {
      throw new Error('CF_ACCOUNT_ID / CF_API_TOKEN not configured');
    }
    if (!fs.existsSync(PERSON_ASSET)) {
      throw new Error('person base image missing');
    }

    const slots = this.slots(items);
    if (!slots.top && !slots.bottom) {
      throw new Error('outfit has no top or bottom to wear');
    }

    // Input 0: the person. Input 1: top, or top + outerwear side by side
    // when the outfit layers. Input 2: bottoms. Input 3: shoes and
    // accessory side by side (four inputs max).
    const inputs: Buffer[] = [
      await this.downscale(fs.readFileSync(PERSON_ASSET)),
    ];
    let prompt = PROMPT_NO_LAYER;
    if (slots.top && slots.outerwear) {
      inputs.push(await this.sideBySide([slots.top.bytes, slots.outerwear.bytes]));
      prompt = PROMPT_WITH_LAYER;
    } else if (slots.top) {
      inputs.push(await this.downscale(slots.top.bytes));
    } else if (slots.outerwear) {
      inputs.push(await this.downscale(slots.outerwear.bytes));
    }
    if (slots.bottom) inputs.push(await this.downscale(slots.bottom.bytes));
    const extras: Buffer[] = [];
    if (slots.shoes) extras.push(slots.shoes.bytes);
    if (slots.accessory) extras.push(slots.accessory.bytes);
    if (extras.length) inputs.push(await this.sideBySide(extras));

    const form = new FormData();
    form.append('prompt', prompt);
    form.append('width', `${OUT_W}`);
    form.append('height', `${OUT_H}`);
    inputs.forEach((bytes, i) => {
      form.append(
        `input_image_${i}`,
        new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
        `input_${i}.jpg`,
      );
    });

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      throw new Error(`Cloudflare ${res.status}: ${body}`);
    }
    const payload: any = await res.json();
    const b64 = payload?.result?.image;
    if (!b64 || typeof b64 !== 'string') {
      throw new Error('Cloudflare returned no image');
    }
    return Buffer.from(b64, 'base64');
  }

  private slots(items: any[]): OutfitSlots {
    const slots: OutfitSlots = {};
    for (const item of items) {
      const bytes = this.itemImageBytes(`${item.imageUrl ?? ''}`);
      if (!bytes) continue;
      const slot = slotOf(item);
      if (!slots[slot]) slots[slot] = { item, bytes };
    }
    return slots;
  }

  /** Fit inside MAX_INPUT_PX on white, as JPEG. */
  private async downscale(bytes: Buffer): Promise<Buffer> {
    return sharp(bytes)
      .resize(MAX_INPUT_PX, MAX_INPUT_PX, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .toBuffer();
  }

  /** Two product photos side by side on one white square (4-input limit). */
  private async sideBySide(images: Buffer[]): Promise<Buffer> {
    const half = MAX_INPUT_PX / 2;
    const overlays = await Promise.all(
      images.slice(0, 2).map(async (bytes, i) => ({
        input: await sharp(bytes)
          .resize(half, MAX_INPUT_PX, { fit: 'inside' })
          .flatten({ background: '#ffffff' })
          .png()
          .toBuffer(),
        left: i * half,
        top: 0,
      })),
    );
    return sharp({
      create: {
        width: MAX_INPUT_PX,
        height: MAX_INPUT_PX,
        channels: 3,
        background: '#ffffff',
      },
    })
      .composite(overlays)
      .jpeg({ quality: 88 })
      .toBuffer();
  }

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
