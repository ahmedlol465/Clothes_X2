/**
 * Colour name from the image embedding the app already computes.
 *
 * A small logistic-regression head (one weight row per colour) trained on the
 * labelled Kaggle fashion photos. On a held-out half it names the colour
 * correctly about 72% of the time against 52% for the pixel read, and about
 * 87% when it is at least 50% sure. It adds one 512 x 24 multiply and no new
 * model. Below its confidence floor the caller keeps the pixel colour.
 */
import * as fs from 'fs';
import * as path from 'path';

const HEAD_FILE = path.join(__dirname, '..', '..', 'assets', 'vision-head', 'color-head.json');

/** Minimum probability before the head overrides the pixel colour. */
export const COLOR_HEAD_MIN_SHARE = 0.5;

let head: { classes: string[]; coef: number[][]; intercept: number[] } | null | undefined;

function load() {
  if (head !== undefined) return head;
  try {
    head = JSON.parse(fs.readFileSync(HEAD_FILE, 'utf8'));
  } catch {
    head = null; // missing file: callers fall back to the pixel colour
  }
  return head;
}

/** @returns the most likely colour and its probability, or null if unavailable. */
export function predictColor(vec: ArrayLike<number>): { color: string; share: number } | null {
  const h = load();
  if (!h || !vec || vec.length !== h.coef[0].length) return null;
  const logits = h.coef.map((row, k) => {
    let s = h.intercept[k];
    for (let i = 0; i < row.length; i += 1) s += row[i] * vec[i];
    return s;
  });
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  let best = 0;
  for (let k = 1; k < exps.length; k += 1) if (exps[k] > exps[best]) best = k;
  return { color: h.classes[best], share: exps[best] / sum };
}
