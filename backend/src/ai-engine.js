/**
 * SmartWardrobe AI engine (§9 AI/ML pipeline).
 *
 * Pure-JS port of the rule + heuristic scoring described in the spec:
 *   USER REQUEST → CONTEXT ENGINE → WARDROBE FILTER → CANDIDATE OUTFITS
 *   → COMPATIBILITY ENGINE → PERSONALIZATION → RANKING → EXPLANATION
 *   → OUTFIT → USER FEEDBACK → LEARNING (StyleMemory)
 *
 * The Python FastAPI service (ai-service/) mirrors this logic. The Node
 * backend uses this embedded copy so the app runs with `npm start` only.
 * Set AI_SERVICE_URL to proxy /ai/* to the FastAPI service instead.
 */
'use strict';

const COLOR_FAMILIES = {
  white: 'neutral', black: 'neutral', grey: 'neutral', gray: 'neutral',
  beige: 'neutral', tan: 'neutral', cream: 'neutral', charcoal: 'neutral',
  navy: 'cool', blue: 'cool', indigo: 'cool', green: 'cool', teal: 'cool',
  brown: 'warm', 'dark brown': 'warm', beige2: 'warm', olive: 'warm',
  red: 'bold', burgundy: 'bold', mustard: 'bold', multicolor: 'bold',
};

function colorFamily(color = '') {
  const c = String(color).toLowerCase();
  for (const [k, v] of Object.entries(COLOR_FAMILIES)) {
    if (c.includes(k)) return v;
  }
  return 'neutral';
}

function colorHarmony(items) {
  if (items.length < 2) return 90;
  const fams = items.map((i) => colorFamily(i.color));
  const uniq = new Set(fams);
  if (uniq.size === 1) return 96; // tonal / monochrome
  if (uniq.has('bold') && uniq.size > 2) return 74;
  if (uniq.has('bold') && uniq.has('warm') && uniq.has('cool')) return 78;
  if (uniq.size === 2) return 90;
  return 84;
}

function styleCompat(items) {
  const styles = items.map((i) => String(i.style || '').toLowerCase());
  const uniq = new Set(styles);
  if (uniq.size === 1) return 94;
  const formal = styles.filter((s) => s.includes('formal')).length;
  const casual = styles.filter((s) => s.includes('casual') || s.includes('minimal') || s.includes('modern')).length;
  if (formal > 0 && casual > 0 && uniq.size > 2) return 78;
  if (uniq.size === 2) return 88;
  return 84;
}

function occasionFit(items, occasion = '') {
  const occ = occasion.toLowerCase();
  const wantsFormal = /formal|dinner|wedding|meeting|presentation|office|business/.test(occ);
  const wantsCasual = /casual|university|leisure|weekend|chill|travel|gym|sport/.test(occ);
  const wantsElegant = /elegant|date|evening|party/.test(occ);
  if (!wantsFormal && !wantsCasual && !wantsElegant) return 88;
  let score = 86;
  for (const it of items) {
    const f = String(it.formality || '').toLowerCase();
    if (wantsFormal && /formal|elegant|smart/.test(f)) score += 2;
    else if (wantsCasual && /casual|minimal|smart/.test(f)) score += 2;
    else if (wantsElegant && /elegant|formal|smart/.test(f)) score += 2;
    else score -= 2;
  }
  return clamp(Math.round(score), 60, 97);
}

function weatherFit(items, weather = {}) {
  const temp = Number(weather.tempC ?? 24);
  let score = 90;
  for (const it of items) {
    const season = String(it.season || '').toLowerCase();
    const warmth = String(it.warmth || it.material || '').toLowerCase();
    if (temp >= 26) {
      if (/winter|wool|suede|fleece/.test(season + warmth)) score -= 6;
      if (/summer|linen|cotton/.test(season + warmth)) score += 1;
    } else if (temp <= 14) {
      if (/summer|linen/.test(season) && !/winter|autumn/.test(season)) score -= 5;
      if (/winter|wool|sweater|jacket|blazer|outerwear/.test(season + warmth + (it.category || ''))) score += 1;
    }
  }
  return clamp(Math.round(score), 60, 97);
}

