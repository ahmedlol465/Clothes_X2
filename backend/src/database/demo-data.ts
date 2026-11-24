/**
 * Demo dataset.
 *
 * This is the old `backend/data/db.json` + `lib/data/mock_data.dart` content,
 * moved into TypeORM seed data so the app has one source of truth: the
 * database. Nothing here is read at request time; `seed.service.ts` inserts it
 * once (on boot for an empty DB, or explicitly via `npm run seed`).
 *
 * IDs are deterministic UUIDs so outfits can reference items and re-running
 * the seeder is safe.
 */

export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_WARDROBE_ID = '00000000-0000-4000-8000-000000000002';
export const DEMO_STYLE_PROFILE_ID = '00000000-0000-4000-8000-000000000701';
export const DEMO_USER_PROFILE_ID = '00000000-0000-4000-8000-000000000702';
export const DEMO_STYLE_MEMORY_ID = '00000000-0000-4000-8000-000000000703';

/** Existing demo credentials. The auth service upgrades the legacy SHA-256 hash on first login. */
export const DEMO_EMAIL = 'karim@fashiontech.com';
export const DEMO_PASSWORD = 'wardrobe2024';

export interface DemoWardrobeItem {
  id: string;
  name: string;
  image: string;
  category: string;
  color: string;
  style: string;
  material: string;
  season: string;
  formality: string;
  pattern: string;
  brand: string;
  timesWorn: number;
  lastWornLabel: string;
}

export interface DemoOutfit {
  id: string;
  name: string;
  image: string;
  occasion: string;
  match: number;
  pieces: string[];
  itemIds: string[];
  favorite?: boolean;
}

export interface DemoPlanDay {
  weekday: string;
  date: string;
  occasion: string;
  outfitName: string;
  image: string;
  outfitId: string;
  isToday?: boolean;
}

export interface DemoProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  reason: string;
  category: string;
}

const item = (
  id: string,
  name: string,
  image: string,
  category: string,
  color: string,
  style: string,
  material: string,
  season: string,
  formality: string,
  pattern: string,
  brand: string,
  timesWorn: number,
  lastWornLabel: string,
): DemoWardrobeItem => ({
  id,
  name,
  image,
  category,
  color,
  style,
  material,
  season,
  formality,
  pattern,
  brand,
  timesWorn,
  lastWornLabel,
});

/** Same twelve garments the UI used to bundle in `MockData.wardrobe`. */
export const DEMO_WARDROBE: DemoWardrobeItem[] = [
  item('00000000-0000-4000-8000-000000000101', 'Oxford Cotton Shirt', 'assets/images/item_shirt_white_soft.jpg', 'Tops', 'White', 'Casual', '100% Cotton', 'Spring / Summer', 'Casual / Semi-Formal', 'Plain', 'SmartWardrobe', 19, 'Worn 4 days ago'),
  item('00000000-0000-4000-8000-000000000102', 'Raw Denim Jeans', 'assets/images/item_jeans_denim_folded.jpg', 'Bottoms', 'Indigo', 'Raw Indigo', '100% Cotton', 'All Season', 'Casual', 'Plain', '', 12, 'Worn 1 week ago'),
  item('00000000-0000-4000-8000-000000000103', 'Beige Knit Sweater', 'assets/images/sweater_beige_cable.jpg', 'Tops', 'Beige', 'Smart Casual', 'Merino Wool', 'Autumn / Winter', 'Smart Casual', 'Cable', '', 14, 'Worn 6 days ago'),
  item('00000000-0000-4000-8000-000000000104', 'Minimalist Sneakers', 'assets/images/sneakers_minimal.jpg', 'Shoes', 'White', 'Minimal', 'Leather', 'All Season', 'Casual', 'Plain', '', 17, 'Worn 2 days ago'),
  item('00000000-0000-4000-8000-000000000105', 'Linen Summer Blazer', 'assets/images/blazer_beige_studio.jpg', 'Outerwear', 'Beige', 'Smart Casual', 'Linen Blend', 'Spring / Summer', 'Smart Casual', 'Plain', '', 9, 'Worn 3 days ago'),
  item('00000000-0000-4000-8000-000000000106', 'Minimalist Leather Belt', 'assets/images/accessory_belt_tan.jpg', 'Accessories', 'Tan', 'Minimal', 'Full Grain Leather', 'All Season', 'Casual / Formal', 'Plain', '', 21, 'Worn yesterday'),
  item('00000000-0000-4000-8000-000000000107', 'Suede Jacket', 'assets/images/jacket_suede.jpg', 'Outerwear', 'Dark Brown', 'Vintage', 'Suede', 'Autumn / Winter', 'Casual', 'Plain', '', 24, 'Worn 2 days ago'),
  item('00000000-0000-4000-8000-000000000108', 'Leather Loafers', 'assets/images/shoes_brown_loafers.jpg', 'Shoes', 'Brown', 'Classic', 'Leather', 'Spring / Summer', 'Formal', 'Plain', '', 11, 'Worn 5 days ago'),
  item('00000000-0000-4000-8000-000000000109', 'Tailored Trousers', 'assets/images/item_trousers_grey.jpg', 'Bottoms', 'Charcoal', 'Modern', 'Wool Blend', 'Autumn / Winter', 'Formal', 'Plain', '', 8, 'Worn 1 week ago'),
  item('00000000-0000-4000-8000-000000000110', 'Silk Scarf', 'assets/images/accessory_scarf_silk.jpg', 'Accessories', 'Multicolor', 'Elegant', 'Silk', 'All Season', 'Elegant', 'Floral', '', 0, 'Unworn for 60+ days'),
  item('00000000-0000-4000-8000-000000000111', 'Beige Chinos', 'assets/images/item_chinos_beige.jpg', 'Bottoms', 'Beige', 'Smart Casual', 'Cotton Twill', 'Spring / Summer', 'Smart Casual', 'Plain', '', 15, 'Worn 3 days ago'),
  item('00000000-0000-4000-8000-000000000112', 'Navy Wool Blazer', 'assets/images/blazer_navy_hanger.jpg', 'Outerwear', 'Navy', 'Formal', 'Wool', 'Autumn / Winter', 'Formal', 'Plain', '', 6, 'Worn 2 weeks ago'),
];

