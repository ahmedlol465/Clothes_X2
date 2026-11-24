/** 8.5 Outfits routes. */
'use strict';
const express = require('express');
const store = require('../data/store');
const ai = require('../services/ai-engine');
const scoring = require('../services/scoring');
const memoryStore = require('../services/style-memory');
const engine = require('../services/recommendation-engine');
const history = require('../services/recommendation-history');
const savedOutfits = require('../services/saved-outfits');
const { auth, optionalAuth } = require('../middleware/auth');
const { now, db, persist } = require('../lib/context');
const { suppliedCompatibilityScore, sanitizeBreakdown, sanitizeExplanation } = require('../lib/outfit-sanitize');

const router = express.Router();

// ================================================================ 8.5 Outfits
/**
 * Recommended outfits (§3 Recommendation Engine).
 *
 * Same request/response contract as before — `{ outfits, weather, occasion }`
 * with `outfits` in the existing Outfit shape — but the ranking now goes
 * through `src/recommendation-engine.js`: hard constraints → existing
 * generation/retrieval → centralised personalised score → diversity →
 * exploration. The engine owns wardrobe filtering (archived included), so the
 * raw `db.wardrobe` is handed over.
 *
 * If any optional personalisation signal fails, the endpoint falls back to the
 * previous direct `generateOutfits` call rather than failing the Home screen.
 *
 * §4: whatever comes back is remembered in db.recommendationHistory (compact
 * user/time/context/itemIds rows) so later feedback can be attributed to the
 * garments the user was actually shown. The write is best-effort and wrapped:
 * a failing store can never break the recommendation flow, and the response
 * stays byte-identical in shape to §3.
 */
router.get('/outfits/recommended', optionalAuth, async (req, res) => {
  const { occasion = 'casual', tempC = '24', count = '3' } = req.query;
  const weather = { tempC: Number(tempC), condition: Number(tempC) >= 26 ? 'sunny' : 'partly cloudy' };
  const remember = (outfits) => {
    try {
      const written = history.recordShown(db, {
        userId: req.user?.id || null,
        occasion,
        tempC: weather.tempC,
        source: 'GET /outfits/recommended',
        outfits,
      });
      if (written.length) persist();
    } catch (e) {
      console.error('[recommend] history write skipped:', e.message);
    }
  };
  try {
    const { outfits, meta } = await engine.recommend(db.wardrobe, {
      occasion,
      weather,
      count: Number(count),
      styleProfile: req.user?.styleProfile || {},
      memory: memoryStore.read(db, req.user?.id),
    });
    remember(outfits);
    return res.json({ outfits, weather, occasion, meta });
  } catch (e) {
    console.error('[recommend] engine failed, falling back to generateOutfits:', e.message);
    const outfits = ai.generateOutfits(db.wardrobe.filter((i) => !i.archived), {
      occasion, weather, styleProfile: req.user?.styleProfile || {}, count: Number(count),
    });
    remember(outfits);
    res.json({ outfits, weather, occasion, meta: { reason: 'fallback_generate_outfits', wardrobeGap: ai.wardrobeGap(db.wardrobe.filter((i) => !i.archived)) } });
  }
});

router.post('/outfits', optionalAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.itemIds?.length) return res.status(400).json({ error: 'name and itemIds are required.' });
  const items = b.itemIds.map((id) => db.wardrobe.find((i) => i.id === id)).filter(Boolean);
  // The old route scored a one-item outfit against the first three wardrobe
  // entries whenever it had fewer than two pieces, so a scarf could carry an
  // unrelated look's score. Only ever score the pieces actually submitted.
  if (!items.length) {
    return res.status(400).json({ error: 'None of those items are in your wardrobe.' });
  }

  const supplied = suppliedCompatibilityScore(b.compatibilityScore);
  if (Number.isNaN(supplied)) {
    return res.status(400).json({ error: 'compatibilityScore must be a number between 0 and 100.' });
  }

  const occasion = b.occasion || 'casual';
  const context = {
    occasion,
    weather: { tempC: 24 },
    styleProfile: req.user?.styleProfile,
    memory: memoryStore.read(db, req.user?.id),
  };

  let score;
  let breakdown;
  if (supplied != null) {
    // A recommendation already carries the score and report the user was shown;
    // persist exactly those rather than re-deriving a different number.
    score = supplied;
    breakdown = sanitizeBreakdown(b.breakdown) || [];
  } else {
    // Manual creation with no supplied score: a safe, consistent calculation
    // over the actual selected pieces (never `rankingScore`).
    const compat = ai.calculateCompatibility(items, context);
    score = compat.match;
    breakdown = compat.breakdown;
  }

  const explanation = sanitizeExplanation(b.explanation)
    || scoring.explain(items, { occasion, weather: context.weather }, { breakdown, match: score });

  const outfit = {
    id: store.uid('o'), name: b.name, occasion: b.occasion || 'Casual',
    image: b.image || items[0]?.image || 'assets/images/outfit_flatlay_beige.jpg',
    // `match` is the legacy alias of the one user-facing compatibility score;
    // `rankingScore` is deliberately never read here or stored.
    match: score, compatibilityScore: score, breakdown, explanation,
    pieces: items.map((i) => i.name), itemIds: items.map((i) => i.id),
    favorite: false, createdAt: now(),
  };
  db.outfits.unshift(outfit);
  // Creating an outfit saves it for its creator, so it shows in their Saved
  // list on the very first read. The relationship is per-user; the record
  // itself stays shared and is what an unsave later leaves behind. Only a
  // verified session (req.authUserId) owns the save: optionalAuth falls back
  // to db.users[0] for anonymous callers, so attributing on req.user?.id would
  // hand an anonymous create to an arbitrary account. Anonymous creates still
  // return the record but save nothing.
  if (req.authUserId) savedOutfits.save(db, { userId: req.authUserId, outfitId: outfit.id });
  // The rating the user gave the source recommendation follows the saved look,
  // persistence-only (no re-learning) and idempotent. Anonymous creates carry no
  // user, so there is nothing to transfer and none is attempted.
  if (req.authUserId && b.sourceOutfitId) {
    history.transferRating(db, {
      userId: req.authUserId,
      fromOutfitId: b.sourceOutfitId,
      toOutfitId: outfit.id,
    });
  }
  persist();
  res.status(201).json({ outfit });
});

