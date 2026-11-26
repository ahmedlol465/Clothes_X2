import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';

import { readStoredImage, STORAGE_DIR } from '../../common/storage/storage';
import { OutfitsService } from '../outfits/outfits.service';

const COLLAGE_DIR = path.join(STORAGE_DIR, 'collages');
// Repo-root assets: imageUrl values like `assets/images/x.jpg` are the
// Flutter bundle's files, which live next to backend/ in the repo.
const REPO_ASSETS = path.resolve(__dirname, '../../../../assets');

/**
 * One merged flat-lay image per daily outfit: the pieces of the user's
 * recommended outfit laid out as neat tiles on a canvas, cached on disk so
 * the same day's outfit is composed only once. No background removal; the
 * wardrobe photos are already clean studio-style shots.
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
      .update(`${userId}|${day}|${items.map((i) => i.id).sort().join(',')}`)
      .digest('hex')
      .slice(0, 16);
    const file = path.join(COLLAGE_DIR, `daily-${key}.jpg`);
    if (fs.existsSync(file)) {
      return { file, bytes: fs.readFileSync(file) };
    }

    const images: Buffer[] = [];
    for (const item of items.slice(0, 6)) {
      const bytes = this.itemImageBytes(`${item.imageUrl ?? ''}`);
      if (bytes) images.push(bytes);
    }
    if (!images.length) {
      throw new NotFoundException('No readable item photos to compose.');
    }

    const cell = 460;
    const gap = 24;
    const pad = 40;
    const cols = images.length === 1 ? 1 : 2;
    const rows = Math.ceil(images.length / cols);
    const width = pad * 2 + cols * cell + (cols - 1) * gap;
    const height = pad * 2 + rows * cell + (rows - 1) * gap;

    const tiles = await Promise.all(
      images.map(async (bytes, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        // A short last row is centered so the lay stays balanced.
        const inRow = Math.min(cols, images.length - row * cols);
        const rowWidth = inRow * cell + (inRow - 1) * gap;
        return {
          input: await sharp(bytes)
            .resize(cell, cell, { fit: 'contain', background: '#ffffff' })
            .flatten({ background: '#ffffff' })
            .toBuffer(),
          left: pad + Math.floor((width - pad * 2 - rowWidth) / 2) + col * (cell + gap),
          top: pad + row * (cell + gap),
        };
      }),
    );

    const bytes = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: '#f6f2ea',
      },
    })
      .composite(tiles)
      .jpeg({ quality: 88 })
      .toBuffer();

    fs.writeFileSync(file, bytes);
    return { file, bytes };
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