export const DEMO_OUTFITS: DemoOutfit[] = [
  { id: '00000000-0000-4000-8000-000000000201', name: 'University Casual', image: 'assets/images/outfit_university_casual.jpg', occasion: 'Academics', match: 92, pieces: ['White Tee', 'Raw Denim', 'Sneakers'], itemIds: ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000104'] },
  { id: '00000000-0000-4000-8000-000000000202', name: 'Formal Dinner', image: 'assets/images/outfit_formal_dinner.jpg', occasion: 'Formal', match: 89, pieces: ['Navy Suit', 'White Shirt', 'Oxfords'], itemIds: ['00000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000108'] },
  { id: '00000000-0000-4000-8000-000000000203', name: 'Weekend Chillout', image: 'assets/images/flatlay_denim_knit.jpg', occasion: 'Leisure', match: 95, pieces: ['Denim', 'Knit', 'Loafers'], itemIds: ['00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000108'], favorite: true },
  { id: '00000000-0000-4000-8000-000000000204', name: 'Date Night Elite', image: 'assets/images/outfit_date_night_elite.jpg', occasion: 'Elegant', match: 88, pieces: ['Black Shirt', 'Tailored Trousers'], itemIds: ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000109'], favorite: true },
  { id: '00000000-0000-4000-8000-000000000205', name: 'Weekend Brunch', image: 'assets/images/outfit_travel_backpack.jpg', occasion: 'Social Gathering', match: 90, pieces: ['Knit Sweater', 'Chinos', 'Sneakers'], itemIds: ['00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000104'] },
  { id: '00000000-0000-4000-8000-000000000206', name: 'Smart Meeting', image: 'assets/images/outfit_smart_meeting.jpg', occasion: 'Presentation', match: 93, pieces: ['Navy Blazer', 'White Shirt', 'Tailored Trousers', 'Loafers'], itemIds: ['00000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000109', '00000000-0000-4000-8000-000000000108'] },
];

export const DEMO_FEEDBACK = [
  {
    id: '00000000-0000-4000-8000-000000000801',
    outfitId: '00000000-0000-4000-8000-000000000201',
    rating: 5,
    comment: '',
  },
];

export const DEMO_EVENTS = [
  {
    id: '00000000-0000-4000-8000-000000000301',
    title: 'University Presentation',
    startsAtRaw: 'Tomorrow • 10:00 AM',
    eventType: 'presentation',
    location: 'Campus Hall B',
    dressCode: 'Smart Casual',
  },
  {
    id: '00000000-0000-4000-8000-000000000302',
    title: 'Dinner with Friends',
    startsAtRaw: 'Fri • 8:00 PM',
    eventType: 'social',
    location: 'Downtown',
    dressCode: 'Smart Casual',
  },
];

export const DEMO_WEEKLY_PLAN: DemoPlanDay[] = [
  { weekday: 'Mon', date: '25', occasion: 'University Lectures', outfitName: 'Classic Oxford Style', image: 'assets/images/outfit_flatlay_beige.jpg', outfitId: '00000000-0000-4000-8000-000000000201' },
  { weekday: 'Tue', date: '26', occasion: 'Coffee with Mia', outfitName: 'Soft Weekend Layers', image: 'assets/images/outfit_university_casual.jpg', outfitId: '00000000-0000-4000-8000-000000000201' },
  { weekday: 'Wed', date: '27', occasion: 'Team Project Presentation', outfitName: 'Modern Business Casual', image: 'assets/images/outfit_modern_business.jpg', outfitId: '00000000-0000-4000-8000-000000000202', isToday: true },
  { weekday: 'Thu', date: '28', occasion: 'Group Study', outfitName: 'Easy Campus Casual', image: 'assets/images/outfit_university_casual.jpg', outfitId: '00000000-0000-4000-8000-000000000201' },
  { weekday: 'Fri', date: '29', occasion: 'Dinner with Friends', outfitName: 'Elevated Evening Minimal', image: 'assets/images/outfit_date_night_elite.jpg', outfitId: '00000000-0000-4000-8000-000000000204' },
  { weekday: 'Sat', date: '30', occasion: 'Farmers Market', outfitName: 'Relaxed Weekend', image: 'assets/images/outfit_travel_backpack.jpg', outfitId: '00000000-0000-4000-8000-000000000203' },
  { weekday: 'Sun', date: '1', occasion: 'Rest Day', outfitName: 'Lounge Comfort', image: 'assets/images/flatlay_denim_knit.jpg', outfitId: '00000000-0000-4000-8000-000000000203' },
];

export const DEMO_PRODUCTS: DemoProduct[] = [
  { id: '00000000-0000-4000-8000-000000000401', name: 'White Formal Shirt', price: 65, image: 'assets/images/item_shirt_white_cream.jpg', reason: 'You own 4 casual jackets but no formal white shirt to pair them with for events.', category: 'Tops' },
  { id: '00000000-0000-4000-8000-000000000402', name: 'Black Oxford Shoes', price: 120, image: 'assets/images/shoes_black_loafers.jpg', reason: 'Your wardrobe lacks formal footwear. These complete 6 smart outfit gaps.', category: 'Shoes' },
  { id: '00000000-0000-4000-8000-000000000403', name: 'Navy Blazer', price: 180, image: 'assets/images/blazer_navy_hanger.jpg', reason: 'Highly versatile. Can layer with all your existing white t-shirts and trousers.', category: 'Outerwear' },
];

export const DEMO_TRENDS = [
  { id: '00000000-0000-4000-8000-000000000501', name: 'Minimal Summer', tag: 'Monochrome & light fabrics', image: 'assets/images/trend_minimal_summer.jpg', sortOrder: 0 },
  { id: '00000000-0000-4000-8000-000000000502', name: 'Smart Casual', tag: 'Blazers paired with denim', image: 'assets/images/trend_smart_casual.jpg', sortOrder: 1 },
];

export const DEMO_COMMUNITY_LOOKS = [
  { id: '00000000-0000-4000-8000-000000000601', name: 'Urban Explorer', likes: 1200, image: 'assets/images/community_urban_explorer.jpg', sortOrder: 0 },
  { id: '00000000-0000-4000-8000-000000000602', name: 'Classic Minimal', likes: 920, image: 'assets/images/community_classic_minimal.jpg', sortOrder: 1 },
  { id: '00000000-0000-4000-8000-000000000603', name: 'Earth Tone Layers', likes: 1840, image: 'assets/images/community_green_sweater.jpg', sortOrder: 2 },
  { id: '00000000-0000-4000-8000-000000000604', name: 'Soft Neutrals', likes: 760, image: 'assets/images/flatlay_cream_bag.jpg', sortOrder: 3 },
];

export const DEMO_STYLE_DNA = {
  archetype: 'Classic Minimalist',
  dimensions: {
    minimalism: 0.82,
    streetwear: 0.24,
    formalityBias: 0.61,
    colorPreference: 0.74,
    patternTolerance: 0.35,
    layeringPreference: 0.58,
    riskTaking: 0.42,
    segments: [
      { label: 'Casual', share: 45 },
      { label: 'Smart Casual', share: 30 },
      { label: 'Formal', share: 15 },
      { label: 'Sporty', share: 10 },
    ],
    legacyStyleMemories: [
      {
        userId: DEMO_USER_ID,
        colors: { black: 0.72, white: 0.68, blue: 0.61, beige: 0.58, navy: 0.45 },
        styles: { casual: 0.66, 'smart casual': 0.62, minimalist: 0.74, formal: 0.52 },
        occasions: { casual: 0.55, formal: 0.45 },
        fabrics: {},
        adjustments: {},
        avoid: ['sneakers'],
        facts: [
          { text: 'never wears sneakers', at: '2026-09-29T13:08:16.411Z', confidence: 0.6 },
          { text: 'wants more casual looks', at: '2026-09-29T14:10:59.418Z', confidence: 0.6 },
          { text: 'likes navy', at: '2026-09-29T13:51:25.742Z', confidence: 0.6 },
        ],
        itemRatings: {},
        totals: { ratings: 1, chats: 3 },
        updatedAt: '2026-11-16T11:53:48.306Z',
      },
    ],
  },
  palette: [
    { name: 'Black', hex: '#1E1C1A', count: 38 },
    { name: 'White', hex: '#FFFFFF', count: 31 },
    { name: 'Blue', hex: '#3D5A80', count: 22 },
    { name: 'Beige', hex: '#E0CDAF', count: 19 },
  ],
  categoryMix: [
    { name: 'T-Shirts', count: 18 },
    { name: 'Jeans', count: 12 },
    { name: 'Sneakers', count: 8 },
  ],
  evolution: [
    { month: 'Apr', score: 0.18 },
    { month: 'May', score: 0.52 },
    { month: 'Jun', score: 0.38 },
    { month: 'Jul', score: 0.86 },
    { month: 'Aug', score: 0.55 },
    { month: 'Sep', score: 0.68 },
  ],
  overallConfidence: 0.88,
};
