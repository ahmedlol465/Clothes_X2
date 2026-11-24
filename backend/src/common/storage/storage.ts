/**
 * Local file storage for wardrobe photos and avatars.
 *
 * The directory is resolved from this file's location so it is always
 * `<backend>/storage`, whether the app runs from `src` (ts-node) or `dist`
 * (compiled) and regardless of the shell's working directory.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Request } from 'express';
import { diskStorage } from 'multer';

export const STORAGE_DIR = path.resolve(__dirname, '../../../storage');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

export const multerOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => cb(null, STORAGE_DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (
    _req: unknown,
    file: { mimetype?: string },
    cb: (error: Error | null, accept?: boolean) => void,
  ) => {
    if (/^image\//.test(file.mimetype || '')) return cb(null, true);
    cb(new Error('Only image files are allowed.'));
  },
};

/** Absolute URL for a stored file, based on the incoming request host. */
export function storageUrl(req: Request, filename: string): string {
  return `${req.protocol}://${req.get('host')}/storage/${filename}`;
}

/** Resolve a `/storage/<file>` URL to raw bytes, or null. */
export function readStoredImage(imageUrl: string): Buffer | null {
  const match = String(imageUrl || '').match(/\/storage\/([^/?#]+)$/);
  if (!match) return null;
  const file = path.join(STORAGE_DIR, path.basename(match[1]));
  if (!file.startsWith(STORAGE_DIR) || !fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

/** Absolute filesystem path for one of our own storage files, or null. */
export function storagePathOf(imageUrl: string): string | null {
  const match = String(imageUrl || '').match(/\/storage\/([^/?#]+)$/);
  if (!match) return null;
  const name = path.basename(match[1]);
  if (name !== match[1]) return null;
  const file = path.join(STORAGE_DIR, name);
  if (!file.startsWith(STORAGE_DIR + path.sep)) return null;
  return fs.existsSync(file) ? file : null;
}

export function isOwnStorageUrl(url: string): boolean {
  const match = String(url || '').match(/\/storage\/([^/?#]+)$/);
  return Boolean(match) && path.basename(match[1]) === match[1];
}

/** Sniff an image type from magic bytes; never trust the filename. */
export function sniffImageMime(bytes: Buffer | null | undefined): string | null {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.slice(0, 6).toString('latin1') === 'GIF87a' || bytes.slice(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
  if (bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return null;
}
