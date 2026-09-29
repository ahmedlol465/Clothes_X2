/** File-backed store: users, wardrobe, outfits, events, planner, shop, ai usage. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
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
  return {
    users: [
      {
        id: 'u_demo', name: 'Karim Hassan', email: 'karim@fashiontech.com',
        passwordHash: sha256('wardrobe2024'), createdAt: new Date().toISOString(),
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
    wearEvents: [],
    feedback: [],
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

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch { /* fall through to seed */ }
  const db = seed();
  save(db);
  return db;
}

function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

module.exports = { load, save, uid, sha256 };
