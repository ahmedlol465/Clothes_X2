import sharp from 'sharp';

/**
 * Cheap background removal for product photos shot on a plain (usually
 * white or light-grey) background: flood-fill inward from every border
 * pixel, clearing pixels whose color stays within tolerance of the sampled
 * border color. Interior regions of the garment that happen to be white
 * survive because the fill only reaches connected background.
 */
export async function removePlainBackground(input: Buffer): Promise<Buffer> {
  const img = sharp(input).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const px = (x: number, y: number) => (y * width + x) * channels;

  // Sample the background color from the corners.
  const corners = [px(0, 0), px(width - 1, 0), px(0, height - 1), px(width - 1, height - 1)];
  let br = 0, bg = 0, bb = 0;
  for (const c of corners) {
    br += data[c]; bg += data[c + 1]; bb += data[c + 2];
  }
  br /= 4; bg /= 4; bb /= 4;
  const tol = 36;
  const isBg = (i: number) =>
    Math.abs(data[i] - br) <= tol &&
    Math.abs(data[i + 1] - bg) <= tol &&
    Math.abs(data[i + 2] - bb) <= tol;

  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    const idx = y * width + x;
    if (x < 0 || y < 0 || x >= width || y >= height || visited[idx]) return;
    const i = px(x, y);
    if (!isBg(i)) return;
    visited[idx] = 1;
    queue.push(x, y);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }

  while (queue.length) {
    const x = queue.shift()!;
    const y = queue.shift()!;
    data[px(x, y) + 3] = 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}
