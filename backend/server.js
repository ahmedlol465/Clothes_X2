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
// Load backend/.env first (gitignored) so GEMINI_API_KEY / WEATHER_KEY etc.
// are available to server.js and src/llm.js.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const store = require('./src/store');
const ai = require('./src/ai-engine');
const llm = require('./src/llm');
const scoring = require('./src/scoring');
const memoryStore = require('./src/style-memory');
const retrieval = require('./src/retrieval');
const weatherService = require('./src/weather');
const vision = require('./src/vision');
const tax = require('./src/taxonomy');

const PORT = process.env.EXPRESS_PORT || process.env.PORT || 3001;
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

// ------------------------------------------------------- style profile (§8.2)
// The style profile is a free-form object on the user record, so every read
// normalises it and every write is whitelisted. Without this the old handlers
// used `Object.assign(user, body)`, which let any client rewrite `id` or
// `passwordHash`, and silently accepted junk that later broke the UI.

/** Colour vocabulary offered by the Profile editor (§16 favouriteColors). */
const STYLE_COLORS = [
  'Black', 'White', 'Beige', 'Navy', 'Blue', 'Denim', 'Grey', 'Charcoal',
  'Brown', 'Tan', 'Cream', 'Green', 'Olive', 'Red', 'Burgundy', 'Pink',
  'Purple', 'Yellow', 'Orange', 'Multicolor',
];

/** Style vocabulary offered by the Profile editor (§16 preferredStyles). */
const STYLE_STYLES = [
  'Casual', 'Smart Casual', 'Minimalist', 'Classic', 'Vintage', 'Modern',
  'Formal', 'Elegant', 'Streetwear', 'Sporty', 'Bohemian', 'Preppy',
  'Raw Indigo', 'Minimal',
];

/** Fit vocabulary (§16 body/fit information). */
const STYLE_FITS = ['slim', 'regular', 'relaxed', 'oversized'];

/** Top / bottom / shoe size vocabularies (§16 size). */
const STYLE_SIZES = {
  top: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  bottom: ['28', '30', '32', '34', '36', '38', '40'],
  shoe: ['38', '39', '40', '41', '42', '43', '44', '45'],
};

const str = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
};
const list = (v, allowed, max) => {
  if (!Array.isArray(v)) return null;
  const seen = [];
  for (const raw of v) {
    const value = str(raw, 40);
    if (value && allowed.includes(value) && !seen.includes(value)) seen.push(value);
    if (seen.length >= max) break;
  }
  return seen;
};

/**
 * Default style profile for a user that has never edited theirs, so the
 * Profile screen always renders a complete, valid shape.
 */
function defaultStyleProfile() {
  return {
    favoriteColors: [],
    preferredStyles: [],
    avoidedColors: [],
    heightCm: null,
    weightKg: null,
    fitPreference: 'regular',
    sizes: { top: null, bottom: null, shoe: null },
  };
}

/** Read a stored style profile as a complete, valid object. */
function readStyleProfile(user) {
  const stored = user?.styleProfile || {};
  const sizes = stored.sizes || {};
  return {
    favoriteColors: list(stored.favoriteColors, STYLE_COLORS, 12) || [],
    preferredStyles: list(stored.preferredStyles, STYLE_STYLES, 12) || [],
    avoidedColors: list(stored.avoidedColors, STYLE_COLORS, 12) || [],
    heightCm: num(stored.heightCm, 80, 250),
    weightKg: num(stored.weightKg, 25, 300),
    fitPreference: STYLE_FITS.includes(stored.fitPreference)
      ? stored.fitPreference
      : 'regular',
    sizes: {
      top: STYLE_SIZES.top.includes(sizes.top) ? sizes.top : null,
      bottom: STYLE_SIZES.bottom.includes(sizes.bottom) ? sizes.bottom : null,
      shoe: STYLE_SIZES.shoe.includes(sizes.shoe ?? sizes.shoes)
        ? (sizes.shoe ?? sizes.shoes)
        : null,
    },
  };
}

/**
 * Apply a client patch to a style profile. Only whitelisted keys are read and
 * only whitelisted vocabulary values are stored, so a crafted body cannot
 * inject arbitrary keys or oversized values into the user record.
 */
