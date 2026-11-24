/**
 * Store: users, wardrobe, outfits, events, planner, shop, ai usage.
 *
 * The app works on one in-memory object (`db`, see lib/context.js) and calls
 * `save(db)` after every change. Where that object is persisted depends on
 * DB_DRIVER:
 *
 *   json   (default)  backend/data/db.json, written synchronously.
 *   mysql             MySQL 8 / MariaDB: one row per record in `sw_records`,
 *                     written in the background (write-behind, ~150 ms
 *                     debounce) and flushed on shutdown. Configure with
 *                     DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.
 *
 * `init()` must be awaited once before serving requests when DB_DRIVER=mysql:
 * it connects, creates the table, loads the data, and on an empty database
 * imports an existing db.json (or the demo seed).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const savedOutfitsStore = require('../services/saved-outfits');

// Integration tests point this at a temp directory so they exercise the real
// HTTP stack without ever reading or writing backend/data/db.json. Dev and
// production leave the variable unset and keep the original path.
const DATA_DIR = process.env.SMARTWARDROBE_DATA_DIR
  ? path.resolve(process.env.SMARTWARDROBE_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function seed() {
  // Mirrors lib/data/mock_data.dart so the UI looks identical on first run.
  const wardrobe = [
    { id: 'w1', name: 'Oxford Cotton Shirt', image: 'assets/images/item_shirt_white_soft.jpg', category: 'Tops', color: 'White', style: 'Casual', material: '100% Cotton', season: 'Spring / Summer', formality: 'Casual / Semi-Formal', pattern: 'Plain', brand: 'SmartWardrobe', timesWorn: 19, lastWornLabel: 'Worn 4 days ago' },
    { id: 'w2', name: 'Raw Denim Jeans', image: 'assets/images/item_jeans_denim_folded.jpg', category: 'Bottoms', color: 'Indigo', style: 'Raw Indigo', material: '100% Cotton', season: 'All Season', formality: 'Casual', pattern: 'Plain', brand: '', timesWorn: 12, lastWornLabel: 'Worn 1 week ago' },
    { id: 'w3', name: 'Beige Knit Sweater', image: 'assets/images/sweater_beige_cable.jpg', category: 'Tops', color: 'Beige', style: 'Smart Casual', material: 'Merino Wool', season: 'Autumn / Winter', formality: 'Smart Casual', pattern: 'Cable', brand: '', timesWorn: 14, lastWornLabel: 'Worn 6 days ago' },
    { id: 'w4', name: 'Minimalist Sneakers', image: 'assets/images/sneakers_minimal.jpg', category: 'Shoes', color: 'White', style: 'Minimal', material: 'Leather', season: 'All Season', formality: 'Casual', pattern: 'Plain', brand: '', timesWorn: 17, lastWornLabel: 'Worn 2 days ago' },
    { id: 'w5', name: 'Linen Summer Blazer', image: 'assets/images/blazer_beige_studio.jpg', category: 'Outerwear', color: 'Beige', style: 'Smart Casual', material: 'Linen Blend', season: 'Spring / Summer', formality: 'Smart Casual', pattern: 'Plain', brand: '', timesWorn: 9, lastWornLabel: 'Worn 3 days ago' },
    { id: 'w6', name: 'Minimalist Leather Belt', image: 'assets/images/accessory_belt_tan.jpg', category: 'Accessories', color: 'Tan', style: 'Minimal', material: 'Full Grain Leather', season: 'All Season', formality: 'Casual / Formal', pattern: 'Plain', brand: '', timesWorn: 21, lastWornLabel: 'Worn yesterday' },
    { id: 'w7', name: 'Suede Jacket', image: 'assets/images/jacket_suede.jpg', category: 'Outerwear', color: 'Dark Brown', style: 'Vintage', material: 'Suede', season: 'Autumn / Winter', formality: 'Casual', pattern: 'Plain', brand: '', timesWorn: 24, lastWornLabel: 'Worn 2 days ago' },
    { id: 'w8', name: 'Leather Loafers', image: 'assets/images/shoes_brown_loafers.jpg', category: 'Shoes', color: 'Brown', style: 'Classic', material: 'Leather', season: 'Spring / Summer', formality: 'Formal', pattern: 'Plain', brand: '', timesWorn: 11, lastWornLabel: 'Worn 5 days ago' },
    { id: 'w9', name: 'Tailored Trousers', image: 'assets/images/item_trousers_grey.jpg', category: 'Bottoms', color: 'Charcoal', style: 'Modern', material: 'Wool Blend', season: 'Autumn / Winter', formality: 'Formal', pattern: 'Plain', brand: '', timesWorn: 8, lastWornLabel: 'Worn 1 week ago' },
    { id: 'w10', name: 'Silk Scarf', image: 'assets/images/accessory_scarf_silk.jpg', category: 'Accessories', color: 'Multicolor', style: 'Elegant', material: 'Silk', season: 'All Season', formality: 'Elegant', pattern: 'Floral', brand: '', timesWorn: 0, lastWornLabel: 'Unworn for 60+ days' },
    { id: 'w11', name: 'Beige Chinos', image: 'assets/images/item_chinos_beige.jpg', category: 'Bottoms', color: 'Beige', style: 'Smart Casual', material: 'Cotton Twill', season: 'Spring / Summer', formality: 'Smart Casual', pattern: 'Plain', brand: '', timesWorn: 15, lastWornLabel: 'Worn 3 days ago' },
    { id: 'w12', name: 'Navy Wool Blazer', image: 'assets/images/blazer_navy_hanger.jpg', category: 'Outerwear', color: 'Navy', style: 'Formal', material: 'Wool', season: 'Autumn / Winter', formality: 'Formal', pattern: 'Plain', brand: '', timesWorn: 6, lastWornLabel: 'Worn 2 weeks ago' },
  ];
  const outfits = [
    { id: 'o1', name: 'University Casual', image: 'assets/images/outfit_university_casual.jpg', occasion: 'Academics', match: 92, pieces: ['White Tee', 'Raw Denim', 'Sneakers'], itemIds: ['w1', 'w2', 'w4'], favorite: false, createdAt: new Date().toISOString() },
    { id: 'o2', name: 'Formal Dinner', image: 'assets/images/outfit_formal_dinner.jpg', occasion: 'Formal', match: 89, pieces: ['Navy Suit', 'White Shirt', 'Oxfords'], itemIds: ['w12', 'w1', 'w8'], favorite: false, createdAt: new Date().toISOString() },
    { id: 'o3', name: 'Weekend Chillout', image: 'assets/images/flatlay_denim_knit.jpg', occasion: 'Leisure', match: 95, pieces: ['Denim', 'Knit', 'Loafers'], itemIds: ['w2', 'w3', 'w8'], favorite: true, createdAt: new Date().toISOString() },
    { id: 'o4', name: 'Date Night Elite', image: 'assets/images/outfit_date_night_elite.jpg', occasion: 'Elegant', match: 88, pieces: ['Black Shirt', 'Tailored Trousers'], itemIds: ['w1', 'w9'], favorite: true, createdAt: new Date().toISOString() },
  ];
  // The demo user's saved-outfit relationships (§8.5). Built through the same
  // module the API uses, so the seed ids match a later re-save exactly and a
  // fresh database shows the same four saved outfits the demo always had.
  const savedOutfitDraft = {};
  for (const outfit of outfits) {
    savedOutfitsStore.save(savedOutfitDraft, { userId: 'u_demo', outfitId: outfit.id });
  }
  const savedOutfits = savedOutfitDraft.savedOutfits;
  return {
    users: [
      {
        id: 'u_demo', name: 'Karim Hassan', email: 'karim@fashiontech.com',
        passwordHash: hashPassword('wardrobe2024'), createdAt: new Date().toISOString(),
        avatarUrl: null,
        styleProfile: {
          preferredStyles: ['Casual', 'Smart Casual', 'Minimalist'],
          favoriteColors: ['Black', 'White', 'Blue'],
          avoidedColors: [],
          heightCm: 178,
          weightKg: null,
          fitPreference: 'regular',
          sizes: { top: 'M', bottom: '32', shoe: '42' },
        },
      },
    ],
    sessions: [],
    wardrobe,
    outfits,
    // Per-user saved-outfit relationships (§8.5): `{ id, userId, outfitId,
    // createdAt }`. Kept separate from `outfits` so unsaving removes only the
    // relationship, never the shared outfit record. Created for new databases;
    // saved-outfits.js creates it on demand for existing db.json files.
    savedOutfits,
    wearEvents: [],
    feedback: [],
    // §4: what each user was actually shown by GET /outfits/recommended
    // (compact rows: user, time, context, outfit id, item ids). Created for
    // new databases; recommendation-history.js creates it on demand for
    // existing db.json files, so no migration is needed.
    recommendationHistory: [],
    styleMemory: [
      { userId: 'u_demo', preference: 'neutral_colors', value: 0.91, confidence: 0.87, source: 'outfit_feedback', updatedAt: new Date().toISOString() },
    ],
    conversations: [],
    events: [
      { id: 'e1', title: 'University Presentation', date: 'Tomorrow • 10:00 AM', type: 'presentation', location: 'Campus Hall B', dressCode: 'Smart Casual', outfitId: null },
      { id: 'e2', title: 'Dinner with Friends', date: 'Fri • 8:00 PM', type: 'social', location: 'Downtown', dressCode: 'Smart Casual', outfitId: null },
    ],
    weeklyPlan: [
      { weekday: 'Mon', date: '25', occasion: 'University Lectures', outfitName: 'Classic Oxford Style', image: 'assets/images/outfit_flatlay_beige.jpg', outfitId: 'o1' },
      { weekday: 'Tue', date: '26', occasion: 'Coffee with Mia', outfitName: 'Soft Weekend Layers', image: 'assets/images/outfit_university_casual.jpg', outfitId: 'o1' },
      { weekday: 'Wed', date: '27', occasion: 'Team Project Presentation', outfitName: 'Modern Business Casual', image: 'assets/images/outfit_modern_business.jpg', outfitId: 'o2', isToday: true },
      { weekday: 'Thu', date: '28', occasion: 'Group Study', outfitName: 'Easy Campus Casual', image: 'assets/images/outfit_university_casual.jpg', outfitId: 'o1' },
      { weekday: 'Fri', date: '29', occasion: 'Dinner with Friends', outfitName: 'Elevated Evening Minimal', image: 'assets/images/outfit_date_night_elite.jpg', outfitId: 'o4' },
      { weekday: 'Sat', date: '30', occasion: 'Farmers Market', outfitName: 'Relaxed Weekend', image: 'assets/images/outfit_travel_backpack.jpg', outfitId: 'o3' },
      { weekday: 'Sun', date: '1', occasion: 'Rest Day', outfitName: 'Lounge Comfort', image: 'assets/images/flatlay_denim_knit.jpg', outfitId: 'o3' },
    ],
    wishlist: [],
    products: [
      { id: 'p1', name: 'White Formal Shirt', price: '$65.00', image: 'assets/images/item_shirt_white_cream.jpg', reason: 'You own 4 casual jackets but no formal white shirt to pair them with for events.' },
      { id: 'p2', name: 'Black Oxford Shoes', price: '$120.00', image: 'assets/images/shoes_black_loafers.jpg', reason: 'Your wardrobe lacks formal footwear. These complete 6 smart outfit gaps.' },
      { id: 'p3', name: 'Navy Blazer', price: '$180.00', image: 'assets/images/blazer_navy_hanger.jpg', reason: 'Highly versatile. Can layer with all your existing white t-shirts and trousers.' },
    ],
    aiUsage: [],
  };
}


function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

/** bcrypt hash for new passwords. */
function hashPassword(password) { return bcrypt.hashSync(String(password), 10); }