function personalTaste(items, styleProfile = {}) {
  const favColors = (styleProfile.favoriteColors || []).map((c) => String(c).toLowerCase());
  const favStyles = (styleProfile.preferredStyles || []).map((s) => String(s).toLowerCase());
  if (!favColors.length && !favStyles.length) return 88;
  let hits = 0, total = 0;
  for (const it of items) {
    total += 2;
    if (favColors.some((c) => String(it.color || '').toLowerCase().includes(c))) hits += 1;
    if (favStyles.some((s) => String(it.style || '').toLowerCase().includes(s))) hits += 1;
  }
  return clamp(Math.round(78 + (hits / Math.max(1, total)) * 18), 60, 97);
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function calculateCompatibility(items, ctx = {}) {
  const breakdown = [
    { label: 'Color Harmony', value: colorHarmony(items) },
    { label: 'Style Compatibility', value: styleCompat(items) },
    { label: 'Occasion Fit', value: occasionFit(items, ctx.occasion || '') },
    { label: 'Weather Match', value: weatherFit(items, ctx.weather || {}) },
    { label: 'Personal Taste', value: personalTaste(items, ctx.styleProfile || {}) },
  ];
  const weights = [0.24, 0.22, 0.22, 0.16, 0.16];
  const match = Math.round(breakdown.reduce((a, b, i) => a + b.value * weights[i], 0));
  return { match, breakdown };
}

function explainOutfit(items, ctx, compat) {
  const names = items.map((i) => i.name).join(' + ');
  const colors = [...new Set(items.map((i) => i.color))].join(' / ');
  const bits = [];
  const ch = compat.breakdown[0].value;
  if (ch >= 88) bits.push(`neutral ${colors} palette keeps everything balanced`);
  else bits.push(`${colors} tones are mixed for contrast`);
  const occ = (ctx.occasion || 'your day').toLowerCase();
  bits.push(`the ${items.map((i) => i.category.toLowerCase()).join(' / ')} mix suits ${occ}`);
  if (ctx.weather && ctx.weather.tempC != null) {
    bits.push(ctx.weather.tempC >= 26 ? 'lightweight fabrics handle the warmth' : 'layering handles the temperature');
  }
  return `${names} work together because ${bits.join(' and ')}. Compatibility ${compat.match}%.`;
}

function pickByCategory(items, categories) {
  for (const c of categories) {
    const found = items.find((i) => String(i.category).toLowerCase() === c);
    if (found) return found;
  }
  return null;
}

/** Generate up to `count` ranked outfits from wardrobe items. */
function generateOutfits(wardrobe, opts = {}) {
  const occasion = opts.occasion || 'casual';
  const weather = opts.weather || { tempC: 24, condition: 'partly cloudy' };
  const styleProfile = opts.styleProfile || {};
  const count = Math.min(6, Math.max(1, Number(opts.count) || 3));
  const anchorId = opts.anchorItemId;
  const excludeIds = new Set(opts.excludeIds || []);

  let pool = wardrobe.filter((i) => !excludeIds.has(i.id) && !i.archived);
  if (!pool.length) return [];

  // Context filter: drop heavy winter layers on hot days and vice versa.
  const temp = Number(weather.tempC ?? 24);
  pool = pool.filter((i) => {
    const s = String(i.season || '').toLowerCase();
    if (temp >= 28 && /winter/.test(s) && !/all season/.test(s)) return false;
    return true;
  });
  if (!pool.length) pool = wardrobe.filter((i) => !excludeIds.has(i.id));

  const tops = pool.filter((i) => /top/i.test(i.category));
  const bottoms = pool.filter((i) => /bottom/i.test(i.category));
  const shoes = pool.filter((i) => /shoe/i.test(i.category));
  const outer = pool.filter((i) => /outerwear/i.test(i.category));
  const acc = pool.filter((i) => /accessor/i.test(i.category));

  const combos = [];
  const anchor = anchorId ? pool.find((i) => i.id === anchorId) : null;

  const topList = tops.length ? tops : pool.slice(0, 4);
  const bottomList = bottoms.length ? bottoms : pool.slice(0, 4);
  const shoeList = shoes.length ? shoes : pool.slice(0, 3);

  outerLoop:
  for (const t of topList) {
    for (const b of bottomList) {
      if (t.id === b.id) continue;
      for (const s of shoeList) {
        if (s.id === t.id || s.id === b.id) continue;
        const pieces = [t, b, s];
        if (anchor && !pieces.some((p) => p.id === anchor.id)) {
          // force anchor in when requested (swap shoes for anchor if needed)
          if (/outerwear|accessor|top|bottom|shoe/i.test(anchor.category)) {
            pieces[2] = anchor;
          } else continue;
        }
        // Optionally add outerwear on cool days / formal occasions.
        if ((temp <= 20 || /formal|meeting|dinner|evening/.test(occasion.toLowerCase())) && outer.length) {
          const o = outer.find((x) => ![t.id, b.id, s.id].includes(x.id));
          if (o && pieces.length < 4) pieces.push(o);
        }
        const compat = calculateCompatibility(pieces, { occasion, weather, styleProfile });
        combos.push({ pieces, ...compat, explanation: explainOutfit(pieces, { occasion, weather }, compat) });
        if (combos.length >= 24) break outerLoop;
      }
    }
  }

  combos.sort((a, b) => b.match - a.match);
  const seen = new Set();
  const ranked = [];
  for (const c of combos) {
    const key = c.pieces.map((p) => p.id).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push(c);
    if (ranked.length >= count) break;
  }
  return ranked.map((c, idx) => ({
    id: `gen-${Date.now()}-${idx}`,
    name: outfitName(c.pieces, occasion),
    occasion,
    match: c.match,
    breakdown: c.breakdown,
    explanation: c.explanation,
    itemIds: c.pieces.map((p) => p.id),
    pieces: c.pieces.map((p) => p.name),
    items: c.pieces,
  }));
}

function outfitName(pieces, occasion) {
  const has = (re) => pieces.some((p) => re.test(`${p.name} ${p.style} ${p.category}`));
  if (/formal|dinner|meeting/i.test(occasion) && has(/blazer|trouser|suit/i)) return 'Polished Evening Look';
  if (/date|evening/i.test(occasion)) return 'Date Night Elite';
  if (/university|casual/i.test(occasion)) return 'Campus Casual Combo';
  if (/travel/i.test(occasion)) return 'Travel Capsule Look';
  if (has(/blazer/i)) return 'Smart Layered Outfit';
  if (has(/sweater|knit/i)) return 'Soft Knit Layers';
  return 'Classic Minimalist Outfit';
}

/** Wardrobe-aware chat: intent parsing + function-calling style outfit attach. */
function chatReply(message, ctx = {}) {
  const q = String(message || '').toLowerCase();
  const wardrobe = ctx.wardrobe || [];
  const weather = ctx.weather || { tempC: 24, condition: 'partly cloudy' };

  const pickOutfit = (occasion) => {
    const gen = generateOutfits(wardrobe, { occasion, weather, styleProfile: ctx.styleProfile, count: 1 });
    return gen[0] || null;
  };

  if (/(hate|don't like|dont like).*shoe|hate these shoes/.test(q)) {
    const shoeIds = wardrobe.filter((i) => /shoe/i.test(i.category)).map((i) => i.id);
    const gen = generateOutfits(wardrobe, {
      occasion: detectOccasion(q) || 'casual', weather,
      styleProfile: ctx.styleProfile, excludeIds: shoeIds.slice(0, 1), count: 1,
    });
    return { text: 'Got it — swapping the shoes out. Here is a version without that pair:', outfit: gen[0] || null };
  }
  if (/haven.?t worn|not worn|unworn|new/i.test(q)) {
    const sorted = [...wardrobe].sort((a, b) => (a.timesWorn || 0) - (b.timesWorn || 0));
    const anchor = sorted[0];
    const gen = anchor
      ? generateOutfits(wardrobe, { occasion: detectOccasion(q) || 'casual', weather, styleProfile: ctx.styleProfile, anchorItemId: anchor.id, count: 1 })
      : [];
    return {
      text: anchor
        ? `Let's rotate in your least-worn piece — the ${anchor.name} (worn ${anchor.timesWorn || 0}×). I built an outfit around it:`
        : 'Add a few pieces to your wardrobe and I will rotate the unworn ones in.',
      outfit: gen[0] || null,
    };
  }
  if (/less formal|more casual|casual version/.test(q)) {
    const gen = generateOutfits(wardrobe, { occasion: 'casual', weather, styleProfile: ctx.styleProfile, count: 1 });
    return { text: 'Here is a more relaxed take with the same palette:', outfit: gen[0] || null };
  }
  if (/more formal|formal version|dress (it )?up/.test(q)) {
    const gen = generateOutfits(wardrobe, { occasion: 'formal dinner', weather, styleProfile: ctx.styleProfile, count: 1 });
    return { text: 'Dressed up — blazer and smarter shoes dial up the formality:', outfit: gen[0] || null };
  }
  if (/wear.*(blue|white|beige|black|navy|brown|grey|gray|green)/.test(q) || /i want to wear/.test(q)) {
    const colorMatch = q.match(/blue|white|beige|black|navy|brown|grey|gray|green|tan|charcoal|indigo/);
    const anchor = colorMatch && wardrobe.find((i) => String(i.color || '').toLowerCase().includes(colorMatch[0]));
    if (anchor) {
      const gen = generateOutfits(wardrobe, { occasion: detectOccasion(q) || 'casual', weather, styleProfile: ctx.styleProfile, anchorItemId: anchor.id, count: 1 });
      return { text: `Anchoring on your ${anchor.name} — here's a ${gen[0]?.match ?? 90}% match built around it:`, outfit: gen[0] || null };
    }
  }
  if (/date/.test(q)) {
    const o = pickOutfit('date night');
    return { text: `Date night calls for something sharper. ${o ? `Try ${o.pieces.join(' + ')} — ${o.match}% match for an elegant evening.` : 'Add evening pieces to unlock a sharper look.'}`, outfit: o };
  }
  if (/formal|interview|wedding|meeting|presentation/.test(q)) {
    const o = pickOutfit('formal dinner');
    return { text: `For formal moments I'd suggest ${o ? o.pieces.join(' + ') + ` (${o.match}% match). Polished without feeling stiff.` : 'a blazer + tailored trousers combo.'}`, outfit: o };
  }
  if (/weather|hot|cold|rain|temperature/.test(q)) {
    const o = pickOutfit(detectOccasion(q) || 'casual');
    return { text: `It's ${weather.tempC}°C and ${weather.condition} — lightweight layers are ideal. ${o ? `Try ${o.pieces.join(' + ')}.` : ''}`, outfit: o };
  }
  if (/travel|trip|pack|dubai|flight/.test(q)) {
    return { text: 'For a capsule trip, pack the White Oxford Shirt, Beige Knit Sweater, Raw Denim, Beige Chinos, Minimalist Sneakers and the Silk Scarf — that gives you seven distinct outfits from six pieces.', outfit: pickOutfit('travel') };
  }
  if (/universit|college|school|class|lecture/.test(q) || /what.*wear|dress me|build me|suggest|outfit/.test(q)) {
    const o = pickOutfit(detectOccasion(q) || 'university casual');
    return {
      text: o
        ? `Based on your wardrobe and today's weather (${weather.tempC}°C, ${weather.condition}), I recommend: ${o.pieces.join(' + ')} (${o.match}% match).`
        : 'Add clothes to your wardrobe and I will build outfits from them.',
      outfit: o,
    };
  }
  const o = pickOutfit(detectOccasion(q) || 'casual');
  return {
    text: o
      ? `I rebuilt that from your wardrobe: ${o.pieces.join(' + ')} is a reliable ${o.match}% match — ${o.explanation}`
      : 'Tell me the occasion (university, date, formal, travel) and I will build it from your wardrobe.',
    outfit: o,
  };
}

function detectOccasion(q = '') {
  if (/date|evening|dinner/.test(q)) return 'date night';
  if (/formal|interview|wedding|meeting|presentation/.test(q)) return 'formal dinner';
  if (/travel|trip|pack/.test(q)) return 'travel';
  if (/gym|sport|run/.test(q)) return 'sport';
  if (/universit|college|class|lecture/.test(q)) return 'university casual';
  return null;
}

/** Heuristic clothing analysis from upload filename + hints. */
function analyzeClothing(input = {}) {
  const name = String(input.filename || input.name || 'uploaded garment').toLowerCase();
  const guess = (re, val, fb) => (re.test(name) ? val : fb);
  const category = guess(/shoe|sneaker|loafer|boot/, 'Shoes',
    guess(/jean|trouser|chino|short|skirt|pant|denim/, 'Bottoms',
      guess(/jacket|blazer|coat|hoodie|sweater|knit/, 'Outerwear',
        guess(/belt|scarf|watch|bag|hat|sunglass|tie/, 'Accessories', 'Tops'))));
  const color = guess(/white/, 'White', guess(/black/, 'Black',
    guess(/navy|blue|indigo/, 'Blue', guess(/beige|cream|tan|khaki/, 'Beige',
      guess(/brown/, 'Brown', guess(/grey|gray|charcoal/, 'Grey',
        guess(/green|olive/, 'Green', guess(/red|burgundy/, 'Red', 'White'))))))));
  const style = /suit|blazer|trouser|loafer|oxford/.test(name) ? 'Formal'
    : /denim|jean|sneaker|tee/.test(name) ? 'Casual' : 'Smart Casual';
  const season = /sweater|jacket|coat|wool|suede/.test(name) ? 'Autumn / Winter'
    : /linen|short|tee/.test(name) ? 'Spring / Summer' : 'All Season';
  const pattern = /stripe/.test(name) ? 'Striped' : /check|plaid/.test(name) ? 'Checked' : /floral/.test(name) ? 'Floral' : 'Plain';
  const material = /denim|jean/.test(name) ? 'Denim' : /leather/.test(name) ? 'Leather'
    : /wool|knit|sweater/.test(name) ? 'Wool Blend' : /silk/.test(name) ? 'Silk'
    : /linen/.test(name) ? 'Linen' : 'Cotton';
  return {
    category: input.category || category,
    color: input.color || color,
    style: input.style || style,
    pattern: input.pattern || pattern,
    material: input.material || material,
    season: input.season || season,
    formality: input.formality || (style === 'Formal' ? 'Formal' : style === 'Casual' ? 'Casual' : 'Smart Casual'),
    confidence: 0.82 + Math.random() * 0.12,
  };
}

function wardrobeGap(wardrobe) {
  const cats = {};
  for (const i of wardrobe) cats[i.category] = (cats[i.category] || 0) + 1;
  const gaps = [];
  if (!wardrobe.some((i) => /white/i.test(i.color) && /formal/i.test(i.formality + i.style))) {
    gaps.push({ gap: 'No formal white shirt', suggestion: 'White Formal Shirt', reason: 'You own casual layers but no formal white shirt for events.' });
  }
  if ((cats['Shoes'] || 0) < 3 || !wardrobe.some((i) => /shoe/i.test(i.category) && /formal/i.test(i.formality))) {
    gaps.push({ gap: 'Missing formal footwear', suggestion: 'Black Oxford Shoes', reason: 'Formal shoes complete 6+ smart outfit gaps.' });
  }
  if (!wardrobe.some((i) => /blazer/i.test(i.name))) {
    gaps.push({ gap: 'No versatile blazer', suggestion: 'Navy Blazer', reason: 'Layers with all your existing tees and trousers.' });
  }
  return { gaps, totalItems: wardrobe.length, byCategory: cats };
}

function styleProfileFromWardrobe(wardrobe, feedback = []) {
  const styleCount = {}, colorCount = {};
  for (const i of wardrobe) {
    styleCount[i.style] = (styleCount[i.style] || 0) + 1;
    colorCount[i.color] = (colorCount[i.color] || 0) + 1;
  }
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  return {
    preferredStyles: top(styleCount),
    favoriteColors: top(colorCount),
    totalItems: wardrobe.length,
    feedbackCount: feedback.length,
  };
}

function packingList(wardrobe, trip = {}) {
  const days = Math.min(14, Math.max(1, Number(trip.days) || 5));
  const needed = Math.min(wardrobe.length, Math.max(4, Math.ceil(days * 1.6)));
  const sorted = [...wardrobe].sort((a, b) => (b.timesWorn || 0) - (a.timesWorn || 0));
  const picked = sorted.slice(0, needed);
  const combos = Math.max(days, Math.round((picked.length * (picked.length - 1)) / 4));
  return {
    destination: trip.destination || 'Trip',
    days,
    items: picked,
    outfitsEstimate: combos,
    message: `You can create ${combos} outfits using only ${picked.length} items.`,
  };
}

module.exports = {
  calculateCompatibility,
  generateOutfits,
  outfitName,
  explainOutfit,
  chatReply,
  analyzeClothing,
  wardrobeGap,
  styleProfileFromWardrobe,
  packingList,
};
