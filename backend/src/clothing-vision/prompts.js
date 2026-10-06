/**
 * Zero-shot label vocabulary for the local fashion model (§9 AI PIPELINE).
 *
 * Everything the pipeline can say about an item is declared here, once, as
 * plain prompt phrases. No invented metadata, no filename regexes: if a label is
 * not in this file the pipeline cannot produce it.
 *
 * Two things matter for honest output:
 *
 *   1. Each canonical value owns several phrasings. CLIP responds to wording,
 *      so one phrasing per class makes the result a property of the sentence
 *      rather than of the garment. Averaging normalised embeddings across
 *      phrasings (and across templates) gives a per-value centroid that is far
 *      steadier than any single prompt.
 *
 *   2. The non-clothing bank is grouped into coarse classes for exactly the
 *      same reason, and grouped no finer than the clothing bank. The gate
 *      compares a clothing centroid against a non-clothing centroid, so both
 *      sides of that comparison must have comparable granularity or the wider
 *      bank simply wins the max by having more members.
 *
 * Output vocabulary is aligned with `taxonomy.js` (HUE colour names,
 * OUTFIT_SLOTS categories, FORMALITY_SCALE) so nothing downstream has to
 * translate.
 *
 * Pure data. No I/O, no dependencies.
 */
'use strict';

/**
 * Prompt templates used to expand one value into several sentences.
 * The first group is for garment attributes; the second is deliberately shorter
 * because the non-clothing bank is large and only needs a stable centroid.
 */
const GARMENT_TEMPLATES = [
  'a photo of a {}.',
  'a photo of the {}.',
  'a close-up photo of a {}.',
  'a bright photo of a {}.',
  'a cropped photo of a {}.',
  'a product photo of a {}.',
  'a clothing catalog photo of a {}.',
  'a flat lay photo of a {}.',
];

const NEGATIVE_TEMPLATES = [
  'a photo of a {}.',
  'a photo of the {}.',
  'a close-up photo of a {}.',
  'a product photo of a {}.',
];

/**
 * Fine-grained garment classes. `category` is the coarse slot the rest of the
 * app uses (OUTFIT_SLOTS); `subcategory` is what a shopper would call it.
 */
const GARMENTS = [
  { subcategory: 'T-Shirt', category: 'Tops', phrases: ['t-shirt', 't shirt', 'tee shirt', 'plain cotton t-shirt'] },
  { subcategory: 'Shirt', category: 'Tops', phrases: ['dress shirt', 'button up shirt', 'collared shirt', 'floral shirt', 'oxford shirt'] },
  { subcategory: 'Polo Shirt', category: 'Tops', phrases: ['polo shirt'] },
  { subcategory: 'Blouse', category: 'Tops', phrases: ['blouse', 'silk blouse'] },
  { subcategory: 'Tank Top', category: 'Tops', phrases: ['tank top', 'sleeveless top', 'camisole'] },
  { subcategory: 'Sweater', category: 'Tops', phrases: ['sweater', 'knit sweater', 'cable knit sweater', 'wool sweater', 'jumper'] },
  { subcategory: 'Hoodie', category: 'Tops', phrases: ['hoodie', 'hooded sweatshirt'] },
  { subcategory: 'Cardigan', category: 'Tops', phrases: ['cardigan'] },
  { subcategory: 'Jacket', category: 'Outerwear', phrases: ['jacket', 'denim jacket', 'suede jacket', 'bomber jacket', 'varsity jacket', 'utility jacket'] },
  { subcategory: 'Blazer', category: 'Outerwear', phrases: ['blazer', 'blazer jacket on a hanger', 'tailored blazer', 'sports coat'] },
  { subcategory: 'Coat', category: 'Outerwear', phrases: ['coat', 'wool coat', 'trench coat', 'overcoat', 'parka', 'peacoat'] },
  { subcategory: 'Suit', category: 'Outerwear', phrases: ['a full two piece suit with both a jacket and matching trousers', 'a business suit with jacket and pants'] },
  {
    subcategory: 'Jeans',
    category: 'Bottoms',
    phrases: ['jeans', 'blue jeans', 'denim jeans', 'folded jeans', 'jeans with long legs'],
  },
  { subcategory: 'Chinos', category: 'Bottoms', phrases: ['chinos', 'khaki chinos', 'beige chinos', 'chino pants with long legs'] },
  { subcategory: 'Pants', category: 'Bottoms', phrases: ['dress pants', 'trousers', 'grey trousers', 'slacks', 'long trousers with full length legs'] },
  {
    subcategory: 'Shorts',
    category: 'Bottoms',
    phrases: ['shorts', 'khaki shorts', 'denim shorts', 'short pants that end above the knee'],
  },
  {
    subcategory: 'Skirt',
    category: 'Bottoms',
    phrases: ['skirt', 'denim skirt', 'mini skirt', 'pleated skirt', 'pencil skirt', 'a skirt with a waistband'],
  },
  { subcategory: 'Dress', category: 'Bottoms', phrases: ['dress', 'womens dress', 'maxi dress', 'little black dress', 'evening gown'] },
  { subcategory: 'Sneakers', category: 'Shoes', phrases: ['sneakers', 'running shoes', 'trainers', 'white sneakers'] },
  { subcategory: 'Dress Shoes', category: 'Shoes', phrases: ['dress shoes', 'oxford shoes', 'loafers', 'high heels', 'leather dress shoes'] },
  { subcategory: 'Boots', category: 'Shoes', phrases: ['boots', 'leather boots', 'ankle boots', 'chelsea boots'] },
  {
    subcategory: 'Belt',
    category: 'Accessories',
    phrases: ['leather belt', 'a leather belt with a buckle', 'black leather belt with a metal buckle', 'a brown leather strap belt', 'a belt buckle close up'],
  },
  { subcategory: 'Scarf', category: 'Accessories', phrases: ['scarf', 'silk scarf', 'wool scarf', 'square scarf', 'a neck scarf'] },
  { subcategory: 'Sunglasses', category: 'Accessories', phrases: ['sunglasses', 'a pair of sunglasses'] },
  { subcategory: 'Handbag', category: 'Accessories', phrases: ['handbag', 'tote bag', 'leather handbag', 'purse', 'backpack'] },
];