/**
 * The signed-in user's saved outfits (§8.5).
 *
 * Derived from db.savedOutfits, so it is strictly per-user — an outfit saved by
 * someone else is not returned unless this user saved it too. `auth` (not
 * optionalAuth) is required so the fallback to db.users[0] can never leak one
 * visitor's saves to another. Registered before GET /outfits/:id so the literal
 * "saved" is never captured as an :id.
 */
router.get('/outfits/saved', auth, (req, res) => {
  res.json({ outfits: savedOutfits.listOutfits(db, req.user.id) });
});

/**
 * Save an outfit for the signed-in user (§8.5).
 *
 * Idempotent: saving twice keeps a single relationship. The outfit must already
 * exist as a record — a generated recommendation is persisted first through
 * POST /outfits. An unsave later removes only the relationship, never the
 * record.
 */
router.post('/outfits/:id/save', auth, (req, res) => {
  const outfit = db.outfits.find((o) => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ error: 'Outfit not found.' });
  const result = savedOutfits.save(db, { userId: req.user.id, outfitId: outfit.id });
  if (result && result.created) persist();
  res.json({ saved: true, outfit });
});

/**
 * Remove the signed-in user's saved relationship to an outfit (§8.5).
 *
 * Idempotent and non-destructive: only the relationship row is removed. The
 * outfit record, its ratings, feedback and recommendation history are left
 * untouched. No 404 when the record is already gone — an unsave must still be
 * able to clean up a stale relationship; an unknown id is simply a no-op.
 */
router.delete('/outfits/:id/save', auth, (req, res) => {
  const result = savedOutfits.unsave(db, { userId: req.user.id, outfitId: req.params.id });
  if (result.removed > 0) persist();
  res.json({ saved: false, removed: result.removed });
});

router.get('/outfits/:id', optionalAuth, (req, res) => {
  const outfit = db.outfits.find((o) => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ error: 'Outfit not found.' });
  res.json({ outfit });
});

router.patch('/outfits/:id', optionalAuth, (req, res) => {
  const outfit = db.outfits.find((o) => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ error: 'Outfit not found.' });
  Object.assign(outfit, req.body || {});
  persist();
  res.json({ outfit });
});

router.delete('/outfits/:id', optionalAuth, (req, res) => {
  db.outfits = db.outfits.filter((o) => o.id !== req.params.id);
  // Drop dangling saved relationships for the removed record (all users), so
  // db.savedOutfits cannot accumulate references to outfits that no longer
  // exist. The reverse never happens: unsaving leaves the record in place.
  savedOutfits.purgeOutfit(db, req.params.id);
  persist();
  res.json({ ok: true });
});

/**
 * Toggle favourite (§4 feedback).
 *
 * A false→true transition is a real positive signal, so it is learned through
 * the existing StyleMemory path with the same strength as a 5-star rating
 * (scale documented in src/recommendation-history.js). Un-favouriting records
 * nothing: toggling off is ambiguous (undo vs. dislike) and inventing a
 * negative signal there would be guesswork — a dedicated rejection action is a
 * future integration point. The event is idempotent per user/outfit/UTC-day,
 * so a double tap cannot double-learn, and any learning failure is logged and
 * swallowed: the toggle itself still works.
 *
 * Response contract unchanged: { outfit }.
 */