/**
 * Check a password against a stored hash. Accepts bcrypt hashes and the legacy
 * unsalted SHA-256 hashes written by older versions; `upgrade` is true when the
 * caller should re-save the password as bcrypt.
 */
function verifyPassword(password, stored) {
  const pw = String(password ?? '');
  if (typeof stored !== 'string' || !stored) return { ok: false, upgrade: false };
  if (/^\$2[aby]\$/.test(stored)) return { ok: bcrypt.compareSync(pw, stored), upgrade: false };
  const a = Buffer.from(sha256(pw));
  const b = Buffer.from(stored);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, upgrade: ok };
}

const DRIVER = (process.env.DB_DRIVER || 'json').toLowerCase();

function readJsonFile() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch { /* fall through */ }
  return null;
}

/** Synchronous load. For MySQL this is only the starting point: init() replaces it. */
function load() {
  if (DRIVER === 'mysql') return readJsonFile() || seed();
  const existing = readJsonFile();
  if (existing) return existing;
  const db = seed();
  save(db);
  return db;
}

// ------------------------------------------------------------------ MySQL
let pool = null;
let lastSaved = new Map(); // collection -> JSON string last written
let flushTimer = null;
let flushing = Promise.resolve();
let currentDb = null;

function mysqlConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'smartwardrobe',
    waitForConnections: true,
    connectionLimit: 4,
    charset: 'utf8mb4',
  };
}

