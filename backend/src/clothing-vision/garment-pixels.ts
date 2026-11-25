/**
 * Garment cutout for the colour step (on by default).
 *
 * The photo is sent to the Python ai-service
 * (POST /api/v1/clothing/garment-pixels: detector + SAM 2). It answers with an
 * image of the garment's pixels only, so skin, hair and background cannot
 * change the colour. Measured on 57 hand-labelled worn photos: colour family
 * 67% -> 79%.
 *
 * Cost: about 6.7 s per photo on one CPU core once the models are loaded
 * (first call 15 s or more), roughly 1 GB RAM for the service. Production
 * hosting must run the service (ai-service/run.sh or docker compose up).
 *
 * It never breaks analysis. Service down, slow, no garment found, bad reply:
 * every case returns null and the colour is read from the whole photo, as
 * before. After a failure the service is skipped for a minute so uploads do
 * not each wait on it.
 *
 *   AI_SERVICE_URL=http://localhost:8000   where the service runs (this is the default)
 *   GARMENT_CUTOUT=off                     turns the cutout off
 *   GARMENT_CUTOUT_TIMEOUT_MS=30000        per-call limit
 */
const COOLDOWN_MS = 60_000;
let skipUntil = 0;

export function cutoutEnabled(): boolean {
  return String(process.env.GARMENT_CUTOUT || '').toLowerCase() !== 'off';
}

export async function garmentPixels(bytes: Buffer): Promise<Buffer | null> {
  if (!cutoutEnabled() || Date.now() < skipUntil) return null;
  const base = String(process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
  const timeoutMs = Number(process.env.GARMENT_CUTOUT_TIMEOUT_MS) || 30_000;
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)]), 'photo.jpg');
    const res = await fetch(`${base}/api/v1/clothing/garment-pixels`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 204) return null; // reachable, but no garment found
    if (!res.ok) {
      skipUntil = Date.now() + COOLDOWN_MS;
      return null;
    }
    const out = Buffer.from(await res.arrayBuffer());
    return out.length > 64 ? out : null;
  } catch {
    skipUntil = Date.now() + COOLDOWN_MS;
    return null;
  }
}
