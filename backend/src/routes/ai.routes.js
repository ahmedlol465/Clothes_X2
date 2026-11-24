/** 8.4 AI routes. */
'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('../data/store');
const ai = require('../services/ai-engine');
const llm = require('../services/llm');
const language = require('../services/language');
const scoring = require('../services/scoring');
const memoryStore = require('../services/style-memory');
const retrieval = require('../services/retrieval');
const engine = require('../services/recommendation-engine');
const history = require('../services/recommendation-history');
const vision = require('../services/vision');
const responseContract = require('../services/response-contract');
const { optionalAuth } = require('../middleware/auth');
const { num } = require('../lib/style-profile');
const { trackAi, now, db, persist } = require('../lib/context');
const { upload, readStoredImage, sniffImageMime } = require('../lib/storage');
const { stylistContext, idsMentionedIn, learnTurn, buildOutfitFromIds, recallTurns, findLastOutfitTurn } = require('../lib/stylist');
const { currentWeather, resolveWeather } = require('../lib/weather');

const router = express.Router();

// =================================================================== 8.4 AI
router.post('/ai/analyze-clothing', optionalAuth, async (req, res) => {
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

router.post('/ai/generate-outfit', optionalAuth, async (req, res) => {
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

router.post('/ai/calculate-compatibility', optionalAuth, async (req, res) => {
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

router.post('/ai/style-profile', optionalAuth, (req, res) => {
  const wardrobe = db.wardrobe.filter((i) => !i.archived);
  const memory = memoryStore.read(db, req.user?.id);
  res.json({
    styleProfile: ai.styleProfileFromWardrobe(wardrobe, db.feedback),
    styleDna: memoryStore.styleDna(memory, wardrobe),
    digest: memoryStore.digest(memory),
  });
});

router.post('/ai/wardrobe-gap', optionalAuth, (req, res) => {
  res.json(ai.wardrobeGap(db.wardrobe.filter((i) => !i.archived)));
});

router.post('/ai/packing-list', optionalAuth, (req, res) => {
  res.json(ai.packingList(db.wardrobe.filter((i) => !i.archived), req.body || {}));
});

// ============================================================ 8.7.1 Wardrobe Assistant
// Read-only Q&A over the user's actual wardrobe records. Never creates,
// updates, or deletes wardrobe items.
router.post('/ai/wardrobe-assistant', optionalAuth, (req, res) => {
  const t0 = Date.now();
  const { message = '', conversationId } = req.body || {};
  const result = ai.wardrobeAssistant(message, db.wardrobe.filter((i) => !i.archived), { conversationId });
  trackAi('wardrobe-assistant', Date.now() - t0, { intent: result.intent, itemsFound: result.itemsFound.length });
  res.json(result);
});

// ============================================================ 8.7.2 Shopping Assistant
// Category-level shopping guidance grounded in real wardrobe gaps or an
// explicit user request. Suggestions are clearly not-owned and are never
// added to the wardrobe. Not live listings: no prices, merchants, or links.
router.post('/ai/shopping-assistant', optionalAuth, (req, res) => {
  const t0 = Date.now();
  const { message = '', gapFocus, conversationId } = req.body || {};
  const result = ai.shoppingAssistant(message, db.wardrobe.filter((i) => !i.archived), { gapFocus, conversationId });
  trackAi('shopping-assistant', Date.now() - t0, { focus: result.focus, suggestions: result.suggestions.length });
  res.json(result);
});

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
router.post('/ai/chat', optionalAuth, async (req, res) => {
  const t0 = Date.now();
  const requestId = responseContract.newRequestId();
  const { message = '', history = [], conversationId } = req.body || {};
  if (!String(message).trim()) return res.status(400).json({ error: 'message is required.' });

  const user = req.user;
  const ctx = await stylistContext(user, message);
  const detectedLang = language.detectLanguage(message);
  // `let`: reassigned to the provider name once the LLM turn succeeds. As a
  // `const` the assignment threw, and the catch below swallowed it — so the
  // reply read like an LLM answer while `source` stayed "rules" and the
  // model's chosen item ids were never assembled into an outfit.
  let source = 'rules';
  let reply = '';
  let intent = 'chat';
  let followUp = null;
  let constraints = responseContract.emptyConstraints();
  let occasion = ctx.occasion;
  let tokens;
  let memoryNotes = null;
  let degraded = false;
  let itemIdValidation = { requested: [], valid: [], dropped: [] };

  if (llm.status().configured) {
    // Retry loop: re-prompt the LLM if it returns invalid/hallucinated itemIds
    // Up to 2 attempts (initial + 1 retry) to avoid excessive latency.
    let llmAttempts = 0;
    const MAX_LLM_ATTEMPTS = 2;
    let gen = null;

    while (llmAttempts < MAX_LLM_ATTEMPTS) {
      try {
        gen = await llm.stylistChat({
          message,
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

        // Validate the model's chosen ids against the live wardrobe before they
        // can become an outfit; `meta.itemIdValidation` records what was dropped.
        itemIdValidation = responseContract.validateItemIds(gen.itemIds, ctx.wardrobe);

        // Check if we got enough valid IDs to build an outfit
        const hasEnoughValidIds = itemIdValidation.valid.length >= 2;
        const allRequestedValid = itemIdValidation.dropped.length === 0;

        if (hasEnoughValidIds && allRequestedValid) {
          // Success: all IDs are valid and we have enough
          ctx.outfit = buildOutfitFromIds(itemIdValidation.valid, ctx, {
            occasion,
            provenance: responseContract.PROVENANCE.llmIds,
          });
          break; // Exit retry loop
        }

        // Not enough valid IDs or some were dropped - prepare for retry if attempts remain
        if (!hasEnoughValidIds) {
          degraded = true;
        }

        llmAttempts++;
        if (llmAttempts < MAX_LLM_ATTEMPTS) {
          console.warn(`[ai] chat: LLM returned ${itemIdValidation.valid.length} valid IDs (dropped: ${itemIdValidation.dropped.join(', ')}), retrying... (attempt ${llmAttempts + 1}/${MAX_LLM_ATTEMPTS})`);
          // Clear reply so we retry
          reply = '';
        } else {
          // Last attempt failed - we'll fall through to rule engine or use partial valid IDs
          console.warn(`[ai] chat: LLM retry exhausted, using ${itemIdValidation.valid.length} valid IDs`);
          ctx.outfit = buildOutfitFromIds(itemIdValidation.valid, ctx, {
            occasion,
            provenance: responseContract.PROVENANCE.llmIds,
          });
          if (!ctx.outfit && (itemIdValidation.requested.length || itemIdValidation.dropped.length)) {
            degraded = true;
          }
        }
      } catch (e) {
        console.error('[ai] chat failed, rules fallback:', e.message);
        degraded = true;
        break; // On error, fall through to rule engine
      }
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
      language: detectedLang,
    });
    reply = fallback.text;
    intent = fallback.intent || 'chat';
    occasion = fallback.occasion || occasion;
    const fallbackOutfit = fallback.outfit || null;
    ctx.outfit = fallbackOutfit
      ? responseContract.normalizeOutfit(fallbackOutfit, {
        provenance: responseContract.PROVENANCE.ruleFallback,
        occasion,
        grounding: {
          recoveredItemIds: fallbackOutfit.itemIds || [],
          usedFallback: false,
          allOwned: true,
        },
      })
      : null;
    if (fallbackOutfit) {
      const ids = [...(fallbackOutfit.itemIds || [])];
      itemIdValidation = { requested: ids, valid: ids, dropped: [] };
    }
    if (!constraints.colors.length) constraints = fallback.constraints || constraints;
    degraded = true;
  }

  // Session 5 + 8 — contextual outfit editing and follow-up understanding.
  // Route the turn by intent so follow-ups modify the previous look instead
  // of building something new, single-item changes only swap one piece, and
  // ambiguous references fall back to context rather than guessing.
  const intentFromMessage = responseContract.inferIntent(message);
  const previousTurn = findLastOutfitTurn(user?.id, conversationId);
  let usedContext = false;

  if (intentFromMessage === 'modify_item' && previousTurn?.itemIds?.length) {
    // Single-item modification: swap just one piece, keep everything else.
    const category = responseContract.detectSingleItemChange(message);
    const itemToReplace = ai.detectItemReference(message, ctx.wardrobe, previousTurn.itemIds);
    if (itemToReplace) {
      const modResult = ai.modifySingleItem(ctx.wardrobe, {
        itemIds: previousTurn.itemIds,
        itemToReplace,
        weather: ctx.weather,
        styleProfile: ctx.styleProfile,
        memory: ctx.memory,
      });
      if (modResult.outfit) {
        ctx.outfit = modResult.outfit;
        intent = 'modify_item';
        usedContext = true;
        followUp = responseContract.editFollowUp(detectedLang, category || 'item');
      }
    }
  } else if (intentFromMessage === 'modify_outfit' && previousTurn?.itemIds?.length) {
    // Full outfit remix: re-dress the previous look for a new context.
    const grounding = previousTurn.grounding || {};
    if (grounding.usedFallback !== true) {
      const variant = ai.detectRemixVariant(message);
      const remixResult = ai.remixOutfit(ctx.wardrobe, {
        itemIds: previousTurn.itemIds,
        variant,
        weather: ctx.weather,
        styleProfile: ctx.styleProfile,
        memory: ctx.memory,
      });
      if (remixResult.outfit) {
        ctx.outfit = remixResult.outfit;
        intent = 'modify_outfit';
        usedContext = true;
        if (remixResult.regenerated) degraded = true;
      }
    }
  } else if (intentFromMessage === 'ambiguous' && previousTurn?.itemIds?.length) {
    // Ambiguous reference ("that", "it", "the one"): use the previous outfit
    // as context but don't silently change it. Build a fresh look instead so
    // the user can confirm or correct.
    usedContext = true;
    followUp = responseContract.ambiguousFollowUp(detectedLang);
  }

  // When no contextual routing applied, fall through to the default outfit
  // (already built by the LLM or rule engine above). intent stays as set by
  // the generator or falls back to 'chat'.
  const outfit = ctx.outfit || null;
  const suggestions = responseContract.suggestionsForTurn({
    intent,
    hasOutfit: !!outfit,
    lang: detectedLang,
  });

  // Learning loop: mine the user's own words for durable preferences.
  if (learnTurn(ctx.memory, message, memoryNotes)) memoryStore.write(db, ctx.memory);

  db.conversations.push({
    id: store.uid('t'),
    userId: user?.id || null,
    conversationId: conversationId || null,
    at: now(), message, reply,
    itemIds: outfit?.itemIds || [],
    provenance: outfit?.provenance || null,
    grounding: outfit?.grounding || null,
    intent: intent || null,
    followUp: followUp || null,
    usedContext,
  });
  if (db.conversations.length > 400) db.conversations = db.conversations.slice(-400);
  persist();

  const facets = responseContract.memoryFacets(ctx.memory);
  const meta = responseContract.baseMeta({
    requestId,
    engine: source,
    degraded,
    itemIdValidation,
    language: detectedLang,
  });
  trackAi('chat', Date.now() - t0, {
    source,
    tokens,
    degraded,
    dropped: itemIdValidation.dropped.length,
  });
  res.json({
    reply,
    outfit,
    followUp,
    suggestions,
    intent,
    occasion,
    constraints,
    weather: ctx.weather,
    memory: {
      confidence: memoryStore.confidence(ctx.memory),
      digest: memoryStore.digest(ctx.memory),
      facets,
    },
    conversationId: conversationId || null,
    source,
    meta,
  });
});

/**
 * POST /ai/chat/stream — same turn, but the reply is streamed as SSE so the
 * UI types it out. Emits `delta` events, then a final `done` event carrying
 * the assembled text. Falls back to a single `done` with the rule-engine
 * reply when the provider has no stream support or errors mid-flight.
 */
router.post('/ai/chat/stream', optionalAuth, async (req, res) => {
  const { message = '', history = [], conversationId } = req.body || {};
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const detectedLang = language.detectLanguage(message);

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (!String(message).trim()) {
    send('error', { error: 'message is required.' });
    return res.end();
  }

  const t0 = Date.now();
  const requestId = responseContract.newRequestId();
  const generatedAt = new Date().toISOString();
  const user = req.user;

  // Structured turn fields. Text still streams as plain prose; these are
  // derived deterministically (no extra LLM call) and shipped on `done`.
  let intent = responseContract.inferIntent(message);
  let occasion = null;
  let constraints = responseContract.emptyConstraints();
  let followUp = null;
  let itemIdValidation = { requested: [], valid: [], dropped: [] };
  let degraded = !llm.status().configured;
  let metaSent = false;

  // `meta` is optional and carries no text. It is emitted once, immediately
  // before the first delta (or before the synthetic fallback delta), so it can
  // never leak into `done.reply == deltas.join()`.
  const sendMeta = () => {
    if (metaSent) return;
    metaSent = true;
    send('meta', {
      intent,
      occasion,
      constraints,
      conversationId: conversationId || null,
      source,
      meta: responseContract.baseMeta({
        requestId,
        generatedAt,
        engine: source,
        degraded,
        itemIdValidation,
        language: detectedLang,
      }),
    });
  };

  let ctx;
  try {
    ctx = await stylistContext(user, message);
  } catch (e) {
    send('error', { error: e.message });
    return res.end();
  }
  occasion = ctx.occasion;

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
          if (!text) sendMeta();
          text += chunk.delta;
          send('delta', { delta: chunk.delta });
        }
        if (chunk.done) tokens = chunk.tokens;
      }
    } catch (e) {
      console.error('[ai] stream failed:', e.message);
      send('error', { error: e.message, recoverable: true });
      source = 'rules';
      degraded = true;
    }
  }

  // Anything not delivered by the stream (no key, provider error, empty
  // stream) is filled in by the rule engine.
  if (!text.trim()) {
    const fallback = ai.chatReply(message, {
      wardrobe: ctx.wardrobe, weather: ctx.weather,
      styleProfile: ctx.styleProfile, memory: ctx.memory,
      language: detectedLang,
    });
    text = fallback.text;
    source = 'rules';
    intent = fallback.intent || intent;
    occasion = fallback.occasion || occasion;
    constraints = fallback.constraints || constraints;
    degraded = true;
    const fallbackOutfit = fallback.outfit || null;
    ctx.outfit = fallbackOutfit
      ? responseContract.normalizeOutfit(fallbackOutfit, {
        provenance: responseContract.PROVENANCE.ruleFallback,
        occasion,
        grounding: {
          recoveredItemIds: fallbackOutfit.itemIds || [],
          usedFallback: false,
          allOwned: true,
        },
      })
      : null;
    if (fallbackOutfit) {
      const ids = [...(fallbackOutfit.itemIds || [])];
      itemIdValidation = { requested: ids, valid: ids, dropped: [] };
    }
    sendMeta();
    send('delta', { delta: text, synthetic: true });
  } else {
    // No structured id list on this path. Prefer the pieces the model actually
    // named; only fall back to generating a look when it named fewer than two.
    // A generated fallback is marked, never disguised as grounded in the prose.
    const mentioned = idsMentionedIn(text, ctx.wardrobe);
    itemIdValidation = responseContract.validateItemIds(mentioned, ctx.wardrobe);

    // Log validation results for hallucination monitoring
    if (itemIdValidation.dropped.length > 0) {
      console.warn(`[ai] stream: LLM mentioned ${mentioned.length} items, ${itemIdValidation.dropped.length} invalid/hallucinated (dropped: ${itemIdValidation.dropped.join(', ')}), ${itemIdValidation.valid.length} valid`);
    }

    const named = buildOutfitFromIds(itemIdValidation.valid, ctx, {
      provenance: responseContract.PROVENANCE.recovered,
    });
    if (named) {
      ctx.outfit = named;
      // If we had dropped items, mark as degraded since the prose may reference them
      if (itemIdValidation.dropped.length > 0) {
        degraded = true;
      }
    } else {
      const generated = ai.generateOutfits(ctx.wardrobe, {
        occasion: ctx.occasion, weather: ctx.weather,
        styleProfile: ctx.styleProfile, memory: ctx.memory, count: 1,
      })[0] || null;
      ctx.outfit = generated
        ? responseContract.normalizeOutfit(generated, {
          provenance: responseContract.PROVENANCE.generatedFallback,
          grounding: {
            recoveredItemIds: itemIdValidation.valid,
            usedFallback: true,
            allOwned: true,
          },
        })
        : null;
      degraded = true;
    }
  }

  // Session 5 + 8 — contextual outfit editing and follow-up understanding.
  // Route the turn by intent so follow-ups modify the previous look instead
  // of building something new, single-item changes only swap one piece, and
  // ambiguous references fall back to context rather than guessing.
  const intentFromMessage = responseContract.inferIntent(message);
  const previousTurn = findLastOutfitTurn(user?.id, conversationId);
  let usedContext = false;

  if (intentFromMessage === 'modify_item' && previousTurn?.itemIds?.length) {
    // Single-item modification: swap just one piece, keep everything else.
    const category = responseContract.detectSingleItemChange(message);
    const itemToReplace = ai.detectItemReference(message, ctx.wardrobe, previousTurn.itemIds);
    if (itemToReplace) {
      const modResult = ai.modifySingleItem(ctx.wardrobe, {
        itemIds: previousTurn.itemIds,
        itemToReplace,
        weather: ctx.weather,
        styleProfile: ctx.styleProfile,
        memory: ctx.memory,
      });
      if (modResult.outfit) {
        ctx.outfit = modResult.outfit;
        intent = 'modify_item';
        usedContext = true;
        followUp = responseContract.editFollowUp(detectedLang, category || 'item');
      }
    }
  } else if (intentFromMessage === 'modify_outfit' && previousTurn?.itemIds?.length) {
    // Full outfit remix: re-dress the previous look for a new context.
    const grounding = previousTurn.grounding || {};
    if (grounding.usedFallback !== true) {
      const variant = ai.detectRemixVariant(message);
      const remixResult = ai.remixOutfit(ctx.wardrobe, {
        itemIds: previousTurn.itemIds,
        variant,
        weather: ctx.weather,
        styleProfile: ctx.styleProfile,
        memory: ctx.memory,
      });
      if (remixResult.outfit) {
        ctx.outfit = remixResult.outfit;
        intent = 'modify_outfit';
        usedContext = true;
        if (remixResult.regenerated) degraded = true;
      }
    }
  } else if (intentFromMessage === 'ambiguous' && previousTurn?.itemIds?.length) {
    // Ambiguous reference ("that", "it", "the one"): use the previous outfit
    // as context but don't silently change it. Build a fresh look instead so
    // the user can confirm or correct.
    usedContext = true;
    followUp = responseContract.ambiguousFollowUp(detectedLang);
  }

  const outfit = ctx.outfit || null;
  const suggestions = responseContract.suggestionsForTurn({
    intent,
    hasOutfit: !!outfit,
    lang: detectedLang,
  });

  // The streaming turn is the one the app actually uses, so it learns too.
  if (learnTurn(ctx.memory, message, null)) memoryStore.write(db, ctx.memory);
  db.conversations.push({
    id: store.uid('t'), userId: user?.id || null,
    conversationId: conversationId || null, at: now(), message, reply: text,
    itemIds: outfit?.itemIds || [],
    provenance: outfit?.provenance || null,
    grounding: outfit?.grounding || null,
    intent: intent || null,
    followUp: followUp || null,
    usedContext,
  });
  if (db.conversations.length > 400) db.conversations = db.conversations.slice(-400);
  persist();

  const facets = responseContract.memoryFacets(ctx.memory);
  const meta = responseContract.baseMeta({
    requestId,
    generatedAt,
    engine: source,
    degraded,
    itemIdValidation,
    language: detectedLang,
  });
  trackAi('chat/stream', Date.now() - t0, {
    source,
    tokens,
    degraded,
    dropped: itemIdValidation.dropped.length,
  });

  send('done', {
    reply: text,
    intent,
    occasion,
    followUp,
    suggestions,
    constraints,
    conversationId: conversationId || null,
    outfit,
    weather: ctx.weather,
    memory: {
      confidence: memoryStore.confidence(ctx.memory),
      digest: memoryStore.digest(ctx.memory),
      facets,
    },
    source,
    meta,
  });
  res.end();
});

/**
 * POST /ai/critique — Fashion Critic outfit evaluation (non-stream).
 *
 * Accepts: { message, outfit?: { itemIds?: string[] }, history?, conversationId? }
 * Returns: { text, score, strengths, weaknesses, suggestions, itemIds,
 *   occasion, source, meta } — a structured evaluation, not an outfit build.
 */
router.post('/ai/critique', optionalAuth, async (req, res) => {
  const t0 = Date.now();
  const { message = '', history = [], conversationId, outfit } = req.body || {};
  if (!String(message).trim()) return res.status(400).json({ error: 'message is required.' });

  const user = req.user;
  const ctx = await stylistContext(user, message);
  const detectedLang = language.detectLanguage(message);
  let source = 'rules';
  let text = '';
  let score = null;
  let strengths = [];
  let weaknesses = [];
  let suggestions = [];
  let itemIds = [];
  let occasion = ctx.occasion;
  let degraded = false;
  let itemIdValidation = { requested: [], valid: [], dropped: [] };

  const evalItemIds = (outfit?.itemIds && outfit.itemIds.length)
    ? outfit.itemIds
    : (itemIdValidation.valid && itemIdValidation.valid.length) ? itemIdValidation.valid : [];

  if (llm.status().configured) {
    try {
      source = llm.status().provider;
      const gen = await llm.criticChat({
        message,
        history: history.length ? history : recallTurns(user?.id, conversationId),
        wardrobe: ctx.shortlist,
        weather: ctx.weather,
        styleProfile: ctx.styleProfile,
        memoryDigest: memoryStore.digest(ctx.memory),
        events: ctx.events,
      });

      text = gen.text;
      score = gen.score;
      strengths = gen.strengths;
      weaknesses = gen.weaknesses;
      suggestions = gen.suggestions;
      itemIds = gen.itemIds;
      occasion = gen.occasion || occasion;
      source = llm.status().provider;

      if (itemIds.length) {
        itemIdValidation = responseContract.validateItemIds(itemIds, ctx.wardrobe);
      } else {
        degraded = true;
      }
    } catch (e) {
      console.error('[ai] critique failed:', e.message);
      source = 'rules';
      degraded = true;
    }
  }

  if (!text.trim()) {
    // Rule-based fallback evaluation.
    const ids = evalItemIds.length ? evalItemIds : (ctx.outfit?.itemIds || []);
    const wardrobeItems = (ctx.wardrobe || []).filter((i) => !i.archived);
    const evalItems = wardrobeItems.filter((i) => ids.includes(i.id));
    const scored = evalItems.length ? scoring.scoreOutfit(evalItems, {
      occasion, weather: ctx.weather, styleProfile: ctx.styleProfile, memory: ctx.memory,
    }) : null;
    text = scored
      ? `This look scores ${scored.match}%. ${scoring.explain(evalItems, { occasion, weather: ctx.weather }, scored)}`
      : 'Add items to your wardrobe so I can evaluate an outfit.';
    score = scored ? scored.match : null;
    source = 'rules';
    degraded = true;
    itemIds = ids;
    itemIdValidation = { requested: ids, valid: ids, dropped: [] };
  }

  const facets = responseContract.memoryFacets(ctx.memory);
  const meta = responseContract.baseMeta({
    requestId: store.uid('r'),
    generatedAt: new Date(t0).toISOString(),
    engine: source,
    degraded,
    itemIdValidation,
    language: detectedLang,
  });

  trackAi('critique', Date.now() - t0, { source, degraded });

  res.json({
    text,
    score,
    strengths,
    weaknesses,
    suggestions,
    itemIds,
    occasion,
    source,
    meta,
  });
});

/**
 * POST /ai/critique/stream — Fashion Critic outfit evaluation (streaming SSE).
 *
 * Same input as POST /ai/critique, but streams the prose evaluation token by
 * token and finishes with a `done` event carrying the structured evaluation.
 */
router.post('/ai/critique/stream', optionalAuth, async (req, res) => {
  const t0 = Date.now();
  const { message = '', history = [], conversationId, outfit } = req.body || {};
  if (!String(message).trim()) {
    res.status(400).json({ error: 'message is required.' });
    return res.end();
  }

  const detectedLang = language.detectLanguage(message);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const sendMeta = () => {
    send('meta', {
      requestId,
      generatedAt: new Date(t0).toISOString(),
      engine: 'rules',
      degraded: false,
      language: detectedLang,
    });
  };

  let requestId;
  let ctx;
  const reqUser = req.user;
  try {
    ctx = await stylistContext(reqUser, message);
    requestId = store.uid('r');
  } catch (e) {
    send('error', { error: e.message });
    return res.end();
  }
  const occasion = ctx.occasion;

  const aborter = new AbortController();
  res.on('close', () => aborter.abort());

  let text = '';
  let source = 'rules';
  let score = null;
  let strengths = [];
  let weaknesses = [];
  let suggestions = [];
  let itemIds = [];
  let degraded = false;

  if (llm.status().configured) {
    try {
      source = llm.status().provider;
      for await (const chunk of llm.streamCritic({
        message,
        history: history.length ? history : recallTurns(reqUser?.id, conversationId),
        wardrobe: ctx.shortlist,
        weather: ctx.weather,
        styleProfile: ctx.styleProfile,
        memoryDigest: memoryStore.digest(ctx.memory),
      })) {
        if (aborter.signal.aborted) break;
        if (chunk.delta) {
          if (!text) sendMeta();
          text += chunk.delta;
          send('delta', { delta: chunk.delta });
        }
        if (chunk.done) {
          score = null; // stream returns prose only; no structured fields
          source = llm.status().provider;
        }
      }
    } catch (e) {
      console.error('[ai] critique/stream failed:', e.message);
      send('error', { error: e.message, recoverable: true });
      source = 'rules';
      degraded = true;
    }
  }

  if (!text.trim()) {
    const fallback = ai.chatReply(message, {
      wardrobe: ctx.wardrobe, weather: ctx.weather,
      styleProfile: ctx.styleProfile, memory: ctx.memory,
    });
    text = fallback.text;
    source = 'rules';
    degraded = true;
    const scored = fallback.outfit ? scoring.scoreOutfit(fallback.outfit.items || [], {
      occasion, weather: ctx.weather, styleProfile: ctx.styleProfile, memory: ctx.memory,
    }) : null;
    score = scored ? scored.match : null;
    itemIds = fallback.outfit?.itemIds || [];
    sendMeta();
    send('delta', { delta: text, synthetic: true });
  }

  const facets = responseContract.memoryFacets(ctx.memory);
  const meta = responseContract.baseMeta({
    requestId,
    generatedAt: new Date(t0).toISOString(),
    engine: source,
    degraded,
    itemIdValidation: { requested: itemIds, valid: itemIds, dropped: [] },
    language: detectedLang,
  });

  send('done', {
    reply: text,
    score,
    strengths,
    weaknesses,
    suggestions,
    itemIds,
    occasion,
    source,
    meta,
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
router.post('/ai/match-outfit', optionalAuth, (req, res) => {
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
      const occasion = result.reference.occasion || 'casual';
      const scored = scoring.scoreOutfit(result.items, {
        occasion,
        weather: req.body?.weather || currentWeather(),
        styleProfile: req.user?.styleProfile,
        memory,
      });
      result.outfit = responseContract.normalizeOutfit({
        id: `match-${Date.now()}`,
        name: result.reference.title,
        occasion,
        match: scored.match,
        breakdown: scored.breakdown,
        explanation: scoring.explain(result.items, {
          occasion,
          weather: req.body?.weather || currentWeather(),
        }, scored),
        itemIds: result.itemIds,
        pieces: result.items.map((i) => i.name),
        items: result.items,
        image: result.items[0]?.image,
      }, {
        provenance: responseContract.PROVENANCE.match,
        grounding: {
          recoveredItemIds: result.itemIds || [],
          usedFallback: false,
          allOwned: true,
        },
      });
    }

    trackAi('match-outfit', Date.now() - t0, { source, tokens });
    res.json({ ...result, source });
  }).catch((e) => res.status(400).json({ error: e.message }));
});

/**
 * POST /ai/remix — re-dress an existing outfit for another context.
 * `variant` is one of casual | cold | summer | date | formal.
 */
router.post('/ai/remix', optionalAuth, async (req, res) => {
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
router.get('/ai/style-dna', optionalAuth, (req, res) => {
  const wardrobe = db.wardrobe.filter((i) => !i.archived);
  const memory = memoryStore.read(db, req.user?.id);
  res.json({
    styleDna: memoryStore.styleDna(memory, wardrobe),
    digest: memoryStore.digest(memory),
  });
});

/** GET /ai/conversations — recent stylist turns, newest last. */
router.get('/ai/conversations', optionalAuth, (req, res) => {
  const userId = req.user?.id;
  const limit = Math.min(100, Number(req.query.limit) || 40);
  const turns = (db.conversations || [])
    .filter((t) => !userId || !t.userId || t.userId === userId)
    .slice(-limit);
  res.json({ turns, total: db.conversations?.length || 0 });
});

/** DELETE /ai/conversations — forget the conversation, keep learned taste. */
router.delete('/ai/conversations', optionalAuth, (req, res) => {
  const userId = req.user?.id;
  db.conversations = (db.conversations || []).filter((t) => t.userId && t.userId !== userId);
  persist();
  res.json({ ok: true });
});

/** GET /ai/preferences — view all learned style preferences for the current user. */
router.get('/ai/preferences', optionalAuth, (req, res) => {
  const memory = memoryStore.read(db, req.user?.id);
  res.json({
    userId: req.user?.id || null,
    colors: memory.colors || {},
    styles: memory.styles || {},
    fabrics: memory.fabrics || {},
    occasions: memory.occasions || {},
    avoid: memory.avoid || [],
    facts: memory.facts || [],
    itemRatings: memory.itemRatings || {},
    confidence: memoryStore.confidence(memory),
    totals: memory.totals || { ratings: 0, chats: 0 },
    updatedAt: memory.updatedAt || null,
  });
});

/** PATCH /ai/preferences — update individual learned preferences. */
router.patch('/ai/preferences', optionalAuth, (req, res) => {
  const memory = memoryStore.read(db, req.user?.id);
  const b = req.body || {};
  let changed = false;

  // Single colour preference: { color: 'navy', value: 0.8 }
  if (b.color !== undefined && b.value !== undefined) {
    const key = String(b.color || '').trim().toLowerCase();
    const num = Number(b.value);
    if (Number.isFinite(num)) {
      memory.colors[key] = Math.min(0.98, Math.max(0.02, num));
      changed = true;
    }
  }

  // Single style preference: { style: 'casual', value: 0.7 }
  if (b.style !== undefined && b.value !== undefined) {
    const key = String(b.style || '').trim().toLowerCase();
    const num = Number(b.value);
    if (Number.isFinite(num)) {
      memory.styles[key] = Math.min(0.98, Math.max(0.02, num));
      changed = true;
    }
  }

  // Single fabric preference: { fabric: 'cotton', value: 0.6 }
  if (b.fabric !== undefined && b.value !== undefined) {
    const key = String(b.fabric || '').trim().toLowerCase();
    const num = Number(b.value);
    if (Number.isFinite(num)) {
      memory.fabrics[key] = Math.min(0.98, Math.max(0.02, num));
      changed = true;
    }
  }

  // Formality lean: { formality: 'formal' | 'casual' } shifts the occasions map
  if (b.formality !== undefined) {
    const f = String(b.formality).toLowerCase();
    const current = typeof memory.occasions.formal === 'number' ? memory.occasions.formal : 0.5;
    const step = 0.05;
    if (f === 'formal' || f === 'dressier') {
      memory.occasions.formal = Math.min(0.98, Math.max(0.02, current + step));
    } else if (f === 'casual' || f === 'relaxed') {
      memory.occasions.formal = Math.min(0.98, Math.max(0.02, current - step));
    } else {
      return res.status(400).json({ error: "formality must be 'formal' or 'casual'." });
    }
    changed = true;
  }

  // Add to avoid list: { avoid: 'sneakers' }
  if (b.avoid && typeof b.avoid === 'string') {
    const phrase = b.avoid.trim();
    if (phrase.length >= 3 && !memory.avoid.includes(phrase)) {
      memory.avoid.unshift(phrase);
      memory.avoid = memory.avoid.slice(0, 10);
      changed = true;
    }
  }

  if (changed) {
    memoryStore.write(db, memory);
    persist();
  }
  res.json({ ok: true, changed, preferences: {
    colors: memory.colors || {},
    styles: memory.styles || {},
    fabrics: memory.fabrics || {},
    occasions: memory.occasions || {},
    avoid: memory.avoid || [],
    confidence: memoryStore.confidence(memory),
  }});
});

/** DELETE /ai/preferences/reset — clear all learned preferences for the current user. */
router.delete('/ai/preferences/reset', optionalAuth, (req, res) => {
  const userId = req.user?.id;
  const idx = (db.styleMemories || []).findIndex((m) => m.userId === userId);
  if (idx >= 0) {
    db.styleMemories.splice(idx, 1);
    persist();
  }
  res.json({ ok: true, reset: true });
});

/** POST /ai/preferences/avoid — add an item to the absolute avoid list. */
router.post('/ai/preferences/avoid', optionalAuth, (req, res) => {
  const memory = memoryStore.read(db, req.user?.id);
  const { avoid } = req.body || {};
  if (!avoid || typeof avoid !== 'string') {
    return res.status(400).json({ error: 'avoid is required and must be a string.' });
  }
  const phrase = avoid.trim();
  if (phrase.length < 3) {
    return res.status(400).json({ error: 'avoid phrase must be at least 3 characters.' });
  }
  if (!memory.avoid.includes(phrase)) {
    memory.avoid.unshift(phrase);
    memory.avoid = memory.avoid.slice(0, 10);
    memoryStore.write(db, memory);
    persist();
  }
  res.json({ ok: true, avoid: memory.avoid });
});

/** DELETE /ai/preferences/avoid/:phrase — remove an item from the absolute avoid list. */
router.delete('/ai/preferences/avoid/:phrase', optionalAuth, (req, res) => {
  const memory = memoryStore.read(db, req.user?.id);
  const phrase = decodeURIComponent(req.params.phrase);
  const before = memory.avoid.length;
  memory.avoid = (memory.avoid || []).filter((p) => p !== phrase);
  if (memory.avoid.length !== before) {
    memoryStore.write(db, memory);
    persist();
  }
  res.json({ ok: true, avoid: memory.avoid, removed: memory.avoid.length !== before });
});

/** GET /ai/capabilities — what the stylist can currently do, and why not. */
router.get('/ai/capabilities', optionalAuth, async (req, res) => {
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

module.exports = router;
