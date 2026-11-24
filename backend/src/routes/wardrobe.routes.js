/** 8.3 Wardrobe routes. */
'use strict';
const express = require('express');
const store = require('../data/store');
const ai = require('../services/ai-engine');
const { optionalAuth } = require('../middleware/auth');
const { now, db, persist } = require('../lib/context');
const { upload, storageUrl, readStoredImage } = require('../lib/storage');
const { CATEGORIES } = require('../lib/stylist');

const router = express.Router();

/**
 * POST /wardrobe/upload — multipart `photos[]` (up to 10 images, 10MB each).
 * Returns [{ url, filename, mime, size }] for the Add Clothes flow.
 */
router.post('/wardrobe/upload', optionalAuth, (req, res) => {
  upload.array('photos', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Attach at least one image as photos[].' });
    }
    res.status(201).json({
      files: req.files.map((f) => ({
        url: storageUrl(req, f.filename),
        filename: f.originalname || f.filename,
        storedAs: f.filename,
        mime: f.mimetype,
        size: f.size,
      })),
    });
  });
});

router.get('/wardrobe/items', optionalAuth, (req, res) => {
  const { search = '', category = 'All', sort = 'recent' } = req.query;
  const q = String(search).toLowerCase();
  let items = db.wardrobe.filter((i) => !i.archived);
  if (category && category !== 'All') items = items.filter((i) => i.category === category);
  if (q) {
    items = items.filter((i) =>
      [i.name, i.color, i.style, i.category, i.material].join(' ').toLowerCase().includes(q),
    );
  }
  if (sort === 'worn') items = [...items].sort((a, b) => (b.timesWorn || 0) - (a.timesWorn || 0));
  res.json({ items, total: items.length, categories: ['All', ...CATEGORIES] });
});

router.post('/wardrobe/items', optionalAuth, async (req, res) => {
  const b = req.body || {};

  // When the client uploads an image and does not hand us tags, analyse it here
  // so the saved row is a real measurement rather than a "Tops / White / Cotton"
  // default that looks identical for every item in the wardrobe.
  let analysis = b.analysis || null;
  let derived = {};
  {
    // Always analyse when the bytes are here, even if the user already tagged
    // the item: the analysis is what records *how* each value was reached and
    // whether the model agreed. Skipping it would leave a user-tagged row with
    // no provenance at all, and would mean a bottle added as an "Accessories"
    // belt-looking object is stored with no warning attached.
    const bytes = ai.imageBytesFor(b) || readStoredImage(b.imageUrl || b.image);
    if (bytes) {
      const r = await ai.analyzeClothing({
        filename: b.filename,
        bytes,
        // Everything the caller set explicitly is treated as an override, so
        // `userAdjusted` records what the human changed rather than what the
        // model happened to agree with.
        ...(b.name ? { name: b.name } : {}),
        ...(b.category ? { category: b.category } : {}),
        ...(b.color ? { color: b.color } : {}),
        ...(b.style ? { style: b.style } : {}),
        ...(b.pattern ? { pattern: b.pattern } : {}),
        ...(b.material ? { material: b.material } : {}),
        ...(b.season ? { season: b.season } : {}),
        ...(b.formality ? { formality: b.formality } : {}),
      }).catch((e) => {
        console.error('[wardrobe] analysis failed:', e.message);
        return null;
      });
      if (r) {
        analysis = r;
        // A rejection is not fatal here: the user may be deliberately filing an
        // odd item. The row is created, flagged, so the detail screen can
        // explain why nothing was detected.
        if (r.success !== false) {
          derived = {
            category: b.category || r.category,
            color: b.color || r.color,
            style: b.style || r.style,
            pattern: b.pattern || r.pattern,
            material: b.material || r.material,
            season: b.season || r.season,
            formality: b.formality || r.formality,
            name: b.name || r.suggestedName,
          };
        }
      }
    }
  }

  const name = b.name || derived.name;
  if (!name) return res.status(400).json({ error: 'name is required.' });

  const item = {
    id: store.uid('w'), name,
    image: b.image || 'assets/images/item_tee_white.jpg',
    category: derived.category || b.category || 'Tops',
    color: derived.color || b.color || 'White',
    style: derived.style || b.style || 'Casual',
    material: derived.material || b.material || 'Cotton',
    season: derived.season || b.season || 'All Season',
    formality: derived.formality || b.formality || 'Casual',
    pattern: derived.pattern || b.pattern || 'Plain',
    brand: b.brand || '',
    timesWorn: 0, lastWornLabel: 'Just added', createdAt: now(),
    // Analysis provenance, so the detail screen can show how each field was
    // decided and which ones the model was unsure about.
    analysis: analysis || null,
    analysisSource: analysis ? (analysis.source || (analysis.success === false ? analysis.error_type : 'clothing-vision')) : null,
    // Set when the pipeline looked at the image and refused it. The item is
    // still stored (the user may know better than the model) but the UI has to
    // say so instead of silently showing default tags.
    analysisRejected: analysis && analysis.success === false
      ? { error_type: analysis.error_type, error: analysis.error, closest: analysis.rejected?.closestNonClothing ?? null }
      : null,
    analysisConfidence: Number.isFinite(analysis?.confidence) ? analysis.confidence : null,
    confidenceKind: analysis?.confidenceKind || null,
    agreement: Number.isFinite(analysis?.agreement) ? analysis.agreement : null,
    uncertainAttributes: analysis?.uncertainAttributes || [],
    colorDetail: analysis?.colorDetail || null,
    analysisModel: analysis?.model || null,
    analyzedAt: analysis?.analyzedAt || null,
  };
  db.wardrobe.unshift(item);
  persist();
  res.status(201).json({ item });
});

router.get('/wardrobe/items/:id', optionalAuth, (req, res) => {
  const item = db.wardrobe.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  res.json({ item });
});

router.patch('/wardrobe/items/:id', optionalAuth, (req, res) => {
  const item = db.wardrobe.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  Object.assign(item, req.body || {});
  persist();
  res.json({ item });
});

router.delete('/wardrobe/items/:id', optionalAuth, (req, res) => {
  const item = db.wardrobe.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  item.archived = true; // soft delete keeps outfit history intact
  persist();
  res.json({ ok: true });
});

router.post('/wardrobe/items/batch-upload', optionalAuth, (req, res) => {
  const { items = [] } = req.body || {};
  const created = items.map((b) => ({
    id: store.uid('w'), name: b.name || 'Imported piece',
    image: b.image || 'assets/images/item_tee_white.jpg',
    category: b.category || 'Tops', color: b.color || 'White', style: b.style || 'Casual',
    material: b.material || 'Cotton', season: b.season || 'All Season',
    formality: b.formality || 'Casual', pattern: b.pattern || 'Plain', brand: b.brand || '',
    timesWorn: 0, lastWornLabel: 'Just added', createdAt: now(),
  }));
  db.wardrobe.unshift(...created);
  persist();
  res.status(201).json({ items: created, total: created.length });
});

router.get('/wardrobe/collections', optionalAuth, (req, res) => {
  const byCategory = {};
  for (const i of db.wardrobe.filter((x) => !x.archived)) {
    (byCategory[i.category] = byCategory[i.category] || []).push(i);
  }
  res.json({ collections: Object.entries(byCategory).map(([name, items]) => ({ name, count: items.length })) });
});

module.exports = router;
