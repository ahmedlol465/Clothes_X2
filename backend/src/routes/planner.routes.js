/** 8.6 Planner (events, weekly plan, travel) routes. */
'use strict';
const express = require('express');
const store = require('../data/store');
const ai = require('../services/ai-engine');
const { optionalAuth } = require('../middleware/auth');
const { db, persist } = require('../lib/context');
const { resolveWeather } = require('../lib/weather');

const router = express.Router();

// ================================================================ 8.6 Planner
router.get('/events', optionalAuth, (_req, res) => res.json({ events: db.events }));

router.post('/events', optionalAuth, (req, res) => {
  const event = { id: store.uid('e'), outfitId: null, ...(req.body || {}) };
  db.events.push(event);
  persist();
  res.status(201).json({ event });
});

router.patch('/events/:id', optionalAuth, (req, res) => {
  const event = db.events.find((e) => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  Object.assign(event, req.body || {});
  persist();
  res.json({ event });
});

router.delete('/events/:id', optionalAuth, (req, res) => {
  db.events = db.events.filter((e) => e.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

router.get('/planner/weekly', optionalAuth, (req, res) => res.json({ week: db.weeklyPlan }));

router.post('/planner/weekly', optionalAuth, async (req, res) => {
  // Regenerate the week from the real wardrobe + weather (planner agent).
  const { occasion = 'casual' } = req.body || {};
  const gens = ai.generateOutfits(db.wardrobe.filter((i) => !i.archived), {
    occasion, weather: await resolveWeather(), styleProfile: req.user?.styleProfile || {}, count: 7,
  });
  db.weeklyPlan = db.weeklyPlan.map((day, i) => ({
    ...day,
    outfitName: gens[i % Math.max(1, gens.length)]?.name || day.outfitName,
    outfitId: gens[i % Math.max(1, gens.length)]?.id || day.outfitId,
  }));
  persist();
  res.json({ week: db.weeklyPlan });
});

router.post('/travel/packing-list', optionalAuth, (req, res) => {
  res.json(ai.packingList(db.wardrobe.filter((i) => !i.archived), req.body || {}));
});

module.exports = router;