function writeStyleProfile(user, body = {}) {
  const next = readStyleProfile(user);
  const b = body || {};

  if (b.favoriteColors !== undefined) {
    next.favoriteColors = list(b.favoriteColors, STYLE_COLORS, 12) || [];
  }
  if (b.preferredStyles !== undefined) {
    next.preferredStyles = list(b.preferredStyles, STYLE_STYLES, 12) || [];
  }
  if (b.avoidedColors !== undefined) {
    next.avoidedColors = list(b.avoidedColors, STYLE_COLORS, 12) || [];
  }
  if (b.heightCm !== undefined) {
    next.heightCm = b.heightCm === null || b.heightCm === '' ? null : num(b.heightCm, 80, 250);
  }
  if (b.weightKg !== undefined) {
    next.weightKg = b.weightKg === null || b.weightKg === '' ? null : num(b.weightKg, 25, 300);
  }
  if (b.fitPreference !== undefined) {
    next.fitPreference = STYLE_FITS.includes(b.fitPreference) ? b.fitPreference : 'regular';
  }
  if (b.sizes !== undefined && b.sizes && typeof b.sizes === 'object') {
    for (const slot of Object.keys(STYLE_SIZES)) {
      // `shoes` is accepted as a legacy alias for `shoe`.
      const raw = b.sizes[slot] ?? (slot === 'shoe' ? b.sizes.shoes : undefined);
      if (raw === undefined) continue;
      const value = str(raw, 8);
      next.sizes[slot] = value && STYLE_SIZES[slot].includes(value) ? value : null;
    }
  }

  user.styleProfile = next;
  return next;
}

/** The profile payload rendered by the Profile screen (§16). */
function profilePayload(user) {
  return {
    ...publicUser(user),
    styleProfile: readStyleProfile(user),
  };
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

// ------------------------------------------------- real photo uploads (§8.3)
// Device photos land in backend/storage/ (gitignored) and are served back at
// GET /storage/<file> so the app can display the exact photo that was taken.
const STORAGE_DIR = path.join(__dirname, 'storage');
fs.mkdirSync(STORAGE_DIR, { recursive: true });
app.use('/storage', express.static(STORAGE_DIR, { maxAge: '7d' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, STORAGE_DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype || '')) return cb(null, true);
    cb(new Error('Only image files are allowed.'));
  },
});

/** Absolute URL for a stored file, based on the incoming request host. */
function storageUrl(req, filename) {
  return `${req.protocol}://${req.get('host')}/storage/${filename}`;
}

/**
 * POST /wardrobe/upload — multipart `photos[]` (up to 10 images, 10MB each).
 * Returns [{ url, filename, mime, size }] for the Add Clothes flow.
 */
