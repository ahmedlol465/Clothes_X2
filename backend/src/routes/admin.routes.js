/** 8.8 Admin routes. */
'use strict';
const store = require('../data/store');
const { adminOnly } = require('../middleware/auth');
const express = require('express');
const llm = require('../services/llm');
const scoring = require('../services/scoring');
const retrieval = require('../services/retrieval');
const { publicUser } = require('../lib/users');
const { groupBy, AI_SERVICE_URL, db } = require('../lib/context');

const router = express.Router();

// ================================================================= 8.8 Admin
router.get('/admin/dashboard', adminOnly, (req, res) => {
  res.json({
    users: db.users.length,
    wardrobeItems: db.wardrobe.filter((i) => !i.archived).length,
    outfits: db.outfits.length,
    events: db.events.length,
    feedbackCount: db.feedback.length,
    aiCalls: db.aiUsage.length,
  });
});

router.get('/admin/users', adminOnly, (_req, res) => res.json({ users: db.users.map(publicUser) }));

router.get('/admin/ai-performance', adminOnly, (_req, res) => {
  const calls = db.aiUsage.length;
  const avgMs = calls ? Math.round(db.aiUsage.reduce((a, u) => a + (u.ms || 0), 0) / calls) : 0;
  const tokens = db.aiUsage.reduce(
    (a, u) => ({
      prompt: a.prompt + (u.tokens?.prompt || 0),
      completion: a.completion + (u.tokens?.completion || 0),
    }),
    { prompt: 0, completion: 0 },
  );
  res.json({ totalCalls: calls, avgLatencyMs: avgMs, byEndpoint: groupBy(db.aiUsage, 'endpoint'), tokens, llm: llm.status() });
});

router.get('/admin/reports', adminOnly, (_req, res) => res.json({ feedback: db.feedback.slice(-50) }));

router.get('/admin/system-health', adminOnly, async (_req, res) => res.json({
  status: 'ok', uptimeSec: Math.round(process.uptime()),
  aiService: AI_SERVICE_URL || 'embedded',
  llm: llm.status(),
  embeddings: await retrieval.status(),
  weather: {
    provider: 'open-meteo',
    keyless: true,
    keyConfigured: !!process.env.WEATHER_KEY,
    cached: process.env.WEATHER_CITY || 'Cairo',
  },
  modules: {
    scoring: '11-factor + completeness gate',
    learning: 'style-memory (per-attribute, confidence weighted)',
    retrieval: 'two-stage, category balanced',
  },
  database: store.driver === 'mysql' ? { driver: 'mysql', host: process.env.DB_HOST || '127.0.0.1', name: process.env.DB_NAME || 'smartwardrobe' } : { driver: 'json', file: 'backend/data/db.json' },
  dbFile: store.driver === 'mysql' ? null : 'backend/data/db.json',
}));

module.exports = router;
