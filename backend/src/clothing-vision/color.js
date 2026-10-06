/**
 * Garment colour read off the pixels, not off the model (§9 AI PIPELINE).
 *
 * The rule this file exists to enforce: colour comes from the garment's own
 * pixels. CLIP knows a red t-shirt from a blue one, but it has no idea which
 * pixels are the t-shirt, so asking it for colour returns the most
 * photographable answer rather than the most pigmented one — a white shirt on a
 * wooden floor comes back "brown". So this module segments first and then
 * measures only what survived.
 *
 * Segmentation is deliberately plain maths rather than a second network. In a
 * wardrobe product photo the garment sits in the middle of the frame and the
 * ground is at the edges, so two small colour models are enough:
 *
 *   background model   k-means over the outer ring
 *   foreground model   k-means over the central ellipse
 *
 * and each pixel goes to whichever it is closer to in CIELAB. That handles the
 * two failure modes a single border median cannot: a garment that touches every
 * edge (so the border median *is* the garment and a border-anchored fill
 * inverts the whole frame), and a background with no single colour.
 *
 * A border-anchored flood fill is still tried first, because when the ground is
 * one flat colour it is exact. Whichever path ran is reported as `method`, and
 * a colour from a guessed mask carries a lower `confidence` than one from a
 * confident mask — so a failed segmentation is visible in the payload instead of
 * quietly producing a confident wrong answer.
 *
 * Colour is then named from the masked pixels in CIELAB LCh. That choice is
 * load-bearing, not stylistic. HSV hue is useless for the colours wardrobe
 * photos are actually full of: khaki, tan, beige and brown all land in HSV hue
 * 25-45 at wildly different saturations, and near grey hue wanders with
 * compression noise. Lab hue separates those families (khaki 93, tan 77, brown
 * 64) and Lab chroma separates the muted member from the vivid one (beige 10.7,
 * tan 34.6, mustard 69.6), which is exactly the distinction that names a
 * garment. HSV is still measured and reported, but nothing reads it.
 *
 * Pure functions plus one `sharp` decode. No model, no network.
 */
'use strict';

/** Longest edge used for analysis. Colour is a low-frequency signal. */
const MAX_EDGE = 320;

const CONFIG = {
  // CIELAB ΔE from the estimated ground colour that still counts as ground when
  // seeding the fill at the image border.
  backgroundDeltaE: 10,
  // Growth allowance for the fill, again measured against the estimated ground
  // colour and not against the neighbouring pixel. Comparing to the neighbour
  // lets the fill creep: a beige garment next to a white backdrop is only ~20 ΔE
  // away per step, so a relative test walks straight over the garment and
  // returns "the whole frame is background". Measuring against one fixed colour
  // bounds the total drift, so the fill stops at the first real colour change.
  neighborDeltaE: 16,
  // Blobs smaller than this share of the frame are texture, not garment.
  minBlobRatio: 0.02,
  // 75th percentile ΔE within the border ring that still counts as one flat
  // backdrop. Above this the "background" is really a busy scene.
  flatGroundDeltaE: 20,
  // Ground must cover at least this much of the frame for the flood to mean
  // anything; below it the border colour is the garment, not the background.
  minGroundRatio: 0.06,
  // Largest foreground we will believe. Above this we assume no usable ground.
  maxCoverage: 0.9,
  // Coverage band that earns full confidence.
  idealCoverage: [0.08, 0.7],
  // Hue concentration below this reads as a print rather than a colour.
  hueConcentration: 0.55,
  // Lightness spread (Lab L p90 - p10) above this reads as a print. A solid
  // garment still spreads ~15-25 across its own shading, so this is deliberately
  // generous; it exists to catch stripes and colour blocks, not to second-guess
  // a measured median.
  lightnessSpread: 55,
  // Chroma (CIELAB C) below this is a neutral, whatever hue says.
  neutralChroma: 9,
  k: 4,
  kmeansIterations: 12,
  // Pixels shaved off the mask boundary before the colour is measured.
  erodePixels: 2,
};