const collectionsOf = (db) => Object.keys(db);

async function init(db) {
  if (DRIVER !== 'mysql') return { driver: 'json', file: DB_FILE };
  const mysql = require('mysql2/promise');
  const cfg = mysqlConfig();
  try {
    // Create the database if the user is allowed to; ignore failure when it already exists.
    const admin = await mysql.createConnection({ ...cfg, database: undefined });
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4`);
    await admin.end();
  } catch (e) {
    if (e && /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ACCESS_DENIED|ER_ACCESS/.test(`${e.code} ${e.message}`)) throw e;
  }
  pool = mysql.createPool(cfg);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS sw_records (
       collection VARCHAR(64) NOT NULL,
       position   INT NOT NULL,
       data       JSON NOT NULL,
       PRIMARY KEY (collection, position)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
  const [rows] = await pool.query('SELECT collection, position, data FROM sw_records ORDER BY collection, position');
  currentDb = db;
  if (rows.length === 0) {
    // Fresh database: keep whatever load() produced (old db.json, or the demo seed) and write it.
    lastSaved = new Map();
    await flushNow();
    return { driver: 'mysql', imported: fs.existsSync(DB_FILE) ? 'db.json' : 'seed', host: cfg.host, database: cfg.database };
  }
  const loaded = {};
  for (const r of rows) {
    (loaded[r.collection] ??= []).push(typeof r.data === 'string' ? JSON.parse(r.data) : r.data);
  }
  // Collections that are empty arrays have no rows; restore them from the seed shape.
  const shape = seed();
  for (const k of Object.keys(shape)) if (!(k in loaded)) loaded[k] = Array.isArray(shape[k]) ? [] : shape[k];
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, loaded);
  lastSaved = new Map(collectionsOf(db).map((k) => [k, JSON.stringify(db[k])]));
  return { driver: 'mysql', loaded: rows.length, host: cfg.host, database: cfg.database };
}

async function flushNow() {
  if (!pool || !currentDb) return;
  const db = currentDb;
  const conn = await pool.getConnection();
  try {
    for (const key of collectionsOf(db)) {
      const json = JSON.stringify(db[key]);
      if (lastSaved.get(key) === json) continue;
      await conn.beginTransaction();
      try {
        await conn.query('DELETE FROM sw_records WHERE collection = ?', [key]);
        const items = Array.isArray(db[key]) ? db[key] : [db[key]];
        for (let i = 0; i < items.length; i += 200) {
          const chunk = items.slice(i, i + 200);
          await conn.query(
            'INSERT INTO sw_records (collection, position, data) VALUES ?',
            [chunk.map((item, j) => [key, i + j, JSON.stringify(item)])],
          );
        }
        await conn.commit();
        lastSaved.set(key, json);
      } catch (e) {
        await conn.rollback();
        throw e;
      }
    }
  } finally {
    conn.release();
  }
}

/** Wait for pending MySQL writes. No-op for the JSON driver. */
function flush() {
  if (!pool) return Promise.resolve();
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  flushing = flushing.then(flushNow);
  return flushing;
}

function save(db) {
  if (DRIVER === 'mysql') {
    currentDb = db;
    if (!pool || flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushing = flushing.then(flushNow).catch((e) => console.error('[db] MySQL write failed:', e.message));
    }, 150);
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

async function close() {
  await flush();
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { load, save, init, flush, close, uid, sha256, hashPassword, verifyPassword, driver: DRIVER };
