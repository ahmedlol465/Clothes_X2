#!/usr/bin/env node
/**
 * Deterministic local AI model setup for the SmartWardrobe backend.
 *
 * Downloads/verifies the EXACT models the Express runtime (:3001) loads, into
 * backend/.model-cache (the same directory the app reads at runtime):
 *
 *   1. Marqo/marqo-fashionCLIP        (ONNX q8 — clothing analysis, encoder.js)
 *   2. Xenova/all-MiniLM-L6-v2       (ONNX q8 — semantic retrieval, retrieval.js)
 *
 * How it works
 * ------------
 * It does not hand-roll a downloader. It requires the application's own loaders
 * (`src/clothing-vision/encoder.js` and `src/retrieval.js`) and lets them
 * resolve the models exactly as the server would. transformers.js:
 *   - leaves already-present files untouched (no re-download, no re-quantize)
 *   - downloads only what is missing, into `backend/.model-cache`
 *
 * So a teammate who already ran the app (or this script) gets a no-op, and an
 * incomplete cache is repaired rather than replaced. Nothing is ever deleted.
 *
 * This is purely a fetch-and-verify step: it writes nothing outside the model
 * cache, contains no API keys, touches no database, and does not modify models.
 *
 * Usage:
 *   npm run setup:models          # in backend/ (default)
 *   node scripts/setup-models.js
 *
 * Exit code 0 => every required file is present; 1 => setup incomplete.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BACKEND_ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(BACKEND_ROOT, '.model-cache');

/** Files the app actually loads. Keyed by cache-relative path. */
const REQUIRED = {
  'Marqo/marqo-fashionCLIP/config.json': null,
  'Marqo/marqo-fashionCLIP/tokenizer_config.json': null,
  'Marqo/marqo-fashionCLIP/preprocessor_config.json': null,
  'Marqo/marqo-fashionCLIP/tokenizer.json': 2224109,
  'Marqo/marqo-fashionCLIP/onnx/vision_model_quantized.onnx': 87301119,
  'Marqo/marqo-fashionCLIP/onnx/text_model_quantized.onnx': 64358586,
  'Xenova/all-MiniLM-L6-v2/config.json': null,
  'Xenova/all-MiniLM-L6-v2/tokenizer_config.json': null,
  'Xenova/all-MiniLM-L6-v2/tokenizer.json': 711661,
  'Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx': 22972370,
};

/** Optional extra artifacts the loaders may also need (fp32 source). */
const OPTIONAL = ['Xenova/all-MiniLM-L6-v2/onnx/model.onnx'];

function log(msg) {
  console.log(`[setup-models] ${msg}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function checkPrereqs() {
  const tf = path.join(BACKEND_ROOT, 'node_modules', '@huggingface', 'transformers');
  if (!fs.existsSync(tf)) {
    log('ERROR: @huggingface/transformers is not installed.');
    log(`  Run "npm install" in ${BACKEND_ROOT} first, then re-run this script.`);
    return false;
  }
  return true;
}

/**
 * Drive the app's own loaders so they fetch exactly what runtime needs into
 * backend/.model-cache. Both are lazy and idempotent; the cache dir is fixed
 * by the loaders themselves.
 */
async function fetch() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  log(`cache dir: ${CACHE_DIR}`);

  log('loading Marqo/marqo-fashionCLIP (clothing analysis)...');
  const encoder = require('../src/clothing-vision/encoder');
  if (!(await encoder.init())) {
    log(`ERROR: Marqo/marqo-fashionCLIP failed to load: ${encoder.status().error}`);
    return false;
  }
  await encoder.bank(); // also builds the ~1000-prompt text bank (needs text tower)

  log('loading Xenova/all-MiniLM-L6-v2 (semantic retrieval)...');
  const retrieval = require('../src/retrieval');
  const okMini = await retrieval.warmup();
  if (!okMini) {
    const rst = await retrieval.status();
    log(`ERROR: all-MiniLM-L6-v2 failed to load: ${rst.error}`);
    return false;
  }

  // Force one real embedding so we know the pipeline + tokenizer actually work.
  const probeItem = {
    id: '__setup_probe__', name: 'white t-shirt', color: 'White', category: 'Tops',
    style: 'Casual', material: 'Cotton', season: 'All Season', pattern: 'Plain',
  };
  const ranks = await retrieval.rank('a white t-shirt for a casual day', [probeItem], { limit: 1 });
  if (!Array.isArray(ranks)) {
    log('ERROR: MiniLM pipeline did not produce a ranking — setup incomplete.');
    return false;
  }

  return true;
}

function verify() {
  const missing = [];
  const wrong = [];

  for (const rel of Object.keys(REQUIRED)) {
    const full = path.join(CACHE_DIR, rel);
    if (!fs.existsSync(full)) {
      missing.push(rel);
      continue;
    }
    const size = fs.statSync(full).size;
    const expected = REQUIRED[rel];
    if (expected != null && size !== expected) {
      wrong.push(`${rel} (size ${size}, expected ${expected})`);
    }
  }

  const ok = missing.length === 0 && wrong.length === 0;

  log('verified files:');
  for (const rel of Object.keys(REQUIRED).concat(OPTIONAL)) {
    const full = path.join(CACHE_DIR, rel);
    const present = fs.existsSync(full);
    const line = present
      ? `${fs.statSync(full).size.toLocaleString()} B  ${sha256(full).slice(0, 12)}  ${rel}`
      : `-                      NOT PRESENT${OPTIONAL.includes(rel) ? ' (optional)' : ' (REQUIRED)'}  ${rel}`;
    log(`  ${present ? 'ok ' : '   '}${line}`);
  }

  if (missing.length) log(`missing: ${missing.join(', ')}`);
  if (wrong.length) log(`size mismatch: ${wrong.join(', ')}`);

  return ok;
}

(async () => {
  if (!checkPrereqs()) process.exit(1);

  const fetched = await fetch();
  if (!fetched) process.exit(1);

  process.exit(verify() ? 0 : 1);
})().catch((e) => {
  log(`unexpected error: ${e && e.message}`);
  process.exit(1);
});