// ------------------------------------------------------------------ colour space

/** sRGB 0-255 -> CIELAB (D65). Writes into out at `o`, returns out. */
function rgbToLab(r, g, b, out, o) {
  const lin = (c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  // sRGB -> XYZ, D65
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
  return out;
}

/** sRGB 0-255 -> H (deg), S (0-1), V (0-1). Writes into out at `o`. */
function rgbToHsv(r, g, b, out, o) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === R) h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
    if (h < 0) h += 360;
  }
  out[o] = h;
  out[o + 1] = max > 1e-6 ? d / max : 0;
  out[o + 2] = max;
  return out;
}

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const deltaE = (la, oa, lb, ob) => Math.hypot(la[oa] - lb[ob], la[oa + 1] - lb[ob + 1], la[oa + 2] - lb[ob + 2]);

function median(values) {
  if (!values.length) return NaN;
  const s = Float64Array.from(values).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

// ------------------------------------------------------------------ statistics

/** k-means in CIELAB. Deterministic: seeds are spread by input order. */
function kmeans(samples, k) {
  if (!samples.length) return [];
  const kk = Math.max(1, Math.min(k, samples.length));
  const centroids = [];
  for (let i = 0; i < kk; i += 1) centroids.push(samples[Math.floor((i + 0.5) * samples.length / kk)].slice());

  const assign = new Int32Array(samples.length);
  for (let iter = 0; iter < CONFIG.kmeansIterations; iter += 1) {
    for (let i = 0; i < samples.length; i += 1) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kk; c += 1) {
        const d = dist3(samples[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[i] = best;
    }
    const sums = Array.from({ length: kk }, () => [0, 0, 0, 0]);
    for (let i = 0; i < samples.length; i += 1) {
      const s = sums[assign[i]];
      s[0] += samples[i][0];
      s[1] += samples[i][1];
      s[2] += samples[i][2];
      s[3] += 1;
    }
    for (let c = 0; c < kk; c += 1) {
      if (sums[c][3]) centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
    }
  }
  return centroids;
}

/** Nearest-centroid distance. */
function nearest(point, centroids) {
  let best = Infinity;
  for (const c of centroids) {
    const d = dist3(point, c);
    if (d < best) best = d;
  }
  return best;
}

/** Sample the outer ring (background model) and central ellipse (foreground). */
function regionSamples(lab, w, h) {
  const n = w * h;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const rx = w / 2;
  const ry = h / 2;
  const ring = [];
  const centre = [];
  const step = Math.max(1, Math.round(Math.min(w, h) / 48));

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const o = (y * w + x) * 3;
      const nx = (x - cx) / (rx || 1);
      const ny = (y - cy) / (ry || 1);
      const r = Math.hypot(nx, ny);
      if (r > 0.86) ring.push([lab[o], lab[o + 1], lab[o + 2]]);
      else if (r < 0.42) centre.push([lab[o], lab[o + 1], lab[o + 2]]);
    }
  }
  void n;
  return { ring, centre };
}

// ------------------------------------------------------------------ segmentation

/**
 * Flood the ground inwards from the border.
 * A pixel joins the ground when it is within `neighborDeltaE` of a ground pixel
 * already accepted, so a gradient backdrop is absorbed while a garment of a
 * different colour stops the fill.
 */