/**
 * Coarse non-clothing classes. Every entry is something a user could plausibly
 * photograph by mistake, or photograph *next to* the garment they meant.
 * Grouped, not per-item, so the gate compares like with like.
 */
const NON_CLOTHING = [
  { group: 'drinkware', phrases: ['glass water bottle', 'a plastic water bottle', 'a wine bottle', 'a coffee mug', 'a tea cup', 'a glass of water', 'a glass jar'] },
  { group: 'phone and tablet', phrases: ['smartphone', 'a tablet computer', 'a smartphone case', 'a charger cable'] },
  { group: 'computer equipment', phrases: ['laptop computer', 'desktop computer', 'computer keyboard', 'computer mouse', 'a monitor', 'a printer'] },
  { group: 'audio and tv equipment', phrases: ['a speaker', 'a television', 'a pair of headphones', 'remote control'] },
  { group: 'furniture', phrases: ['office chair', 'armchair', 'sofa', 'a bed', 'a wooden chair', 'a bookshelf', 'a coffee table'] },
  { group: 'tables and rooms', phrases: ['dining table', 'office desk', 'a room interior', 'a retail store interior', 'a kitchen', 'a bedroom'] },
  { group: 'vehicles', phrases: ['car', 'bicycle', 'motorcycle', 'an electric scooter'] },
  { group: 'other objects', phrases: ['a book', 'potted plant', 'food plate', 'a bowl of food', 'paper bag', 'cardboard box', 'shopping bag', 'a keyring', 'a credit card', 'a power adapter', 'a hand tool'] },
  { group: 'people and animals', phrases: ['a human face', 'a person', 'a full length photo of a model', 'a dog', 'a cat', 'a baby'] },
  { group: 'retail and marketing', phrases: ['a mannequin wearing clothes', 'a retail store sign', 'an advertising banner with text', 'a shop window display'] },
  { group: 'watches and small metal', phrases: ['a wristwatch on a wrist', 'a watch face', 'a metal bracelet', 'a coin'] },
  { group: 'toys and appliances', phrases: ['a toy robot', 'hair dryer', 'perfume bottle', 'a hairdryer brush', 'an electric toothbrush', 'a coffee machine'] },
];

