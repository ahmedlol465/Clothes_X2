/**
 * Photo quality gate: runs before any model, so a bad photo gets a specific,
 * actionable message instead of a wrong or random garment label.
 *
 * Every rejection carries:
 *   error_type  machine code the app switches on
 *   error       one-line reason (safe to show to the user)
 *   retake      short tips for the retake screen
 *
 * Thresholds were checked on real catalogue + in-the-wild photos and on
 * synthetically darkened / blurred copies; see test/eval/README.md.
 */
import sharp from 'sharp';

export const LIMITS = {
  maxBytes: 12 * 1024 * 1024,
  minSide: 160, // px, shorter side
  maxPixels: 80_000_000,
  darkMean: 45, // mean luma 0-255
  brightMean: 250,
  flatStd: 4, // almost no contrast (blank wall, lens covered)
  blurVar: 10, // variance of Laplacian on a 512px greyscale copy
};

const TIPS = {
  too_dark: ['Turn on a light or move near a window.', 'Keep the flash off glare, but avoid shadows over the garment.'],
  too_bright: ['Move out of direct sunlight or glare.', 'Make sure the garment is not washed out by a light behind it.'],
  too_blurry: ['Hold the phone steady, tap the garment to focus, and try again.', 'Clean the camera lens.'],
  low_contrast: ['Place the garment on a plain, contrasting surface (bed, floor, door).', 'Make sure the camera is not covered.'],
  too_small: ['Take the photo closer, with the whole garment in frame.'],
  too_large: ['Use a smaller photo (under 12 MB) or lower the camera quality.'],
  unsupported_format: ['Use a JPG, PNG or WebP photo.'],
  unreadable_image: ['The file could not be opened. Take the photo again.'],
};

const MESSAGES = {
  too_dark: 'This photo is too dark.',
  too_bright: 'This photo is overexposed.',
  too_blurry: 'This photo is blurry.',
  low_contrast: 'We cannot see the garment clearly in this photo.',
  too_small: 'This photo is too small.',
  too_large: 'This file is too large.',
  unsupported_format: 'This file type is not supported.',
  unreadable_image: 'This file could not be read as a photo.',
};

export function sniff(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function reject(type: string, extra: Record<string, unknown> = {}) {
  return { ok: false as const, error_type: type, error: MESSAGES[type], retake: TIPS[type], ...extra };
}

/**
 * Check a photo and return it auto-rotated (EXIF) as a clean JPEG.
 * Phone photos carry their rotation in EXIF; without this the model sees a
 * sideways garment.
 */
export async function checkPhoto(input: Buffer) {
  if (!input || !input.length) return reject('unreadable_image');
  if (input.length > LIMITS.maxBytes) return reject('too_large', { sizeMB: Number((input.length / 1048576).toFixed(1)) });
  if (!sniff(input)) return reject('unsupported_format');

  let meta;
  try {
    meta = await sharp(input, { failOn: 'error' }).metadata();
  } catch {
    return reject('unreadable_image');
  }
  const w = meta.width || 0;
  const h = meta.height || 0;
  // EXIF orientations 5-8 swap width and height.
  const swapped = (meta.orientation || 1) >= 5;
  const shortSide = Math.min(w, h);
  if (!w || !h || w * h > LIMITS.maxPixels) return reject('unreadable_image');
  if (shortSide < LIMITS.minSide) return reject('too_small', { width: swapped ? h : w, height: swapped ? w : h });

  let oriented: Buffer;
  let grey: { data: Buffer; info: { width: number; height: number } };
  try {
    oriented = await sharp(input).rotate().jpeg({ quality: 92 }).toBuffer();
    grey = await sharp(oriented).resize(512, 512, { fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  } catch {
    return reject('unreadable_image');
  }

  const { data, info } = grey;
  const n = data.length;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += data[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i += 1) sq += (data[i] - mean) ** 2;
  const std = Math.sqrt(sq / n);

  // Variance of the 4-neighbour Laplacian: low means no edges, i.e. blur.
  const W = info.width;
  const H = info.height;
  let ls = 0;
  let lq = 0;
  let lc = 0;
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      const l = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - W] - data[i + W];
      ls += l;
      lq += l * l;
      lc += 1;
    }
  }
  const lapVar = lq / lc - (ls / lc) ** 2;

  const stats = { meanBrightness: Number(mean.toFixed(1)), contrast: Number(std.toFixed(1)), sharpness: Number(lapVar.toFixed(1)) };
  if (mean < LIMITS.darkMean) return reject('too_dark', { stats });
  if (mean > LIMITS.brightMean) return reject('too_bright', { stats });
  if (std < LIMITS.flatStd) return reject('low_contrast', { stats });
  if (lapVar < LIMITS.blurVar) return reject('too_blurry', { stats });

  return { ok: true as const, bytes: oriented, stats };
}