router.post('/outfits/:id/favorite', optionalAuth, (req, res) => {
  const outfit = db.outfits.find((o) => o.id === req.params.id);
  if (!outfit) return res.status(404).json({ error: 'Outfit not found.' });
  const userId = req.user?.id || null;
  outfit.favorite = !outfit.favorite;
  if (outfit.favorite) {
    try {
      const result = history.applyFeedback(db, {
        type: 'favorite',
        source: 'outfit_favorite',
        userId,
        outfitId: req.params.id,
        rating: 5,
        comment: '',
        itemIds: outfit.itemIds,
      });
      if (result.learnError) console.error('[favorite] learning skipped:', result.learnError);
    } catch (e) {
      console.error('[favorite] feedback skipped:', e.message);
    }
  }
  persist();
  res.json({ outfit });
});

/**
 * Rate an outfit (§4 feedback).
 *
 * Same request/response contract as before — { ok, learned } — with one
 * additive `duplicate` flag. What changed underneath:
 *   • the event gets a stable id (user + outfit + payload + UTC day), so a
 *     retried request reports duplicate instead of learning the signal again;
 *   • item attribution falls back to db.recommendationHistory when the outfit
 *     is a generated recommendation (gen-… ids are never saved to db.outfits),
 *     so rating a recommendation finally moves the preferences of the
 *     garments it contained;
 *   • learning goes through the same memoryStore.record path as §9 always
 *     did — no second learning mechanism, and explicit profile fields
 *     (favoriteColors / preferredStyles / avoidedColors / sizes / fit) are
 *     never touched.
 */
router.post('/outfits/:id/feedback', optionalAuth, (req, res) => {
  const { rating = 5, comment = '' } = req.body || {};
  const userId = req.user?.id || null;
  const outfit = db.outfits.find((o) => o.id === req.params.id);

  const result = history.applyFeedback(db, {
    type: 'rating',
    source: 'outfit_feedback',
    userId,
    outfitId: req.params.id,
    rating,
    comment,
    itemIds: outfit?.itemIds,
  });
  if (result.learnError) console.error('[feedback] learning skipped:', result.learnError);
  if (!result.duplicate) persist();

  const memory = result.memory;
  res.json({
    ok: true,
    duplicate: result.duplicate,
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

/**
 * Save a 1–5 star rating for an outfit (§4 feedback, Phase 1).
 *
 * The rating is stored (one row per user/outfit, replaced in place) AND learned
 * into the user's StyleMemory with REPLACE semantics, so the next
 * `GET /outfits/recommended` reflects it through the engine's `learned_affinity`
 * component and the generator's per-garment affinity. Changing a rating swaps
 * its contribution instead of adding to it (see
 * `src/recommendation-history.js` → `saveRating`).
 *
 * Saved outfits and generated recommendations are both valid targets (`gen-…`
 * ids are never persisted to db.outfits, but the user can still rate them; the
 * garments are recovered from db.recommendationHistory).
 *
 * AUTHENTICATION: this endpoint requires a real bearer session (`auth`), not
 * `optionalAuth`. Learning is written under the caller's account, and
 * `optionalAuth` falls back to `db.users[0]` for anonymous callers — which would
 * attribute one visitor's rating (and learned preferences) to another user.
 * Requiring a token keeps learning strictly per-user. The app is auth-gated
 * (splash → login), so it always carries a token here. (The broader
 * `optionalAuth` fallback on non-learning routes is a separate, pre-existing
 * concern and is left untouched.)
 */
router.post('/outfits/:id/rating', auth, (req, res) => {
  const outfitId = req.params.id;
  const rating = (req.body || {}).rating;
  if (!history.isValidRating(rating)) {
    return res.status(400).json({ error: 'Rating must be an integer from 1 to 5.' });
  }
  const userId = req.user.id;
  const outfit = db.outfits.find((o) => o.id === outfitId);
  const saved = history.saveRating(db, { userId, outfitId, rating, itemIds: outfit?.itemIds });
  persist();
  res.json({ ok: true, outfitId, rating: saved.row.rating, learned: saved.learned });
});

/** The current user's saved rating for an outfit, or null (§4 feedback, Phase 1). */
router.get('/outfits/:id/rating', auth, (req, res) => {
  const userId = req.user.id;
  const rating = history.readRating(db, { userId, outfitId: req.params.id });
  res.json({ outfitId: req.params.id, rating });
});

router.get('/outfits', optionalAuth, (req, res) => {
  const { favorite } = req.query;
  let outfits = db.outfits;
  if (favorite === 'true') outfits = outfits.filter((o) => o.favorite);
  res.json({ outfits });
});

module.exports = router;
