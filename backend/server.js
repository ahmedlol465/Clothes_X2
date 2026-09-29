/**
 * SmartWardrobe main backend — NestJS-style modular REST API.
 *
 * Sections map to the spec (§8 API Overview):
 *   8.1 Auth · 8.2 Users · 8.3 Wardrobe · 8.4 AI · 8.5 Outfits
 *   8.6 Planner · 8.7 Shopping · 8.8 Admin
 *
 * Run:  npm install && npm start   →  http://localhost:3000
 * Docs: GET /docs  (endpoint index) · GET /health
 */
'use strict';
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const store = require('./src/store');
const ai = require('./src/ai-engine');
const llm = require('./src/llm');

const PORT = process.env.PORT || 3001;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || ''; // e.g. http://localhost:8000

let db = store.load();
const persist = () => store.save(db);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ------------------------------------------------------------------ helpers
function auth(req, res, next) {
  // Demo-grade bearer auth (swap for @nestjs/jwt + passport-jwt in prod).
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token. POST /auth/login first.' });
  const session = db.sessions.find((s) => s.token === token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired token.' });
  req.user = db.users.find((u) => u.id === session.userId);
  if (!req.user) return res.status(401).json({ error: 'User not found.' });
  next();
}
const optionalAuth = (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token && db.sessions.find((s) => s.token === token);
  req.user = (session && db.users.find((u) => u.id === session.userId)) || db.users[0] || null;
  next();
};
function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}
async function proxyAI(path, body) {
  // If a FastAPI AI service is configured, delegate; else use embedded engine.
  if (!AI_SERVICE_URL) return null;
  const res = await fetch(`${AI_SERVICE_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}
function trackAi(endpoint, ms, extra = {}) {
  db.aiUsage.push({ endpoint, ms, at: new Date().toISOString(), ...extra });
  if (db.aiUsage.length > 500) db.aiUsage = db.aiUsage.slice(-500);
  persist();
}
const now = () => new Date().toISOString();

// ================================================================== 8.1 Auth
app.post('/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required.' });
  if (db.users.some((u) => u.email === String(email).toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered.' });
  }
  const user = {
    id: store.uid('u'), name: name || email.split('@')[0], email: String(email).toLowerCase(),
    passwordHash: store.sha256(password), createdAt: now(),
    styleProfile: { preferredStyles: ['Casual'], favoriteColors: ['Black', 'White'], sizes: {} },
  };
  const token = crypto.randomBytes(24).toString('hex');
  db.users.push(user);
  db.sessions.push({ token, userId: user.id, createdAt: now() });
  persist();
  res.status(201).json({ user: publicUser(user), accessToken: token, refreshToken: token });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find((u) => u.email === String(email || '').toLowerCase());
  if (!user || user.passwordHash !== store.sha256(password || '')) {
    return res.status(401).json({ error: 'Invalid email or password. Demo: karim@fashiontech.com / wardrobe2024' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions.push({ token, userId: user.id, createdAt: now() });
  persist();
  res.json({ user: publicUser(user), accessToken: token, refreshToken: token });
});

app.post('/auth/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  const session = db.sessions.find((s) => s.token === refreshToken);
  if (!session) return res.status(401).json({ error: 'Invalid refresh token.' });
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions.push({ token, userId: session.userId, createdAt: now() });
  persist();
  res.json({ accessToken: token, refreshToken: token });
});

app.post('/auth/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').slice(7);
  db.sessions = db.sessions.filter((s) => s.token !== token);
  persist();
  res.json({ ok: true });
});

// ================================================================= 8.2 Users
app.get('/users/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.patch('/users/me', auth, (req, res) => {
  Object.assign(req.user, req.body || {});
  persist();
  res.json({ user: publicUser(req.user) });
});
app.get('/users/me/style-profile', auth, (req, res) => res.json({ styleProfile: req.user.styleProfile || {} }));
app.patch('/users/me/style-profile', auth, (req, res) => {
  req.user.styleProfile = { ...(req.user.styleProfile || {}), ...(req.body || {}) };
  persist();
  res.json({ styleProfile: req.user.styleProfile });
});

// ============================================================== 8.3 Wardrobe
const CATEGORIES = ['Tops', 'Bottoms', 'Shoes', 'Outerwear', 'Accessories'];

app.get('/wardrobe/items', optionalAuth, (req, res) => {
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

app.post('/wardrobe/items', optionalAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required.' });
  const item = {
    id: store.uid('w'), name: b.name,
    image: b.image || 'assets/images/item_tee_white.jpg',
    category: b.category || 'Tops', color: b.color || 'White', style: b.style || 'Casual',
    material: b.material || 'Cotton', season: b.season || 'All Season',
    formality: b.formality || 'Casual', pattern: b.pattern || 'Plain', brand: b.brand || '',
    timesWorn: 0, lastWornLabel: 'Just added', createdAt: now(),
  };
  db.wardrobe.unshift(item);
  persist();
  res.status(201).json({ item });
});

app.get('/wardrobe/items/:id', optionalAuth, (req, res) => {
  const item = db.wardrobe.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  res.json({ item });
});

app.patch('/wardrobe/items/:id', optionalAuth, (req, res) => {
  const item = db.wardrobe.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  Object.assign(item, req.body || {});
  persist();
  res.json({ item });
});

app.delete('/wardrobe/items/:id', optionalAuth, (req, res) => {
  const item = db.wardrobe.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  item.archived = true; // soft delete keeps outfit history intact
  persist();
  res.json({ ok: true });
});

app.post('/wardrobe/items/batch-upload', optionalAuth, (req, res) => {
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

app.get('/wardrobe/collections', optionalAuth, (req, res) => {
  const byCategory = {};
  for (const i of db.wardrobe.filter((x) => !x.archived)) {
    (byCategory[i.category] = byCategory[i.category] || []).push(i);
  }
  res.json({ collections: Object.entries(byCategory).map(([name, items]) => ({ name, count: items.length })) });
});

// =================================================================== 8.4 AI
app.post('/ai/analyze-clothing', optionalAuth, async (req, res) => {
  const t0 = Date.now();
  const remote = await proxyAI('/analyze-clothing', req.body).catch(() => null);
  const base = remote || ai.analyzeClothing(req.body || {});
  // Gemini vision when a photo is supplied + a free key is configured.
  const dataUrl =
    req.body?.dataUrl || req.body?.imageUrl ||
    (req.body?.imageBase64
      ? `data:${req.body.mime || 'image/jpeg'};base64,${req.body.imageBase64}`
      : null);
  let source = 'heuristic';
  let tokens;
  if (dataUrl && llm.status().configured) {
    try {
      const vision = await llm.analyzeImage({
        dataUrl,
        hint: req.body?.filename || req.body?.name || '',
      });
      Object.assign(base, vision.attrs);
      if (vision.attrs.confidence != null) base.confidence = vision.attrs.confidence;
      source = llm.status().provider + '-vision';
      tokens = vision.tokens;
    } catch (e) {
      console.error('[ai] vision failed, heuristic fallback:', e.message);
    }
  }
  trackAi('analyze-clothing', Date.now() - t0, { source, tokens });
  res.json({ analysis: base, source });
});

app.post('/ai/generate-outfit', optionalAuth, async (req, res) => {
  const t0 = Date.now();
  const body = req.body || {};
  const remote = await proxyAI('/generate-outfit', { ...body, wardrobe: db.wardrobe }).catch(() => null);
  const outfits = remote?.outfits || ai.generateOutfits(db.wardrobe.filter((i) => !i.archived), {
    occasion: body.occasion || 'casual', weather: body.weather || { tempC: 24, condition: 'partly cloudy' },
    styleProfile: (req.user && req.user.styleProfile) || {}, count: body.count || 3,
    anchorItemId: body.anchorItemId, excludeIds: body.excludeIds || [],
  });
  trackAi('generate-outfit', Date.now() - t0);
  res.json({ outfits });
});

app.post('/ai/calculate-compatibility', optionalAuth, async (req, res) => {
  const t0 = Date.now();
  const { itemIds = [], occasion = 'casual', weather = { tempC: 24 } } = req.body || {};
  const items = itemIds.map((id) => db.wardrobe.find((i) => i.id === id)).filter(Boolean);
  if (items.length < 2) return res.status(400).json({ error: 'Provide at least 2 itemIds.' });
  const result = ai.calculateCompatibility(items, { occasion, weather, styleProfile: req.user?.styleProfile });
  trackAi('calculate-compatibility', Date.now() - t0);
  res.json(result);
});

app.post('/ai/style-profile', optionalAuth, (req, res) => {
  res.json({ styleProfile: ai.styleProfileFromWardrobe(db.wardrobe.filter((i) => !i.archived), db.feedback) });
});

app.post('/ai/wardrobe-gap', optionalAuth, (req, res) => {
  res.json(ai.wardrobeGap(db.wardrobe.filter((i) => !i.archived)));
});

app.post('/ai/packing-list', optionalAuth, (req, res) => {
  res.json(ai.packingList(db.wardrobe.filter((i) => !i.archived), req.body || {}));
});

app.post('/ai/chat', optionalAuth, async (req, res) => {
  const t0 = Date.now();
  const { message = '', history = [] } = req.body || {};
  if (!String(message).trim()) return res.status(400).json({ error: 'message is required.' });
  const weather = await resolveWeather();
  const wardrobe = db.wardrobe.filter((i) => !i.archived);
  const remote = await proxyAI('/chat', { message, wardrobe, weather }).catch(() => null);
  let reply, outfit = null, source = 'rules';
  if (remote) {
    reply = remote.text || remote.reply;
    outfit = remote.outfit || null;
    source = 'fastapi';
  } else if (llm.status().configured) {
    // Gemini (or other free provider): grounded on real catalog ids.
    try {
      const gen = await llm.stylistChat({
        message, wardrobe, weather, styleProfile: req.user?.styleProfile || {},
      });
      const ids = [...new Set(gen.itemIds || [])]
        .map((id) => wardrobe.find((w) => w.id === id))
        .filter(Boolean)
        .slice(0, 4);
      if (ids.length >= 2) {
        const compat = ai.calculateCompatibility(ids, {
          occasion: message, weather, styleProfile: req.user?.styleProfile,
        });
        outfit = {
          id: `llm-${Date.now()}`,
          name: ai.outfitName(ids, message),
          occasion: 'AI pick',
          match: compat.match,
          breakdown: compat.breakdown,
          explanation: ai.explainOutfit(ids, { occasion: message, weather }, compat),
          itemIds: ids.map((p) => p.id),
          pieces: ids.map((p) => p.name),
          items: ids,
          image: ids[0].image,
        };
      }
      reply = gen.text;
      source = llm.status().provider;
      trackAi('chat', Date.now() - t0, { source, tokens: gen.tokens });
    } catch (e) {
      console.error('[ai] chat failed, rules fallback:', e.message);
    }
  }
  if (!reply) {
    const fallback = ai.chatReply(message, {
      wardrobe, weather, styleProfile: req.user?.styleProfile || {},
    });
    reply = fallback.text;
    outfit = fallback.outfit;
  }
  db.conversations.push({ at: now(), message, reply });
  if (source === 'rules' || source === 'fastapi') {
    trackAi('chat', Date.now() - t0, { source });
  }
  res.json({ reply, outfit, weather, source });
});

// ================================================================ 8.5 Outfits
app.get('/outfits/recommended', optionalAuth, (req, res) => {
  const { occasion = 'casual', tempC = '24', count = '3' } = req.query;
  const weather = { tempC: Number(tempC), condition: Number(tempC) >= 26 ? 'sunny' : 'partly cloudy' };
  const outfits = ai.generateOutfits(db.wardrobe.filter((i) => !i.archived), {
    occasion, weather, styleProfile: req.user?.styleProfile || {}, count: Number(count),
  });
  res.json({ outfits, weather, occasion });
});

app.post('/outfits', optionalAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.itemIds?.length) return res.status(400).json({ error: 'name and itemIds are required.' });
  const items = b.itemIds.map((id) => db.wardrobe.find((i) => i.id === id)).filter(Boolean);
  const compat = ai.calculateCompatibility(items.length >= 2 ? items : db.wardrobe.slice(0, 3), {
    occasion: b.occasion || 'casual', weather: { tempC: 24 }, styleProfile: req.user?.styleProfile,
  });
  const outfit = {
    id: store.uid('o'), name: b.name, occasion: b.occasion || 'Casual',
    image: b.image || items[0]?.image || 'assets/images/outfit_flatlay_beige.jpg',
    match: compat.match, breakdown: compat.breakdown,
    pieces: items.map((i) => i.name), itemIds: items.map((i) => i.id),
    favorite: false, createdAt: now(),
  };
  db.outfits.unshift(outfit);
  persist();
  res.status(201).json({ outfit });
});

app.get('/outfits/:id', optionalAuth, (req, res) => {
  const outfit = db.outfits.find((o) => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ error: 'Outfit not found.' });
  res.json({ outfit });
});

app.patch('/outfits/:id', optionalAuth, (req, res) => {
  const outfit = db.outfits.find((o) => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ error: 'Outfit not found.' });
  Object.assign(outfit, req.body || {});
  persist();
  res.json({ outfit });
});

app.delete('/outfits/:id', optionalAuth, (req, res) => {
  db.outfits = db.outfits.filter((o) => o.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

app.post('/outfits/:id/favorite', optionalAuth, (req, res) => {
  const outfit = db.outfits.find((o) => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ error: 'Outfit not found.' });
  outfit.favorite = !outfit.favorite;
  persist();
  res.json({ outfit });
});

app.post('/outfits/:id/feedback', optionalAuth, (req, res) => {
  const { rating = 5, comment = '' } = req.body || {};
  db.feedback.push({ outfitId: req.params.id, rating, comment, at: now() });
  // Learning loop (§9): nudge StyleMemory confidence from explicit ratings.
  const mem = db.styleMemory.find((m) => m.preference === 'neutral_colors');
  if (mem) mem.confidence = Math.min(0.99, mem.confidence + (rating >= 4 ? 0.01 : -0.01));
  persist();
  res.json({ ok: true });
});

app.get('/outfits', optionalAuth, (req, res) => {
  const { favorite } = req.query;
  let outfits = db.outfits;
  if (favorite === 'true') outfits = outfits.filter((o) => o.favorite);
  res.json({ outfits });
});

// ================================================================ 8.6 Planner
app.get('/events', optionalAuth, (_req, res) => res.json({ events: db.events }));
app.post('/events', optionalAuth, (req, res) => {
  const event = { id: store.uid('e'), outfitId: null, ...(req.body || {}) };
  db.events.push(event);
  persist();
  res.status(201).json({ event });
});
app.patch('/events/:id', optionalAuth, (req, res) => {
  const event = db.events.find((e) => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  Object.assign(event, req.body || {});
  persist();
  res.json({ event });
});
app.delete('/events/:id', optionalAuth, (req, res) => {
  db.events = db.events.filter((e) => e.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

app.get('/planner/weekly', optionalAuth, (req, res) => res.json({ week: db.weeklyPlan }));
app.post('/planner/weekly', optionalAuth, async (req, res) => {
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

app.post('/travel/packing-list', optionalAuth, (req, res) => {
  res.json(ai.packingList(db.wardrobe.filter((i) => !i.archived), req.body || {}));
});

// =============================================================== 8.7 Shopping
app.get('/shop/recommended', optionalAuth, (req, res) => {
  const gap = ai.wardrobeGap(db.wardrobe.filter((i) => !i.archived));
  const picks = db.products.map((p, i) => ({ ...p, reason: gap.gaps[i]?.reason || p.reason }));
  res.json({ picks, gaps: gap.gaps });
});
app.post('/shop/before-you-buy', optionalAuth, (req, res) => {
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
app.get('/shop/wishlist', optionalAuth, (_req, res) => res.json({ wishlist: db.wishlist }));
app.post('/shop/wishlist', optionalAuth, (req, res) => {
  const entry = { id: store.uid('wl'), ...(req.body || {}), createdAt: now() };
  db.wishlist.push(entry);
  persist();
  res.status(201).json({ entry });
});

// ================================================================= 8.8 Admin
app.get('/admin/dashboard', (req, res) => {
  res.json({
    users: db.users.length,
    wardrobeItems: db.wardrobe.filter((i) => !i.archived).length,
    outfits: db.outfits.length,
    events: db.events.length,
    feedbackCount: db.feedback.length,
    aiCalls: db.aiUsage.length,
  });
});
app.get('/admin/users', (_req, res) => res.json({ users: db.users.map(publicUser) }));
app.get('/admin/ai-performance', (_req, res) => {
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
app.get('/admin/reports', (_req, res) => res.json({ feedback: db.feedback.slice(-50) }));
app.get('/admin/system-health', (_req, res) => res.json({
  status: 'ok', uptimeSec: Math.round(process.uptime()),
  aiService: AI_SERVICE_URL || 'embedded',
  llm: llm.status(),
  weather: process.env.WEATHER_KEY ? 'live (openweathermap)' : 'stub',
  dbFile: 'backend/data/db.json',
}));

// ------------------------------------------------------- weather + misc
function currentWeather() {
  // Stub for OpenWeatherMap integration (§6.5): deterministic demo weather
  // so outfit scoring is stable. Set WEATHER_KEY for live data.
  return { tempC: 28, condition: 'sunny', city: 'Cairo', summary: 'Sunny • 28°C' };
}

/** Live OpenWeatherMap when WEATHER_KEY is set, else the stub above. */
async function resolveWeather(city) {
  try {
    const live = await llm.liveWeather(city);
    if (live) return live;
  } catch (e) {
    console.error('[weather] live failed, stub fallback:', e.message);
  }
  const stub = currentWeather();
  if (city) stub.city = city;
  return stub;
}

app.get('/weather/current', async (req, res) => {
  res.json({ weather: await resolveWeather(req.query.city) });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'smartwardrobe-backend' }));
app.get('/docs', (_req, res) => res.json({
  service: 'SmartWardrobe API (§8)',
  endpoints: [
    'POST /auth/register', 'POST /auth/login', 'POST /auth/refresh', 'POST /auth/logout',
    'GET /users/me', 'PATCH /users/me', 'GET /users/me/style-profile', 'PATCH /users/me/style-profile',
    'GET /wardrobe/items', 'POST /wardrobe/items', 'GET /wardrobe/items/:id', 'PATCH /wardrobe/items/:id',
    'DELETE /wardrobe/items/:id', 'POST /wardrobe/items/batch-upload', 'GET /wardrobe/collections',
    'POST /ai/analyze-clothing', 'POST /ai/generate-outfit', 'POST /ai/calculate-compatibility',
    'POST /ai/style-profile', 'POST /ai/wardrobe-gap', 'POST /ai/packing-list', 'POST /ai/chat',
    'GET /outfits/recommended', 'POST /outfits', 'GET /outfits/:id', 'PATCH /outfits/:id',
    'DELETE /outfits/:id', 'POST /outfits/:id/favorite', 'POST /outfits/:id/feedback',
    'GET /events', 'POST /events', 'PATCH /events/:id', 'DELETE /events/:id',
    'GET /planner/weekly', 'POST /planner/weekly', 'POST /travel/packing-list',
    'GET /shop/recommended', 'POST /shop/before-you-buy', 'GET /shop/wishlist', 'POST /shop/wishlist',
    'GET /admin/dashboard', 'GET /admin/users', 'GET /admin/ai-performance', 'GET /admin/reports', 'GET /admin/system-health',
    'GET /weather/current', 'GET /health', 'GET /docs',
  ],
}));

function groupBy(rows, key) {
  const out = {};
  for (const r of rows) out[r[key]] = (out[r[key]] || 0) + 1;
  return out;
}

const server = app.listen(PORT, () =>
  console.log(
    `SmartWardrobe backend listening on http://localhost:${PORT}  (docs: /docs)`,
  ),
);
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `\nPort ${PORT} is already in use — another copy of the backend is already running.\n` +
        `You do NOT need to start it again: open http://localhost:${PORT}/docs to use it.\n` +
        `To run your own copy, stop the other one first, e.g.:\n` +
        `  netstat -ano | findstr :${PORT}\n  taskkill /PID <number> /F\n`,
    );
    process.exit(1);
  }
  throw err;
});
