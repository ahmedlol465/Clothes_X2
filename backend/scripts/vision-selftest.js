/**
 * Vision self-test (§9 AI PIPELINE).
 *
 * Runs the real pipeline over every bundled wardrobe photo plus the
 * non-clothing fixtures and prints the raw gate signals, so the separation
 * between "garment" and "not a garment" stays a measured property of this
 * repository instead of a claim in a comment.
 *
 *   npm run vision:selftest              # bundled assets + fixtures
 *   npm run vision:selftest -- a.jpg b.jpg
 *
 * Exits non-zero when a known non-clothing fixture is accepted as clothing, or
 * when the model could not be loaded at all.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const vision = require('../src/clothing-vision');
const encoder = require('../src/clothing-vision/encoder');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, '..', 'test', 'fixtures', 'non-clothing');

/** Files that are photos of something that is not a garment. */
const EXPECT_NON_CLOTHING = new Set([
  'bottle.jpg',
  'phone.jpg',
  'laptop.jpg',
  'chair.jpg',
  'mug.jpg',
  'tv_remote.jpg',
]);

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => path.join(dir, f));
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.length
    ? args.map((f) => (path.isAbsolute(f) ? f : path.resolve(f)))
    : [...listImages(FIXTURES), ...listImages(path.join(ROOT, 'assets', 'images'))];

  if (!files.length) {
    console.error('no images found to test');
    process.exit(2);
  }

  const t0 = Date.now();
  console.log('loading model + prompt bank...');
  const status = await encoder.status();
  if (!status.modelsReady) {
    console.error(`model failed to load: ${status.error}`);
    process.exit(2);
  }
  console.log(`model ${status.model} (${status.licence}, ${status.dtype})`);
  console.log(`prompt bank: ${status.promptBankSize} declared values`);
  console.log(`warm in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const header = [
    'image'.padEnd(34),
    'verdict'.padEnd(13),
    'subcat'.padEnd(14),
    'color'.padEnd(12),
    'margin'.padStart(8),
    'mass'.padStart(7),
    'conf'.padStart(6),
    '  notes',
  ];
  console.log(header.join(' '));
  console.log('-'.repeat(header.join(' ').length + 20));

  let failures = 0;
  let accepted = 0;
  let rejected = 0;

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.log(`${path.basename(file).padEnd(34)} MISSING`);
      failures += 1;
      continue;
    }
    const bytes = fs.readFileSync(file);
    const name = path.basename(file);
    const r = await vision.analyzeClothingImage(bytes, { filename: name });

    if (r.success) {
      accepted += 1;
      const gate = r.gate || {};
      const ev = r.evidence?.category || {};
      console.log([
        name.padEnd(34),
        'CLOTHING'.padEnd(13),
        String(r.subcategory).slice(0, 14).padEnd(14),
        String(r.color).slice(0, 12).padEnd(12),
        String(gate.margin ?? '').padStart(8),
        String(gate.clothingMass ?? '').padStart(7),
        String(r.confidence).padStart(6),
        ` runnerUp=${ev.runnerUp || '-'}${ev.tied ? ' TIED' : ''}${r.uncertainAttributes?.length ? ` uncertain=${r.uncertainAttributes.join('/')}` : ''} colorMethod=${r.colorDetail?.method}`,
      ].join(' '));
      if (EXPECT_NON_CLOTHING.has(name)) {
        console.log(`    !! ${name} is a fixture that must be REJECTED but was accepted`);
        failures += 1;
      }
    } else {
      rejected += 1;
      const rej = r.rejected || {};
      console.log([
        name.padEnd(34),
        `reject:${r.error_type}`.padEnd(13),
        String(rej.closestGarment || '-').slice(0, 14).padEnd(14),
        '-'.padEnd(12),
        String(rej.margin ?? '').padStart(8),
        String(rej.clothingMass ?? '').padStart(7),
        '-'.padStart(6),
        ` closest=${rej.closestNonClothing || '-'}`,
      ].join(' '));
    }
  }

  console.log(
    `\n${files.length} images: ${accepted} clothing, ${rejected} rejected, ${failures} failure(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});