/** Style labels, aligned with the values already stored on wardrobe items. */
const STYLES = [
  { value: 'Casual', phrases: ['a casual everyday outfit', 'a relaxed weekend look'] },
  { value: 'Smart Casual', phrases: ['a smart casual outfit', 'an office casual look'] },
  { value: 'Formal', phrases: ['a formal business outfit', 'a workwear office look'] },
  { value: 'Elegant', phrases: ['an elegant evening look', 'a refined sophisticated look'] },
  { value: 'Sporty', phrases: ['a sporty activewear outfit', 'an athleisure gym look'] },
  { value: 'Streetwear', phrases: ['a streetwear outfit', 'an urban skate look'] },
  { value: 'Preppy', phrases: ['a preppy collegiate look'] },
  { value: 'Boho', phrases: ['a bohemian boho look'] },
  { value: 'Minimal', phrases: ['a minimalist monochrome look'] },
  { value: 'Vintage', phrases: ['a vintage retro look'] },
];

/** Season labels. 'All Season' is the honest answer for a plain mid-layer. */
const SEASONS = [
  { value: 'Spring / Summer', phrases: ['a light garment for hot summer weather', 'a breathable summer piece'] },
  { value: 'Autumn / Winter', phrases: ['a thick warm garment for cold winter weather', 'a heavy insulated winter piece'] },
  { value: 'All Season', phrases: ['a mid weight garment for mild weather', 'a layer you can wear all year round'] },
];

/** Print labels. `Plain` is the default, and the model is allowed to say it. */
const PATTERNS = [
  { value: 'Plain', phrases: ['a solid colour garment', 'a plain garment with no print'] },
  { value: 'Striped', phrases: ['a striped garment', 'a garment with horizontal stripes'] },
  { value: 'Checked', phrases: ['a plaid or checkered garment', 'a garment with a tartan check pattern'] },
  { value: 'Floral', phrases: ['a floral print garment', 'a garment with a flower print'] },
  { value: 'Polka Dot', phrases: ['a garment with polka dots'] },
  { value: 'Graphic Print', phrases: ['a garment with a graphic print or logo', 'a printed slogan t-shirt'] },
  { value: 'Camo', phrases: ['a camouflage print garment'] },
  { value: 'Colour Blocked', phrases: ['a colour blocked garment with large blocks of colour'] },
];

/**
 * Fabric labels. Reported as `material` only when the model separates it
 * clearly; otherwise the pipeline omits the field rather than guessing.
 */
const MATERIALS = [
  { value: 'Cotton', phrases: ['a cotton garment', 'a plain cotton t-shirt'] },
  { value: 'Denim', phrases: ['a denim garment', 'blue jeans made of denim'] },
  { value: 'Leather', phrases: ['a leather garment', 'a smooth leather jacket'] },
  { value: 'Suede', phrases: ['a suede garment', 'a garment with a soft brushed suede finish'] },
  { value: 'Wool', phrases: ['a wool garment', 'a wool blend coat'] },
  { value: 'Knit', phrases: ['a knitted garment', 'a chunky knit jumper'] },
  { value: 'Silk', phrases: ['a silk garment', 'a shiny silk scarf'] },
  { value: 'Linen', phrases: ['a linen garment', 'a light linen shirt'] },
  { value: 'Nylon', phrases: ['a nylon garment', 'a shiny synthetic nylon jacket'] },
  { value: 'Polyester', phrases: ['a polyester garment', 'a smooth synthetic polyester shirt'] },
];

/**
 * Gate thresholds.
 *
 * Tuned on the bundled `assets/images` set plus a non-clothing fixture set; see
 * `scripts/vision-selftest.js`, which prints the raw signals so the margin
 * between the two populations stays visible instead of becoming folklore.
 *
 * `clothingMargin` is the cosine gap between the best clothing centroid and the
 * best non-clothing centroid. `clothingMass` is the softmax share of the whole
 * label space taken by clothing centroids. Both must clear their floor.
 */
const GATE = {
  logitScale: 100,
  clothingMargin: 0.01,
  clothingMass: 0.4,
  // Below this top-class share the attribute is reported but flagged uncertain.
  attributeFloor: 0.5,
  // A runner-up holding at least this share means two classes are live, so the
  // winner is reported as a tie rather than a fact.
  tieShare: 0.2,
};

/** Model id + licence note, surfaced by GET /admin/system-health. */
const MODEL = {
  id: 'Marqo/marqo-fashionCLIP',
  licence: 'Apache-2.0',
  dtype: 'q8',
  embeddingDim: 512,
};

module.exports = {
  GARMENT_TEMPLATES,
  NEGATIVE_TEMPLATES,
  GARMENTS,
  NON_CLOTHING,
  STYLES,
  SEASONS,
  PATTERNS,
  MATERIALS,
  GATE,
  MODEL,
};