/** 8.7 Shopping routes. */
'use strict';
const express = require('express');
const store = require('../data/store');
const ai = require('../services/ai-engine');
const { optionalAuth } = require('../middleware/auth');
const { now, db, persist } = require('../lib/context');

const router = express.Router();

// =============================================================== 8.7 Shopping
router.get('/shop/recommended', optionalAuth, (req, res) => {
  const gap = ai.wardrobeGap(db.wardrobe.filter((i) => !i.archived));
  const picks = db.products.map((p, i) => ({ ...p, reason: gap.gaps[i]?.reason || p.reason }));
  res.json({ picks, gaps: gap.gaps });
});

router.post('/shop/before-you-buy', optionalAuth, (req, res) => {
  const { productName = '', color = 'White', category = 'Tops' } = req.body || {};
  const probe = { id: 'probe', name: productName, color, category, style: 'Casual', season: 'All Season', formality: 'Casual' };
  const wardrobe = db.wardrobe.filter((i) => !i.archived);
  let best = null;
  for (const base of wardrobe.slice(0, 8)) {
    const compat = ai.calculateCompatibility([probe, base], { occasion: 'casual', weather: { tempC: 24 } });
    if (!best || compat.match > best.match) best = { with: base.name, ...compat };
  }
  res.json({ productName, verdict: (best?.match ?? 0) >= 82 ? 'Worth buying' : 'Skip for now', bestMatch: best });
});

router.get('/shop/wishlist', optionalAuth, (_req, res) => res.json({ wishlist: db.wishlist }));

router.post('/shop/wishlist', optionalAuth, (req, res) => {
  const entry = { id: store.uid('wl'), ...(req.body || {}), createdAt: now() };
  db.wishlist.push(entry);
  persist();
  res.status(201).json({ entry });
});

module.exports = router;
