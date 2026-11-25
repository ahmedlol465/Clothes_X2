/**
 * Vision accuracy report. Reads test/eval/labels.csv, runs the real analysis on
 * each image and prints accuracy per task with counts, a confusion matrix for
 * category and gender, and the list of every miss. Writes test/eval/report.json.
 *
 *   npm run vision:eval
 *   npm run vision:eval -- path/to/labels.csv
 *
 * Numbers are measured on the labelled set only. They do not predict accuracy
 * on other photos unless the set looks like real user photos.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vision = require('../src/clothing-vision');

const EVAL_DIR = path.join(__dirname, '..', 'test', 'eval');
const ASSETS = path.join(__dirname, '..', '..', 'assets', 'images');
const FIXTURES = path.join(__dirname, '..', 'test', 'fixtures', 'non-clothing');

function resolve(f) {
  if (f.startsWith('asset:')) return { p: path.join(ASSETS, f.slice(6)), seen: true };
  if (f.startsWith('fixture:')) return { p: path.join(FIXTURES, f.slice(8)), seen: true };
  if (path.isAbsolute(f)) return { p: f, seen: false };
  return { p: path.join(EVAL_DIR, f), seen: false };
}
const norm = (v) => String(v || '').trim().toLowerCase();
// Truth may list alternatives with | (e.g. Tops|Outerwear for a jacket-or-top).
const same = (truth, pred) => String(truth).split('|').some((t) => norm(t) === norm(pred));

function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
const fmt = (k, n) => {
  if (!n) return 'n/a (0 labelled)';
  const [lo, hi] = wilson(k, n);
  return `${((100 * k) / n).toFixed(1)}% (${k}/${n}, 95% range ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%)`;
};

async function main() {
  const csv = process.argv[2] || path.join(EVAL_DIR, 'labels.csv');
  const lines = fs.readFileSync(csv, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const head = lines.shift().split(',').map((s) => s.trim());
  const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], (v || '').trim()])));

  const groups = { seen: mk(), heldout: mk() };
  function mk() {
    return { gate: [0, 0], category: [0, 0], slot: [0, 0], gender: [0, 0], color: [0, 0], pattern: [0, 0], fpClothing: 0, missedClothing: 0 };
  }
  const conf = { category: {}, slot: {}, gender: {} };
  const misses = [];

  for (const r of rows) {
    const { p, seen } = resolve(r.file);
    if (!fs.existsSync(p)) { console.log(`MISSING ${r.file}`); continue; }
    const g = groups[seen ? 'seen' : 'heldout'];
    const res = await vision.analyzeClothingImage(fs.readFileSync(p), { filename: r.file });
    const truthClothing = norm(r.is_clothing) === 'yes';
    const predClothing = !!res.success;
    g.gate[1]++;
    if (truthClothing === predClothing) g.gate[0]++;
    else {
      misses.push(`${r.file}: gate expected ${truthClothing ? 'clothing' : 'non-clothing'}, got ${predClothing ? 'clothing' : 'non-clothing'}`);
      if (truthClothing) g.missedClothing++; else g.fpClothing++;
    }
    if (!truthClothing || !predClothing) continue;
    for (const [key, col, field] of [['category', 'subcategory', 'subcategory'], ['slot', 'category', 'category'], ['gender', 'gender', 'gender'], ['color', 'color', 'color'], ['pattern', 'pattern', 'pattern']]) {
      if (!r[col]) continue;
      const truth = r[col];
      const pred = res[field];
      g[key][1]++;
      if (same(truth, pred)) g[key][0]++;
      else misses.push(`${r.file}: ${key} expected ${truth}, got ${pred}`);
      if (conf[key]) {
        conf[key][truth] = conf[key][truth] || {};
        conf[key][truth][pred] = (conf[key][truth][pred] || 0) + 1;
      }
    }
  }

  const out = {};
  for (const [name, g] of Object.entries(groups)) {
    console.log(`\n== ${name === 'seen' ? 'BUNDLED images (model/gate tuned on these: do not quote)' : 'HELD-OUT images (quote these)'} ==`);
    console.log(`clothing vs non-clothing: ${fmt(...g.gate)}  (non-clothing wrongly accepted: ${g.fpClothing}, clothing wrongly rejected: ${g.missedClothing})`);
    console.log(`category (exact garment type): ${fmt(...g.category)}`);
    console.log(`slot (Tops/Bottoms/Shoes/Accessories): ${fmt(...g.slot)}`);
    console.log(`gender:    ${fmt(...g.gender)}`);
    console.log(`colour:    ${fmt(...g.color)}`);
    console.log(`pattern:   ${fmt(...g.pattern)}`);
    out[name] = g;
  }
  for (const k of Object.keys(conf)) {
    console.log(`\nConfusion (${k}): rows=truth, cols=predicted`);
    for (const [t, ps] of Object.entries(conf[k])) console.log(`  ${t}: ${JSON.stringify(ps)}`);
  }
  console.log(`\nMisses (${misses.length}):`);
  misses.forEach((m) => console.log('  ' + m));
  fs.writeFileSync(path.join(EVAL_DIR, 'report.json'), JSON.stringify({ at: new Date().toISOString(), out, conf, misses }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
