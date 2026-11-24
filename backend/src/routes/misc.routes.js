/** Weather, health and docs routes. */
'use strict';
const express = require('express');
const { resolveWeather } = require('../lib/weather');

const router = express.Router();

router.get('/weather/current', async (req, res) => {
  res.json({ weather: await resolveWeather(req.query.city) });
});

router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'smartwardrobe-backend' }));

router.get('/docs', (_req, res) => res.json({
  service: 'SmartWardrobe API (§8)',
  endpoints: [
    'POST /auth/register', 'POST /auth/login', 'POST /auth/refresh', 'POST /auth/logout',
    'GET /users/me', 'PATCH /users/me', 'POST /users/me/avatar',
    'GET /users/me/style-profile', 'PATCH /users/me/style-profile',
    'GET /wardrobe/items', 'POST /wardrobe/items', 'POST /wardrobe/upload', 'GET /wardrobe/items/:id', 'PATCH /wardrobe/items/:id',
    'DELETE /wardrobe/items/:id', 'POST /wardrobe/items/batch-upload', 'GET /wardrobe/collections',
    'POST /ai/analyze-clothing', 'POST /ai/generate-outfit', 'POST /ai/calculate-compatibility',
    'POST /ai/style-profile', 'POST /ai/wardrobe-gap', 'POST /ai/packing-list',
    'POST /ai/wardrobe-assistant', 'POST /ai/shopping-assistant',
    'POST /ai/chat', 'POST /ai/chat/stream (SSE)', 'POST /ai/match-outfit',
    'POST /ai/remix', 'GET /ai/style-dna', 'GET /ai/preferences', 'PATCH /ai/preferences',
    'DELETE /ai/preferences/reset', 'POST /ai/preferences/avoid', 'DELETE /ai/preferences/avoid/:phrase',
    'GET /ai/conversations', 'DELETE /ai/conversations', 'GET /ai/capabilities',
    'GET /outfits/recommended', 'POST /outfits', 'GET /outfits/saved', 'GET /outfits/:id',
    'PATCH /outfits/:id', 'DELETE /outfits/:id', 'POST /outfits/:id/save', 'DELETE /outfits/:id/save',
    'POST /outfits/:id/favorite', 'POST /outfits/:id/feedback',
    'GET /events', 'POST /events', 'PATCH /events/:id', 'DELETE /events/:id',
    'GET /planner/weekly', 'POST /planner/weekly', 'POST /travel/packing-list',
    'GET /shop/recommended', 'POST /shop/before-you-buy', 'GET /shop/wishlist', 'POST /shop/wishlist',
    'GET /admin/dashboard', 'GET /admin/users', 'GET /admin/ai-performance', 'GET /admin/reports', 'GET /admin/system-health',
    'GET /weather/current', 'GET /health', 'GET /docs',
  ],
}));

module.exports = router;