function floodGround(lab, w, h, ground) {
  const n = w * h;
  const isGround = new Uint8Array(n);
  const stack = [];

  const tryPush = (idx) => {
    if (isGround[idx]) return;
    const o = idx * 3;
    if (deltaE(lab, o, ground, 0) <= CONFIG.backgroundDeltaE) {
      isGround[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < w; x += 1) {
    tryPush(x);
    tryPush((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    tryPush(y * w);
    tryPush(y * w + w - 1);
  }

  // Every candidate is judged against the same estimated ground colour, so the
  // fill can absorb backdrop shading but cannot accumulate drift.
  const growthOk = (idx) => deltaE(lab, idx * 3, ground, 0) <= CONFIG.neighborDeltaE;
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0 && !isGround[idx - 1] && growthOk(idx - 1)) { isGround[idx - 1] = 1; stack.push(idx - 1); }
    if (x < w - 1 && !isGround[idx + 1] && growthOk(idx + 1)) { isGround[idx + 1] = 1; stack.push(idx + 1); }
    if (y > 0 && !isGround[idx - w] && growthOk(idx - w)) { isGround[idx - w] = 1; stack.push(idx - w); }
    if (y < h - 1 && !isGround[idx + w] && growthOk(idx + w)) { isGround[idx + w] = 1; stack.push(idx + w); }
  }
  return isGround;
}

/** Connected components of the set pixels in `mask`, largest first. */
function blobs(mask, w, h) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const out = [];
  const stack = [];
  for (let i = 0; i < n; i += 1) {
    if (!mask[i] || seen[i]) continue;
    const group = { count: 0, idx: [] };
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const idx = stack.pop();
      group.count += 1;
      group.idx.push(idx);
      const x = idx % w;
      const y = (idx - x) / w;
      if (x > 0 && mask[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
      if (x < w - 1 && mask[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && mask[idx - w] && !seen[idx - w]) { seen[idx - w] = 1; stack.push(idx - w); }
      if (y < h - 1 && mask[idx + w] && !seen[idx + w]) { seen[idx + w] = 1; stack.push(idx + w); }
    }
    out.push(group);
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * Mask from a foreground/background colour model.
 *
 * Each pixel joins the foreground when it sits closer to a central-region
 * centroid than to an outer-ring centroid, then the large blobs are kept. This
 * is the path that survives a garment filling the frame, because there the ring
 * is mostly garment *and* the centre is mostly garment, so the two models
 * differ where the ground actually is.
 */
function colourModelMask(lab, w, h) {
  const { ring, centre } = regionSamples(lab, w, h);
  if (!ring.length || !centre.length) return null;
  const bg = kmeans(ring, CONFIG.k);
  const fg = kmeans(centre, CONFIG.k);
  if (!bg.length || !fg.length) return null;

  const n = w * h;
  const mask = new Uint8Array(n);
  const px = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const o = i * 3;
    px[0] = lab[o];
    px[1] = lab[o + 1];
    px[2] = lab[o + 2];
    if (nearest(px, fg) < nearest(px, bg)) mask[i] = 1;
  }
  return mask;
}

/**
 * Peel `iterations` pixels off the mask boundary.
 *
 * Product shots put a soft contact shadow all the way round a garment, and
 * shadow pixels are dark. Measuring straight off the boundary drags the median
 * lightness down far enough to turn grey trousers into "black", so the boundary
 * is discarded before anything is measured. Two pixels is enough to remove the
 * contact shadow without eating into the fabric.
 */
function erode(mask, w, h, iterations = 2) {
  let cur = mask;
  let next = new Uint8Array(w * h);
  for (let it = 0; it < iterations; it += 1) {
    next.fill(0);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        if (!cur[i]) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
        if (cur[i - 1] && cur[i + 1] && cur[i - w] && cur[i + w]) next[i] = 1;
      }
    }
    cur = next;
    next = new Uint8Array(w * h);
  }
  return cur;
}

/** Keep the blobs large enough to be a garment rather than texture. */
function keepLargeBlobs(raw, w, h, ratio = CONFIG.minBlobRatio) {
  const n = w * h;
  const groups = blobs(raw, w, h).filter((b) => b.count >= n * ratio);
  const mask = new Uint8Array(n);
  let kept = 0;
  for (const b of groups) {
    for (const i of b.idx) mask[i] = 1;
    kept += b.count;
  }
  return { mask, coverage: kept / n, blobCount: groups.length };
}

/**
 * Segment the garment.
 *
 * @returns {{mask: Uint8Array, coverage: number, method: string, blobCount: number}}
 */
function segment(lab, w, h) {
  const n = w * h;
  const { ring, centre } = regionSamples(lab, w, h);

  // Tier 1 — flat ground: exact, and preferred when it is available.
  if (ring.length) {
    // One ground colour, and only when the ring genuinely agrees on it.
    const ground = [median(ring.map((c) => c[0])), median(ring.map((c) => c[1])), median(ring.map((c) => c[2]))];
    const ringDelta = Float64Array.from(ring.map((c) => dist3(c, ground))).sort();
    const ringP75 = percentile(ringDelta, 0.75);
    const isGround = floodGround(lab, w, h, ground);
    let groundCount = 0;
    for (const v of isGround) groundCount += v;
    const groundRatio = groundCount / n;
    if (ringP75 <= CONFIG.flatGroundDeltaE
      && groundRatio >= CONFIG.minGroundRatio
      && groundRatio <= CONFIG.maxCoverage) {
      const fgMask = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) fgMask[i] = isGround[i] ? 0 : 1;
      const kept = keepLargeBlobs(fgMask, w, h);
      if (kept.coverage >= CONFIG.minBlobRatio && kept.coverage <= CONFIG.maxCoverage) {
        return { ...kept, method: 'border-flood' };
      }
    }
  }

  // Tier 2 — colour models. Handles a garment that touches the edges and a
  // background with more than one colour.
  if (centre.length) {
    const raw = colourModelMask(lab, w, h);
    if (raw) {
      const kept = keepLargeBlobs(raw, w, h);
      if (kept.coverage >= CONFIG.minBlobRatio && kept.coverage <= CONFIG.maxCoverage) {
        return { ...kept, method: 'colour-model' };
      }
      // The mask ran away — most likely the models agreed on nothing and one
      // class took the frame. Fall back to the smaller half, which is the
      // garment in every framing this app produces.
      if (kept.blobCount > 0) {
        const flipped = new Uint8Array(n);
        for (let i = 0; i < n; i += 1) flipped[i] = raw[i] ? 0 : 1;
        const other = keepLargeBlobs(flipped, w, h);
        if (other.coverage >= CONFIG.minBlobRatio && other.coverage <= CONFIG.maxCoverage) {
          return { ...other, method: 'colour-model-inverted' };
        }
      }
    }
  }

  // Tier 3 — no usable segmentation. Measure the whole frame and say so.
  const mask = new Uint8Array(n).fill(1);
  return { mask, coverage: 1, blobCount: 1, method: 'whole-frame' };
}

// ------------------------------------------------------------------ naming

/**
 * Name a chromatic colour from CIELAB lightness, chroma and hue.
 *
 * Everything here is LCh, not HSV. HSV hue is unusable for the colours wardrobe
 * photos are actually full of: khaki, tan, beige and brown all sit at HSV hue
 * 25-45 with saturation 0.1-0.7, so HSV reports tan and olive as the same hue
 * and split saturated reds from burgundy by a saturation threshold that moves
 * with the lighting. Lab hue separates them properly (khaki 93, tan 77, brown
 * 64) and Lab chroma separates the muted members of a family from the vivid
 * ones (beige 10.7, tan 34.6, mustard 69.6), which is the distinction that
 * actually matters when naming a garment.
 *
 * Within each hue band, lightness picks the step of the ramp and chroma picks
 * how saturated that step is expected to be.
 */
function chromaticName(L, C, h) {
  // Reds, pinks, magentas. Lab hue wraps, so this band is split in two.
  if (h < 24) return C > 55 ? 'Red' : 'Burgundy';
  if (h < 44) return L >= 58 && C > 50 ? 'Orange' : 'Red';
  if (h < 56) return L < 40 ? 'Brown' : 'Rust';
  if (h < 72) {
    if (L >= 50) return C > 50 ? 'Orange' : 'Tan';
    if (L >= 32) return C > 42 ? 'Rust' : 'Brown';
    return C > 42 ? 'Rust' : 'Dark Brown';
  }
  if (h < 84) return L < 50 ? 'Brown' : C > 50 ? 'Mustard' : 'Tan';
  // The beige / khaki / olive run. These are the colours HSV cannot see.
  if (h < 100) {
    if (L >= 80) return 'Beige';
    if (L >= 62) return C < 36 ? 'Khaki' : C > 50 ? 'Mustard' : 'Tan';
    return L >= 45 ? 'Khaki' : 'Olive';
  }
  if (h < 120) return 'Olive';
  if (h < 172) return C > 34 ? 'Emerald' : L < 30 ? 'Forest Green' : 'Green';
  if (h < 200) return C > 34 ? 'Teal' : 'Teal';
  if (h < 240) return L >= 70 && C < 26 ? 'Light Blue' : C > 34 ? 'Blue' : 'Teal';
  // Blues. Navy and denim are the same hue and differ almost only in lightness.
  if (h < 292) {
    if (L >= 65 && C < 28) return 'Light Blue';
    if (L < 34) return 'Navy';
    return 'Blue';
  }
  if (h < 306) return C > 45 ? 'Indigo' : 'Blue';
  if (h < 320) return C > 40 ? 'Purple' : 'Blue';
  return L >= 62 && C < 45 ? 'Pink' : C > 55 ? 'Magenta' : 'Pink';
}

/**
 * Name a neutral from CIELAB lightness plus the a / b balance.
 *
 * `warmth` is positive on the yellow/red side, so a bright warm grey is cream
 * and a bright cool grey is off-white. HSV hue would be arbitrary here — near
 * grey every channel is within a couple of counts of the others, so the hue
 * wanders with compression noise and lighting.
 */
function neutralName(L, a, b) {
  const warmth = a * 0.6 + b;

  if (L >= 92) return 'White';
  if (L >= 82) return warmth > 2 ? 'Cream' : 'Off-White';
  if (L >= 66) return warmth > 6 ? 'Cream' : 'Light Grey';
  if (L >= 40) return 'Grey';
  if (L >= 20) return 'Charcoal';
  return 'Black';
}

// ------------------------------------------------------------------ public API

/**
 * Read garment colour out of an encoded image.
 *
 * @param {Buffer|Uint8Array} input  encoded image bytes
 * @returns {Promise<object>} colour name plus the measurement behind it
 */
async function analyzeColor(input) {
  const sharp = require('sharp');
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h, channels } = info;
  const n = w * h;
  const lab = new Float32Array(n * 3);
  const hsv = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    // Source stride is the decoder's channel count; Lab and HSV are always 3.
    const src = i * channels;
    const o = i * 3;
    rgbToLab(data[src], data[src + 1], data[src + 2], lab, o);
    rgbToHsv(data[src], data[src + 1], data[src + 2], hsv, o);
  }

  const seg = segment(lab, w, h);
  // Drop the contact shadow around the garment before measuring anything.
  const measuredMask = erode(seg.mask, w, h, CONFIG.erodePixels);
  const idx = [];
  for (let i = 0; i < n; i += 1) if (measuredMask[i]) idx.push(i);
  // Erosion can consume a thin garment entirely; fall back to the raw mask.
  if (idx.length < Math.max(64, n * 0.005)) {
    idx.length = 0;
    for (let i = 0; i < n; i += 1) if (seg.mask[i]) idx.push(i);
  }

  const Ls = [];
  const as = [];
  const bs = [];
  const chromas = [];
  const sats = [];
  const vals = [];
  let hueX = 0;
  let hueY = 0;
  let hueWeight = 0;
  let hsvX = 0;
  let hsvY = 0;
  let hsvWeight = 0;

  for (const i of idx) {
    const o = i * 3;
    const a = lab[o + 1];
    const b = lab[o + 2];
    const pxChroma = Math.hypot(a, b);
    Ls.push(lab[o]);
    as.push(a);
    bs.push(b);
    chromas.push(pxChroma);
    sats.push(hsv[o + 1]);
    vals.push(hsv[o + 2]);
    // Parallel HSV accumulator, so the payload can still report HSV for any
    // consumer that expects it. Same weight as the Lab mean, same reason.
    if (hsv[o + 1] > 0.15) {
      const rad = (hsv[o] * Math.PI) / 180;
      hsvX += Math.cos(rad) * pxChroma;
      hsvY += Math.sin(rad) * pxChroma;
      hsvWeight += pxChroma;
    }
    // Only pixels with real chroma get a vote on hue. Near-greys have an
    // arbitrary Lab hue, and letting them into the mean drags a brown jacket's
    // hue toward whatever the shadows are. Weighting by chroma also means a
    // saturated panel counts more than a tinted one, which is what "the colour
    // of this garment" means.
    if (pxChroma >= CONFIG.neutralChroma) {
      // atan2 is already in radians. Converting again (as the HSV branch above
      // had to, because HSV hue is stored in degrees) collapses every hue to
      // roughly 0, which is how a whole palette of blues and browns ends up
      // reported as burgundy.
      const rad = Math.atan2(b, a);
      hueX += Math.cos(rad) * pxChroma;
      hueY += Math.sin(rad) * pxChroma;
      hueWeight += pxChroma;
    }
  }

  const L = median(Ls);
  const A = median(as);
  const B = median(bs);
  const chroma = median(chromas);
  const sat = median(sats);
  const val = median(vals);

  const sortedL = Float64Array.from(Ls).sort();
  const lightnessSpread = percentile(sortedL, 0.9) - percentile(sortedL, 0.1);

  const labHue = hueWeight > 0
    ? ((Math.atan2(hueY, hueX) * 180) / Math.PI + 360) % 360
    : 0;
  // |mean resultant| of the chroma-weighted hue circle: 1 = one hue, 0 = all.
  const hueConcentration = hueWeight > 0 ? Math.hypot(hueX, hueY) / hueWeight : 1;

  const isChromatic = chroma >= CONFIG.neutralChroma;
  let name;
  let multicolor = false;
  if (!isChromatic) {
    name = neutralName(L, A, B);
  } else if (hueConcentration < CONFIG.hueConcentration || lightnessSpread > CONFIG.lightnessSpread) {
    name = 'Multicolor';
    multicolor = true;
  } else {
    name = chromaticName(L, chroma, labHue);
  }

  const [idealLow, idealHigh] = CONFIG.idealCoverage;
  const coverage = seg.coverage;
  const coverageScore = coverage >= idealLow && coverage <= idealHigh
    ? 1
    : Math.max(0, 1 - Math.min(Math.abs(coverage - idealLow), Math.abs(coverage - idealHigh)) / 0.45);
  const purity = Math.max(0, Math.min(1, hueConcentration));
  let confidence = Math.max(0, Math.min(1,
    0.45 + 0.3 * coverageScore + 0.25 * purity,
  ));
  // A mask we had to guess at cannot support a confident colour.
  if (seg.method !== 'border-flood') confidence *= 0.7;

  return {
    color: name,
    multicolor,
    confidence: Number(confidence.toFixed(4)),
    method: seg.method,
    measured: {
      coverage: Number(coverage.toFixed(4)),
      blobs: seg.blobCount,
      pixels: idx.length,
      image: { width: w, height: h },
      lab: { L: round(L), a: round(A), b: round(B), chroma: round(chroma), hue: round(labHue) },
      // Reported for the record only. HSV is retained in the payload because it
      // is the convention most wardrobe UIs expect, but nothing in the naming
      // path reads it.
      hsv: {
        h: hsvWeight > 0 ? round(((Math.atan2(hsvY, hsvX) * 180) / Math.PI + 360) % 360) : null,
        s: round(sat),
        v: round(val),
      },
      lightnessSpread: round(lightnessSpread),
      chromatic: !!isChromatic,
    },
  };
}

function round(x) {
  return Number.isFinite(x) ? Number(x.toFixed(2)) : null;
}

module.exports = {
  analyzeColor,
  segment,
  erode,
  rgbToLab,
  rgbToHsv,
  // Exported so the segmentation steps can be unit-tested on their own.
  kmeans,
  blobs,
  keepLargeBlobs,
  regionSamples,
  floodGround,
  median,
  percentile,
  CONFIG,
  neutralName,
  chromaticName,
};