app.post('/wardrobe/upload', optionalAuth, (req, res) => {
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

/** Resolve a previously-uploaded /storage/<file> URL to raw bytes. */
function readStoredImage(imageUrl) {
  const m = String(imageUrl || '').match(/\/storage\/([^/?#]+)$/);
  if (!m) return null;
  const file = path.join(STORAGE_DIR, path.basename(m[1]));
  if (!file.startsWith(STORAGE_DIR) || !fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

/**
 * Sniff an image type from its magic bytes.
 *
 * Never trust the filename or a client-supplied content type. `assets/images/
 * item_shirt_white_small.jpg` is PNG data behind a .jpg name, and a decoder
 * handed the wrong type can throw or silently mis-sample.
 */
function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.slice(0, 6).toString('latin1') === 'GIF87a'
    || bytes.slice(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
  if (bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return null;
}

// ================================================================== 8.1 Auth
app.post('/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required.' });
  if (db.users.some((u) => u.email === String(email).toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered.' });
  }
  const user = {
    id: store.uid('u'), name: name || email.split('@')[0], email: String(email).toLowerCase(),
    passwordHash: store.sha256(password), createdAt: now(), avatarUrl: null,
    styleProfile: readStyleProfile(null),
  };
  const token = crypto.randomBytes(24).toString('hex');
  db.users.push(user);
  db.sessions.push({ token, userId: user.id, createdAt: now() });
  persist();
  res.status(201).json({ user: profilePayload(user), accessToken: token, refreshToken: token });
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
  res.json({ user: profilePayload(user), accessToken: token, refreshToken: token });
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
// Every route here is behind the strict `auth` guard, and the user is always
// resolved from the bearer token. There is no `:id` parameter anywhere, so a
// client cannot address another account by editing a request.

/** GET /users/me — the authenticated user, including their style profile. */
app.get('/users/me', auth, (req, res) => res.json({ user: profilePayload(req.user) }));

/**
 * PATCH /users/me — the only account fields a client may change.
 *
 * `id`, `email` and `passwordHash` are intentionally absent: the subject is
 * taken from the token, and email changes need a verification flow that does
 * not exist yet. `Object.assign(user, body)` would have allowed all three.
 */
app.patch('/users/me', auth, (req, res) => {
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = str(b.name, 80);
    if (!name) return res.status(400).json({ error: 'name cannot be empty.' });
    req.user.name = name;
  }
  if (b.avatarUrl !== undefined) {
    const avatar = str(b.avatarUrl, 500);
    // Avatars may only point at our own storage. Arbitrary http(s) URLs were
    // previously accepted, which let a client render a remote tracking pixel
    // inside someone else's profile card.
    req.user.avatarUrl = avatar && isOwnStorageUrl(avatar) ? avatar : null;
  }
  persist();
  res.json({ user: profilePayload(req.user) });
});

/** True when a URL is served by this backend's own /storage mount. */
function isOwnStorageUrl(u) {
  const m = String(u || '').match(/\/storage\/([^/?#]+)$/);
  return Boolean(m) && path.basename(m[1]) === m[1];
}

/** Absolute filesystem path for one of our /storage files, or null. */
function storagePathOf(storageUrl) {
  const m = String(storageUrl || '').match(/\/storage\/([^/?#]+)$/);
  if (!m) return null;
  const name = path.basename(m[1]);
  if (name !== m[1]) return null; // reject traversal like /storage/../../x
  const file = path.join(STORAGE_DIR, name);
  if (!file.startsWith(STORAGE_DIR + path.sep)) return null;
  return fs.existsSync(file) ? file : null;
}

/**
 * POST /users/me/avatar — multipart `photo`, single image.
 *
 * Reuses the same multer disk storage and /storage mount that back
 * POST /wardrobe/upload, so there is exactly one place images are persisted.
 * The subject always comes from the bearer token: a client cannot name another
 * user, and any `userId` field in the body is ignored.
 *
 * The previous avatar is only unlinked once the replacement is on disk, so a
 * failed upload can never leave the profile with a dangling reference.
 */
app.post('/users/me/avatar', auth, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        error: tooBig ? 'Image must be 10MB or smaller.' : err.message,
      });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Attach an image as photo.' });
    }

    const previous = req.user.avatarUrl;
    req.user.avatarUrl = storageUrl(req, req.file.filename);
    persist();

    // Best effort cleanup, only after the new file is safely written and the
    // new reference is committed. Never delete the file we just stored.
    if (previous && previous !== req.user.avatarUrl) {
      const old = storagePathOf(previous);
      if (old && old !== path.join(STORAGE_DIR, req.file.filename)) {
        try {
          fs.unlinkSync(old);
        } catch {
          /* a stale file is harmless; never fail the request over it */
        }
      }
    }

    res.json({ user: profilePayload(req.user) });
  });
});

/** GET /users/me/style-profile — the style blueprint shown on the Profile page. */
app.get('/users/me/style-profile', auth, (req, res) =>
  res.json({ styleProfile: readStyleProfile(req.user) }));

/** PATCH /users/me/style-profile — persist an edited style profile. */
app.patch('/users/me/style-profile', auth, (req, res) => {
  const styleProfile = writeStyleProfile(req.user, req.body || {});
  persist();
  res.json({ styleProfile, user: profilePayload(req.user) });
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

app.post('/wardrobe/items', optionalAuth, async (req, res) => {
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
  const body = req.body || {};

  // Collect the image once. Every downstream consumer wants a dataUrl (the LLM
  // providers) and raw bytes (the local CLIP + colour pipeline), and decoding
  // base64 twice is how a 12MB upload becomes a 24MB one.
  let dataUrl = body.dataUrl || null;
  let bytes = null;
  if (!dataUrl && body.imageBase64) {
    const b64 = String(body.imageBase64).replace(/^data:[^;]+;base64,/, '');
    dataUrl = `data:${body.mime || 'image/jpeg'};base64,${b64}`;
    try {
      bytes = Buffer.from(b64, 'base64');
    } catch {
      bytes = null;
    }
  }
  if (!dataUrl && body.imageUrl) {
    bytes = readStoredImage(body.imageUrl);
    // readStoredImage decodes the file itself and sniffs its real type, which
    // matters: one of our own fixtures is PNG bytes behind a .jpg name.
    if (bytes) dataUrl = `data:${sniffImageMime(bytes) || 'image/jpeg'};base64,${bytes.toString('base64')}`;
    else dataUrl = body.imageUrl; // absolute http(s) URL — provider fetches it
  }

  // Local pipeline first: it reads the pixels and can reject non-clothing, which
  // no remote provider is asked to do and which the old regex never could.
  const local = await ai.analyzeClothing({ ...body, bytes }).catch((e) => {
    console.error('[ai] local vision failed:', e.message);
    return null;
  });

  // A rejection is a final answer. Do not let a remote provider overwrite it
  // with a guess — that is exactly how a water bottle became a belt.
  if (local && local.success === false) {
    trackAi('analyze-clothing', Date.now() - t0, { source: 'clothing-vision', rejected: local.error_type });
    return res.status(422).json({ analysis: local, source: 'clothing-vision', rejected: true });
  }

  const base = local || ai.filenameAnalysis(body);
  let source = local ? (local.source || 'clothing-vision') : 'filename';
  let tokens;

  // Optional Gemini/Groq refinement when a key is configured. It may fill in
  // attributes the local model was unsure about, but it must not overwrite a
  // measured colour or a decided category — those came from the pixels.
  if (dataUrl && llm.status().configured) {
    try {
      const vision = await llm.analyzeImage({
        dataUrl,
        hint: body.filename || body.name || '',
      });
      const a = vision.attrs || {};
      const preferLocal = (key) => (base[key] && !base.uncertain?.includes(key) ? base[key] : undefined);
      base.color = preferLocal('color') || a.color || base.color;
      base.category = preferLocal('category') || a.category || base.category;
      base.style = a.style || base.style;
      base.pattern = a.pattern || base.pattern;
      base.material = a.material || base.material;
      base.season = a.season || base.season;
      if (a.confidence != null) base.visionConfidence = a.confidence;
      source += `+${llm.status().provider}`;
      tokens = vision.tokens;
    } catch (e) {
      console.error('[ai] vision refine failed, keeping local result:', e.message);
    }
  }

  trackAi('analyze-clothing', Date.now() - t0, { source, tokens });
  res.json({ analysis: base, source });
});

app.post('/ai/generate-outfit', optionalAuth, async (req, res) => {
  const t0 = Date.now();
  const body = req.body || {};
  const wardrobe = db.wardrobe.filter((i) => !i.archived);
  const weather = body.weather || (await resolveWeather());
  const outfits = ai.generateOutfits(wardrobe, {
    occasion: body.occasion || 'casual',
    weather,
    styleProfile: req.user?.styleProfile || {},
    memory: memoryStore.read(db, req.user?.id),
    count: body.count || 3,
    anchorItemId: body.anchorItemId,
    excludeIds: body.excludeIds || [],
    focus: body.focus || '',
  });
  trackAi('generate-outfit', Date.now() - t0);
  res.json({ outfits, weather });
});

app.post('/ai/calculate-compatibility', optionalAuth, async (req, res) => {
  const t0 = Date.now();
  const { itemIds = [], occasion = 'casual', weather } = req.body || {};
  const resolved = weather || (await resolveWeather());
  const items = itemIds.map((id) => db.wardrobe.find((i) => i.id === id)).filter(Boolean);
  if (items.length < 2) return res.status(400).json({ error: 'Provide at least 2 itemIds.' });
  const result = scoring.scoreOutfit(items, {
    occasion, weather: resolved,
    styleProfile: req.user?.styleProfile,
    memory: memoryStore.read(db, req.user?.id),
  });
  trackAi('calculate-compatibility', Date.now() - t0);
  res.json({ ...result, weather: resolved });
});

app.post('/ai/style-profile', optionalAuth, (req, res) => {
  const wardrobe = db.wardrobe.filter((i) => !i.archived);
  const memory = memoryStore.read(db, req.user?.id);
  res.json({
    styleProfile: ai.styleProfileFromWardrobe(wardrobe, db.feedback),
    styleDna: memoryStore.styleDna(memory, wardrobe),
    digest: memoryStore.digest(memory),
  });
});

app.post('/ai/wardrobe-gap', optionalAuth, (req, res) => {
  res.json(ai.wardrobeGap(db.wardrobe.filter((i) => !i.archived)));
});

app.post('/ai/packing-list', optionalAuth, (req, res) => {
  res.json(ai.packingList(db.wardrobe.filter((i) => !i.archived), req.body || {}));
});

// ------------------------------------------------------------- stylist core
/**
 * Shared context assembly for every stylist entry point.
 *
 * `ranked` is the retrieval shortlist: retrieval scores the whole wardrobe
 * locally (embeddings when available, lexical scoring otherwise) and returns a
 * category-balanced top slice. The LLM only ever sees these, which is what
 * replaces the old `wardrobe.slice(0, 40)`.
 */
async function stylistContext(user, message = '', opts = {}) {
  const wardrobe = db.wardrobe.filter((i) => !i.archived);
  const memory = memoryStore.read(db, user?.id);
  const weather = opts.weather || (await resolveWeather());
  const occasion = opts.occasion || ai.detectOccasion(message) || 'casual';

  const ranked = await retrieval.rank(message, wardrobe, {
    weather,
    occasion,
    limit: opts.limit || 30,
  });
  return {
    wardrobe,
    shortlist: ranked.map((r) => r.item),
    memory,
    weather,
    occasion,
    styleProfile: user?.styleProfile || {},
    events: db.events || [],
  };
}

/**
 * Recover the items a streamed reply talked about.
 *
 * The streaming path has no structured channel — the model answers in prose —
 * so the pieces it recommended are recovered by matching the ids *or* the
 * garment names it used back to the wardrobe. That keeps the streamed turn as
 * grounded as the non-streamed one, instead of quietly attaching an unrelated
 * generated look to advice about something else.
 */
function idsMentionedIn(text, wardrobe) {
  // Normalise once, but keep it a bare string — a padded copy made every match
  // depend on the word being followed by a space, so "your Leather Loafers,"
  // never matched "leather loafers".
  const haystack = tax.normalize(text).replace(/\s+/g, ' ');
  if (haystack.trim().length < 3) return [];

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const byId = wardrobe.filter((w) => w.id && new RegExp(`\\b${escape(w.id)}\\b`).test(haystack));
  // Longest names first so "Oxford Shirt" wins over "Shirt".
  const byName = wardrobe
    .filter((w) => w.name && w.name.length >= 4)
    .map((w) => ({ w, key: tax.normalize(w.name).trim() }))
    .filter(({ key }) => key && new RegExp(`\\b${escape(key)}\\b`).test(haystack))
    .sort((a, b) => b.w.name.length - a.w.name.length);
  return [...new Set([...byId, ...byName].map(({ w }) => w.id))];
}

/** Phrases worth mining for a durable preference. */
const LEARN_TRIGGER =
  /\b(hate|love|loves|never|always|avoid|prefer|don'?t like|dont like|no more|too (formal|casual|bright|plain|dressy))\b/i;

/**
 * Run the learning loop over a stylist turn.
 *
 * The LLM's `memoryNotes` is a lossy paraphrase of what the user said, so it
 * is an *extra* pass — never a replacement. Learning only from the summary
 * turned "I never wear sneakers" into the far weaker "avoids sneakers", which
 * is an opinion rather than an exclusion.
 */
function learnTurn(memory, message, memoryNotes) {
  const sources = [message, memoryNotes].filter((s) => typeof s === 'string' && s.trim());
  if (!sources.some((s) => LEARN_TRIGGER.test(s))) return false;
  for (const s of sources) memoryStore.learnChat(memory, s);
  return true;
}

/** Turn the LLM's chosen ids into a real, scored outfit. */
function buildOutfitFromIds(ids, ctx, opts = {}) {
  // Dedupe on the garment, not the id: the wardrobe can hold two "White Shirt"
  // rows, and a reply that names it once must not produce a matching pair.
  const picked = [];
  const seen = new Set();
  for (const id of [...new Set(ids || [])]) {
    const item = ctx.wardrobe.find((w) => w.id === id);
    if (!item) continue;
    const key = tax.garmentKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(item);
  }
  const items = picked;
  if (items.length < 2) return null;

  const result = scoring.scoreOutfit(items, {
    occasion: opts.occasion || ctx.occasion,
    weather: ctx.weather,
    styleProfile: ctx.styleProfile,
    memory: ctx.memory,
  });
  return {
    id: `llm-${Date.now()}`,
    name: ai.outfitName(items, opts.occasion || ctx.occasion),
    occasion: opts.occasion || ctx.occasion,
    match: result.match,
    breakdown: result.breakdown,
    completeness: result.completeness,
    explanation: scoring.explain(items, {
      occasion: opts.occasion || ctx.occasion,
      weather: ctx.weather,
    }, result),
    itemIds: items.map((p) => p.id),
    pieces: items.map((p) => p.name),
    items,
    image: items[0]?.image,
  };
}

/** Server-side conversation recall when the client sends no history. */
function recallTurns(userId, conversationId, limit = 10) {
  const log = db.conversations || [];
  return log
    .filter((t) => t.userId === userId && (!conversationId || t.conversationId === conversationId))
    .slice(-limit)
    .flatMap((t) => ([
      { fromUser: true, text: t.message },
      { fromUser: false, text: t.reply },
    ]));
}

/**
 * POST /ai/chat — the stylist turn.
 *
 * Order of operations:
 *   retrieve → LLM (with history + memory digest) → validate ids → score →
 *   learn from the message → persist the turn.
 *
 * Falls back to the rule engine at any failure, so this endpoint always
 * answers with real content.
 */
app.post('/ai/chat', optionalAuth, async (req, res) => {
  const t0 = Date.now();
  const { message = '', history = [], conversationId } = req.body || {};
  if (!String(message).trim()) return res.status(400).json({ error: 'message is required.' });

  const user = req.user;
  const ctx = await stylistContext(user, message);
  // `let`: reassigned to the provider name once the LLM turn succeeds. As a
  // `const` the assignment threw, and the catch below swallowed it — so the
  // reply read like an LLM answer while `source` stayed "rules" and the
  // model's chosen item ids were never assembled into an outfit.
  let source = 'rules';
  let reply = '';
  let intent = 'chat';
  let followUp = null;
  let constraints = { colors: [], styles: [], avoid: [] };
  let occasion = ctx.occasion;
  let tokens;
  let memoryNotes = null;

  if (llm.status().configured) {
    try {
      const gen = await llm.stylistChat({
        message,
        // History: whatever the client sent, else what we remembered.
        history: history.length ? history : recallTurns(user?.id, conversationId),
        wardrobe: ctx.shortlist,
        weather: ctx.weather,
        styleProfile: ctx.styleProfile,
        memoryDigest: memoryStore.digest(ctx.memory),
        events: ctx.events,
        imageUrl: req.body?.dataUrl || req.body?.imageUrl || null,
      });
      reply = gen.text;
      intent = gen.intent;
      followUp = gen.followUp;
      constraints = gen.constraints;
      memoryNotes = gen.memoryNotes;
      occasion = gen.occasion || occasion;
      tokens = gen.tokens;
      source = llm.status().provider;
      ctx.outfit = buildOutfitFromIds(gen.itemIds, ctx, { occasion });
    } catch (e) {
      console.error('[ai] chat failed, rules fallback:', e.message);
    }
  }

  // Rule engine: answers on its own when there is no LLM, and rescues a
  // failed or empty LLM turn.
  if (!reply) {
    const fallback = ai.chatReply(message, {
      wardrobe: ctx.wardrobe,
      weather: ctx.weather,
      styleProfile: ctx.styleProfile,
      memory: ctx.memory,
    });
    reply = fallback.text;
    intent = fallback.intent || 'chat';
    occasion = fallback.occasion || occasion;
    ctx.outfit = fallback.outfit || null;
    if (!constraints.colors.length) constraints = fallback.constraints || constraints;
  }

  const outfit = ctx.outfit || null;

  // Learning loop: mine the user's own words for durable preferences.
  if (learnTurn(ctx.memory, message, memoryNotes)) memoryStore.write(db, ctx.memory);

  db.conversations.push({
    id: store.uid('t'),
    userId: user?.id || null,
    conversationId: conversationId || null,
    at: now(), message, reply,
    itemIds: outfit?.itemIds || [],
  });
  if (db.conversations.length > 400) db.conversations = db.conversations.slice(-400);
  persist();

  trackAi('chat', Date.now() - t0, { source, tokens });
  res.json({
    reply,
    outfit,
    followUp,
    intent,
    occasion,
    constraints,
    weather: ctx.weather,
    memory: { confidence: memoryStore.confidence(ctx.memory), digest: memoryStore.digest(ctx.memory) },
    conversationId: conversationId || null,
    source,
  });
});

/**
 * POST /ai/chat/stream — same turn, but the reply is streamed as SSE so the
 * UI types it out. Emits `delta` events, then a final `done` event carrying
 * the assembled text. Falls back to a single `done` with the rule-engine
 * reply when the provider has no stream support or errors mid-flight.
 */
app.post('/ai/chat/stream', optionalAuth, async (req, res) => {
  const { message = '', history = [], conversationId } = req.body || {};
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (!String(message).trim()) {
    send('error', { error: 'message is required.' });
    return res.end();
  }

  const t0 = Date.now();
  const user = req.user;
  let ctx;
  try {
    ctx = await stylistContext(user, message);
  } catch (e) {
    send('error', { error: e.message });
    return res.end();
  }

  const aborter = new AbortController();
  res.on('close', () => aborter.abort());

  let text = '';
  let source = 'rules';
  let tokens;

  if (llm.status().configured) {
    try {
      source = llm.status().provider;
      for await (const chunk of llm.streamChat({
        message,
        history: history.length ? history : recallTurns(user?.id, conversationId),
        wardrobe: ctx.shortlist,
        weather: ctx.weather,
        styleProfile: ctx.styleProfile,
        memoryDigest: memoryStore.digest(ctx.memory),
      })) {
        if (aborter.signal.aborted) break;
        if (chunk.delta) {
          text += chunk.delta;
          send('delta', { delta: chunk.delta });
        }
        if (chunk.done) tokens = chunk.tokens;
      }
    } catch (e) {
      console.error('[ai] stream failed:', e.message);
      send('error', { error: e.message, recoverable: true });
      source = 'rules';
    }
  }

  // Anything not delivered by the stream (no key, provider error, empty
  // stream) is filled in by the rule engine.
  if (!text.trim()) {
    const fallback = ai.chatReply(message, {
      wardrobe: ctx.wardrobe, weather: ctx.weather,
      styleProfile: ctx.styleProfile, memory: ctx.memory,
    });
    text = fallback.text;
    source = 'rules';
    ctx.outfit = fallback.outfit || null;
    send('delta', { delta: text, synthetic: true });
  } else {
    // No structured id list on this path. Prefer the pieces the model actually
    // named; only fall back to generating a look when it named fewer than two.
    const named = buildOutfitFromIds(idsMentionedIn(text, ctx.wardrobe), ctx);
    ctx.outfit = named || ai.generateOutfits(ctx.wardrobe, {
      occasion: ctx.occasion, weather: ctx.weather,
      styleProfile: ctx.styleProfile, memory: ctx.memory, count: 1,
    })[0] || null;
  }

  const outfit = ctx.outfit || null;
  // The streaming turn is the one the app actually uses, so it learns too.
  if (learnTurn(ctx.memory, message, null)) memoryStore.write(db, ctx.memory);
  db.conversations.push({
    id: store.uid('t'), userId: user?.id || null,
    conversationId: conversationId || null, at: now(), message, reply: text,
    itemIds: outfit?.itemIds || [],
  });
  if (db.conversations.length > 400) db.conversations = db.conversations.slice(-400);
  persist();
  trackAi('chat/stream', Date.now() - t0, { source, tokens });

  send('done', {
    reply: text,
    outfit,
    weather: ctx.weather,
    memory: { confidence: memoryStore.confidence(ctx.memory), digest: memoryStore.digest(ctx.memory) },
    source,
  });
  res.end();
});

/**
 * POST /ai/match-outfit — the "advanced clothes" feature.
 *
 * Send a photo of an outfit someone else is wearing. The vision model reads it
 * into a structured spec, then every slot is matched against the user's own
 * wardrobe to produce a wearable plan plus an explicit list of what they are
 * missing.
 *
 * Accepts JSON (`dataUrl` / `imageUrl` / `filename`) or a multipart `photo`.
 */
app.post('/ai/match-outfit', optionalAuth, (req, res) => {
  const t0 = Date.now();
  const wardrobe = db.wardrobe.filter((i) => !i.archived);
  if (!wardrobe.length) {
    return res.status(400).json({ error: 'Add a few items to your wardrobe first.' });
  }

  // Multipart path: `upload.single('photo')` before anything else.
  const multipart = (req.is('multipart/form-data')
    ? new Promise((resolve) => upload.single('photo')(req, res, resolve))
    : Promise.resolve());
  multipart.then(async () => {
    let dataUrl = req.body?.dataUrl || req.body?.imageUrl || null;
    if (!dataUrl && req.file) {
      const bytes = fs.readFileSync(req.file.path);
      dataUrl = `data:${req.file.mimetype || 'image/jpeg'};base64,${bytes.toString('base64')}`;
    }

    let source = 'rules';
    let tokens;
    let spec;
    try {
      if (dataUrl && llm.status().configured) {
        const visionOut = await llm.describeOutfit({
          dataUrl,
          hint: req.body?.note || '',
        });
        spec = vision.normaliseSpec(visionOut.spec);
        source = `${llm.status().provider}-vision`;
        tokens = visionOut.tokens;
      } else {
        // No key: still produce a plan from the filename rather than an error.
        spec = vision.specFromFilename(req.body?.filename || '', req.body?.note || '');
        source = 'filename';
      }
    } catch (e) {
      console.error('[ai] outfit vision failed:', e.message);
      spec = vision.specFromFilename(req.body?.filename || '', req.body?.note || '');
      source = 'filename';
      trackAi('match-outfit', Date.now() - t0, { source, error: e.message });
      return res.status(200).json({ ...vision.matchSpec(spec, wardrobe), source: 'filename', degraded: true });
    }

    const result = vision.matchSpec(spec, wardrobe, {
      weather: req.body?.weather || currentWeather(),
    });

    // Score the resulting look so the user sees one consistent number.
    if (result.items.length >= 2) {
      const memory = memoryStore.read(db, req.user?.id);
      const scored = scoring.scoreOutfit(result.items, {
        occasion: result.reference.occasion || 'casual',
        weather: req.body?.weather || currentWeather(),
        styleProfile: req.user?.styleProfile,
        memory,
      });
      result.outfit = {
        id: `match-${Date.now()}`,
        name: result.reference.title,
        match: scored.match,
        breakdown: scored.breakdown,
        explanation: scoring.explain(result.items, {
          occasion: result.reference.occasion || 'casual',
          weather: req.body?.weather || currentWeather(),
        }, scored),
        itemIds: result.itemIds,
        pieces: result.items.map((i) => i.name),
        items: result.items,
        image: result.items[0]?.image,
      };
    }

    trackAi('match-outfit', Date.now() - t0, { source, tokens });
    res.json({ ...result, source });
  }).catch((e) => res.status(400).json({ error: e.message }));
});

/**
 * POST /ai/remix — re-dress an existing outfit for another context.
 * `variant` is one of casual | cold | summer | date | formal.
 */
app.post('/ai/remix', optionalAuth, async (req, res) => {
  const t0 = Date.now();
  const { itemIds = [], variant = 'casual', weather } = req.body || {};
  const wardrobe = db.wardrobe.filter((i) => !i.archived);
  if (!ai.REMIX_TARGETS[variant]) {
    return res.status(400).json({
      error: `Unknown variant "${variant}".`,
      variants: Object.keys(ai.REMIX_TARGETS),
    });
  }
  if (!itemIds.length) return res.status(400).json({ error: 'itemIds is required.' });

  const items = itemIds.map((id) => wardrobe.find((i) => i.id === id)).filter(Boolean);
  if (!items.length) return res.status(404).json({ error: 'None of those items are in your wardrobe.' });

  const result = ai.remixOutfit(wardrobe, {
    itemIds: items.map((i) => i.id),
    variant,
    weather: weather || (await resolveWeather()),
    styleProfile: req.user?.styleProfile,
    memory: memoryStore.read(db, req.user?.id),
  });
  trackAi('remix', Date.now() - t0, { source: 'rules', variant });
  res.json(result);
});

/** GET /ai/style-dna — what the stylist has learned about this user. */
app.get('/ai/style-dna', optionalAuth, (req, res) => {
  const wardrobe = db.wardrobe.filter((i) => !i.archived);
  const memory = memoryStore.read(db, req.user?.id);
  res.json({
    styleDna: memoryStore.styleDna(memory, wardrobe),
    digest: memoryStore.digest(memory),
  });
});

/** GET /ai/conversations — recent stylist turns, newest last. */
app.get('/ai/conversations', optionalAuth, (req, res) => {
  const userId = req.user?.id;
  const limit = Math.min(100, Number(req.query.limit) || 40);
  const turns = (db.conversations || [])
    .filter((t) => !userId || !t.userId || t.userId === userId)
    .slice(-limit);
  res.json({ turns, total: db.conversations?.length || 0 });
});

/** DELETE /ai/conversations — forget the conversation, keep learned taste. */
app.delete('/ai/conversations', optionalAuth, (req, res) => {
  const userId = req.user?.id;
  db.conversations = (db.conversations || []).filter((t) => t.userId && t.userId !== userId);
  persist();
  res.json({ ok: true });
});

/** GET /ai/capabilities — what the stylist can currently do, and why not. */
app.get('/ai/capabilities', optionalAuth, async (req, res) => {
  const llmStatus = llm.status();
  const emb = await retrieval.status();
  res.json({
    llm: llmStatus,
    embeddings: emb,
    weather: { keyless: true, provider: 'open-meteo' },
    memory: memoryStore.digest(memoryStore.read(db, req.user?.id)),
    features: {
      conversationMemory: true,
      streaming: llmStatus.configured,
      visionAnalysis: llmStatus.configured && llmStatus.vision,
      visionOutfitMatching: llmStatus.configured && llmStatus.vision,
      semanticRetrieval: emb.embeddings,
      learnedRanking: true,
      remix: true,
      keylessWeather: true,
    },
  });
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
  const outfit = db.outfits.find((o) => o.id === req.params.id);
  db.feedback.push({
    outfitId: req.params.id, rating, comment, at: now(),
    userId: req.user?.id || null,
  });

  // Learning loop (§9). The old version nudged one hardcoded
  // `neutral_colors` row by ±0.01 that nothing ever read back. Now the
  // rating is attributed to the actual garments in the outfit, and those
  // preference scores feed straight into future ranking via factorWeights().
  const items = (outfit?.itemIds || [])
    .map((id) => db.wardrobe.find((i) => i.id === id))
    .filter(Boolean);
  const memory = memoryStore.record(db, req.user?.id || 'anonymous', {
    rating: Number(rating),
    items,
    message: comment || null,
  });
  persist();

  res.json({
    ok: true,
    learned: {
      confidence: memoryStore.confidence(memory),
      ratings: memory.totals.ratings,
      signals: memory.totals.chats,
      // Show the user what actually moved, so the loop is not a black box.
      palette: Object.entries(memory.colors)
        .sort((a, b) => Math.abs(b[1] - 0.5) - Math.abs(a[1] - 0.5))
        .slice(0, 5)
        .map(([label, value]) => ({ label, value: Number(value.toFixed(3)) })),
      notes: memory.facts.slice(0, 3).map((f) => f.text),
    },
  });
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
app.get('/admin/system-health', async (_req, res) => res.json({
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
  dbFile: 'backend/data/db.json',
}));

// ------------------------------------------------------- weather + misc
/**
 * Live weather via Open-Meteo — free, and no API key required, so a fresh
 * checkout gets real conditions instead of the old hardcoded "28°C sunny"
 * stub. Falls back to OpenWeatherMap when WEATHER_KEY is set, then to a
 * seasonal estimate. Never throws.
 */
function currentWeather(city) {
  return weatherService.estimate(city);
}

async function resolveWeather(city) {
  try {
    return await weatherService.resolve(city);
  } catch (e) {
    console.error('[weather] resolve failed, stub fallback:', e.message);
    return currentWeather(city);
  }
}

app.get('/weather/current', async (req, res) => {
  res.json({ weather: await resolveWeather(req.query.city) });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'smartwardrobe-backend' }));
app.get('/docs', (_req, res) => res.json({
  service: 'SmartWardrobe API (§8)',
  endpoints: [
    'POST /auth/register', 'POST /auth/login', 'POST /auth/refresh', 'POST /auth/logout',
    'GET /users/me', 'PATCH /users/me', 'POST /users/me/avatar',
    'GET /users/me/style-profile', 'PATCH /users/me/style-profile',
    'GET /wardrobe/items', 'POST /wardrobe/items', 'POST /wardrobe/upload', 'GET /wardrobe/items/:id', 'PATCH /wardrobe/items/:id',
    'DELETE /wardrobe/items/:id', 'POST /wardrobe/items/batch-upload', 'GET /wardrobe/collections',
    'POST /ai/analyze-clothing', 'POST /ai/generate-outfit', 'POST /ai/calculate-compatibility',
    'POST /ai/style-profile', 'POST /ai/wardrobe-gap', 'POST /ai/packing-list',
    'POST /ai/chat', 'POST /ai/chat/stream (SSE)', 'POST /ai/match-outfit',
    'POST /ai/remix', 'GET /ai/style-dna', 'GET /ai/conversations',
    'DELETE /ai/conversations', 'GET /ai/capabilities',
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

// Preload the local embedding model in the background so the first stylist
// request is not the slow one. Purely optional — if it fails, retrieval falls
// back to lexical scoring and the server is unaffected.
retrieval.warmup().then((ok) => {
  if (ok) console.log('[ai] local embeddings ready');
  else console.log('[ai] embeddings unavailable — using lexical retrieval');
});
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
