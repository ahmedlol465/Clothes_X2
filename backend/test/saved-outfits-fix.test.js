/**
 * Saved Outfits Fix — Phase A HTTP integration tests (§8.5).
 *
 * Boots the real Express app from server.js against a throwaway temp store and
 * drives POST /outfits, GET /outfits/:id, GET /outfits/saved and the rating
 * routes over HTTP. Covers the three audited defects:
 *
 *   score        the recommendation's compatibility score / breakdown / match
 *                survive the save instead of being re-derived with different
 *                inputs; manual creation still works; a one-item outfit is
 *                never scored against unrelated wardrobe pieces.
 *   rating       a rated `gen-…` recommendation transfers its rating to the new
 *                `o_…` record — same user only, never fabricated, no learning,
 *                idempotent, and readable through the new id.
 *   explanation  the recommendation's AI explanation is persisted, returned by
 *                GET /outfits/saved and GET /outfits/:id, and legacy records
 *                without one still come back safely.
 *
 * Isolation: SMARTWARDROBE_DATA_DIR is pointed at a temp directory before the
 * app is required, and the real backend/data/db.json is asserted untouched.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-outfit-fix-'));
process.env.SMARTWARDROBE_DATA_DIR = TMP_DIR;

const app = require('../server');
const store = require('../src/store');
const scoring = require('../src/scoring');
const memoryStore = require('../src/style-memory');
const history = require('../src/recommendation-history');

const REAL_DB = path.join(__dirname, '..', 'data', 'db.json');
const realBefore = fs.existsSync(REAL_DB) ? fs.statSync(REAL_DB) : null;

let server;
let base;

async function request(method, urlPath, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + urlPath, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function login(email, password) {
  const res = await request('POST', '/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `login failed for ${email}`);
  return res.body.accessToken;
}

async function register(email) {
  const res = await request('POST', '/auth/register', {
    body: { name: 'Fix Test', email, password: 'secret123' },
  });
  assert.ok(res.status === 201, `register failed for ${email}: ${res.status}`);
  return res.body.accessToken;
}

function feedbackRowsFor(outfitId, userId) {
  const db = store.load();
  return (db.feedback || []).filter(
    (r) => r && r.outfitId === outfitId && (userId === undefined || r.userId === userId),
  );
}

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (realBefore) {
    const realAfter = fs.statSync(REAL_DB);
    assert.equal(realAfter.mtimeMs, realBefore.mtimeMs, 'backend/data/db.json was written');
    assert.equal(realAfter.size, realBefore.size, 'backend/data/db.json changed size');
  }
  assert.ok(fs.existsSync(path.join(TMP_DIR, 'db.json')), 'temp store was not used');
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

test('saved outfits fix phase A over HTTP', async (t) => {
  const demo = await login('karim@fashiontech.com', 'wardrobe2024');

  await t.test('score — a supplied recommendation score is persisted as-is', async () => {
    const breakdown = [
      { key: 'color_harmony', label: 'Color Harmony', value: 88, weight: 0.2, applied: true, contribution: 17.6 },
      { key: 'occasion_fit', label: 'Occasion Fit', value: 74, weight: 0.18, applied: true, contribution: 13.3 },
    ];
    const created = await request('POST', '/outfits', {
      token: demo,
      body: {
        name: 'Kept Score Look',
        itemIds: ['w1', 'w2', 'w4'],
        occasion: 'casual',
        compatibilityScore: 91,
        breakdown,
        explanation: 'These pieces read as one deliberate palette.',
        // A hostile caller must not be able to hijack the displayed number.
        rankingScore: 4,
        id: 'hacked',
        favorite: true,
      },
    });
    assert.equal(created.status, 201);
    const saved = created.body.outfit;

    // Arbitrary client fields could not overwrite unrelated properties.
    assert.notEqual(saved.id, 'hacked');
    assert.equal(saved.id.startsWith('o_'), true);
    assert.equal(saved.favorite, false);
    assert.equal(saved.rankingScore, undefined, 'rankingScore must never be stored');

    assert.equal(saved.match, 91, 'the shown compatibility score is kept');
    assert.equal(saved.compatibilityScore, 91);
    assert.equal(saved.match, saved.compatibilityScore, 'match stays an alias');
    assert.equal(saved.explanation, 'These pieces read as one deliberate palette.');
    assert.equal(saved.breakdown.length, 2);
    assert.equal(saved.breakdown[0].label, 'Color Harmony');

    // Persisted + retrievable, and the saved list returns the same record.
    const fetched = await request('GET', `/outfits/${saved.id}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.outfit.compatibilityScore, 91);
    assert.equal(fetched.body.outfit.rankingScore, undefined);
    assert.equal(fetched.body.outfit.explanation, saved.explanation);
    assert.deepEqual(fetched.body.outfit.breakdown, saved.breakdown);

    const list = await request('GET', '/outfits/saved', { token: demo });
    const inList = list.body.outfits.find((o) => o.id === saved.id);
    assert.ok(inList, 'the saved record is in GET /outfits/saved');
    assert.equal(inList.compatibilityScore, 91);
    assert.equal(inList.explanation, saved.explanation);
    assert.deepEqual(inList.breakdown, saved.breakdown);
  });

  await t.test('score — a valid score with no explanation still returns one', async () => {
    const created = await request('POST', '/outfits', {
      token: demo,
      body: { name: 'No Explanation', itemIds: ['w1', 'w2'], compatibilityScore: 77 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.outfit.match, 77);
    assert.equal(typeof created.body.outfit.explanation, 'string');
    assert.ok(created.body.outfit.explanation.length > 0);
  });

  await t.test('score — malformed supplied scores are rejected, not stored', async () => {
    for (const bad of ['high', 200, -1, 101.5, {}]) {
      const res = await request('POST', '/outfits', {
        token: demo,
        body: { name: 'Bad Score', itemIds: ['w1', 'w2'], compatibilityScore: bad },
      });
      assert.equal(res.status, 400, `compatibilityScore ${JSON.stringify(bad)} must be rejected`);
    }
  });

  await t.test('score — manual create without a score computes over the actual items', async () => {
    const created = await request('POST', '/outfits', {
      token: demo,
      body: { name: 'Manual Look', itemIds: ['w1', 'w2', 'w4'], occasion: 'casual' },
    });
    assert.equal(created.status, 201);
    const o = created.body.outfit;
    assert.equal(typeof o.match, 'number');
    assert.ok(o.match >= 0 && o.match <= 100);
    assert.equal(o.match, o.compatibilityScore);
    assert.equal(o.rankingScore, undefined);
    assert.equal(o.breakdown.length, 11, 'the full 11-factor report is stored');
    assert.equal(o.itemIds.length, 3);
  });

  await t.test('score — a one-item outfit is scored on itself, never unrelated pieces', async () => {
    const db = store.load();
    const scarf = db.wardrobe.find((i) => i.id === 'w10');
    const shirt = db.wardrobe.find((i) => i.id === 'w1');
    assert.ok(scarf && shirt);

    // Replicate the exact context the route builds (default 24°C, demo profile,
    // demo StyleMemory) so the expectation is deterministic.
    const demoUser = db.users.find((u) => u.id === 'u_demo');
    const ctx = {
      occasion: 'casual',
      weather: { tempC: 24 },
      styleProfile: demoUser.styleProfile,
      memory: memoryStore.read(db, 'u_demo'),
    };

    const created = await request('POST', '/outfits', {
      token: demo,
      body: { name: 'Single Scarf', itemIds: ['w10'] },
    });
    assert.equal(created.status, 201);
    const o = created.body.outfit;

    assert.deepEqual(o.itemIds, ['w10']);
    assert.equal(o.pieces.length, 1);
    const expected = scoring.scoreOutfit([scarf], ctx).match;
    assert.equal(o.match, expected, 'the score comes from the submitted piece');

    // The old fallback scored against db.wardrobe.slice(0, 3). Prove the number
    // is not that: score the unrelated trio and show the results differ.
    const unrelated = scoring.scoreOutfit(db.wardrobe.slice(0, 3), ctx).match;
    assert.notEqual(o.match, unrelated, 'must not be scored against unrelated wardrobe items');
  });

  await t.test('score — unknown item ids are rejected with a clear error', async () => {
    const res = await request('POST', '/outfits', {
      token: demo,
      body: { name: 'Ghost', itemIds: ['does-not-exist'] },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /wardrobe/i);
  });

  let sourceId;
  await t.test('rating — a rated gen-… recommendation transfers to its saved id', async () => {
    sourceId = `gen-fix-${Date.now()}`;
    // Rate the recommendation (this is allowed for gen-… ids and learns once).
    const rated = await request('POST', `/outfits/${sourceId}/rating`, {
      token: demo,
      body: { rating: 5 },
    });
    assert.equal(rated.status, 200);

    const memoryBefore = JSON.stringify(store.load().styleMemories);

    const created = await request('POST', '/outfits', {
      token: demo,
      body: {
        name: 'Transferred Rating Look',
        itemIds: ['w1', 'w2', 'w4'],
        compatibilityScore: 80,
        sourceOutfitId: sourceId,
      },
    });
    assert.equal(created.status, 201);
    const newId = created.body.outfit.id;

    // The new record reads back the transferred rating...
    const read = await request('GET', `/outfits/${newId}/rating`, { token: demo });
    assert.equal(read.status, 200);
    assert.equal(read.body.rating, 5);

    // ...exactly one row exists for it, and the source is untouched.
    assert.equal(feedbackRowsFor(newId, 'u_demo').length, 1);
    assert.equal(feedbackRowsFor(sourceId, 'u_demo')[0].rating, 5);

    // The transfer itself must not have learned anything.
    assert.equal(JSON.stringify(store.load().styleMemories), memoryBefore, 'transfer changed StyleMemory');
  });

  await t.test('rating — no rating is fabricated when the source has none', async () => {
    const created = await request('POST', '/outfits', {
      token: demo,
      body: {
        name: 'Unrated Source',
        itemIds: ['w1', 'w2'],
        compatibilityScore: 80,
        sourceOutfitId: `gen-unrated-${Date.now()}`,
      },
    });
    assert.equal(created.status, 201);
    const newId = created.body.outfit.id;
    const read = await request('GET', `/outfits/${newId}/rating`, { token: demo });
    assert.equal(read.body.rating, null);
    assert.equal(feedbackRowsFor(newId, 'u_demo').length, 0);
  });

  await t.test('rating — another user\'s rating is never transferred', async () => {
    const other = await register(`fix-other-${Date.now()}@example.com`);
    const shared = `gen-shared-${Date.now()}`;
    // The other user rates the shared recommendation.
    const rated = await request('POST', `/outfits/${shared}/rating`, {
      token: other,
      body: { rating: 1 },
    });
    assert.equal(rated.status, 200);

    // Demo saves it; demo must get no transferred rating from the other user.
    const created = await request('POST', '/outfits', {
      token: demo,
      body: {
        name: 'Shared Source',
        itemIds: ['w1', 'w2'],
        compatibilityScore: 80,
        sourceOutfitId: shared,
      },
    });
    const newId = created.body.outfit.id;
    const read = await request('GET', `/outfits/${newId}/rating`, { token: demo });
    assert.equal(read.body.rating, null, "another user's rating must not leak");
    assert.equal(feedbackRowsFor(newId, 'u_demo').length, 0);
  });

  await t.test('rating — the transfer is idempotent (no duplicate row, no double count)', async () => {
    // The helper itself is the idempotent unit; the endpoint mints a new id per
    // save, so drive the helper directly against the persisted db.
    const db = store.load();
    const source = `gen-idem-${Date.now()}`;
    const target = `o_idem_${Date.now()}`;
    history.saveRating(db, { userId: 'u_demo', outfitId: source, rating: 4 });

    const first = history.transferRating(db, { userId: 'u_demo', fromOutfitId: source, toOutfitId: target });
    const second = history.transferRating(db, { userId: 'u_demo', fromOutfitId: source, toOutfitId: target });

    assert.equal(first.transferred, true);
    assert.equal(second.transferred, false, 'a repeat transfer is a no-op');
    assert.equal(history.readRating(db, { userId: 'u_demo', outfitId: target }), 4);
    assert.equal(
      (db.feedback || []).filter((r) => r.outfitId === target && r.userId === 'u_demo').length,
      1,
      'exactly one rating row for the target',
    );
  });

  await t.test('explanation — survives save, retrieval and reopen', async () => {
    const explanation = 'Oxford shirt + chinos — the palette is calm and the occasion fit is strong.';
    const created = await request('POST', '/outfits', {
      token: demo,
      body: {
        name: 'Explained Look',
        itemIds: ['w1', 'w11'],
        compatibilityScore: 86,
        explanation,
      },
    });
    assert.equal(created.status, 201);
    const id = created.body.outfit.id;

    const fetched = await request('GET', `/outfits/${id}`);
    assert.equal(fetched.body.outfit.explanation, explanation);

    const list = await request('GET', '/outfits/saved', { token: demo });
    const row = list.body.outfits.find((o) => o.id === id);
    assert.equal(row.explanation, explanation);
  });

  await t.test('explanation — legacy records without one still return safely', async () => {
    // o1 is a seeded record: no explanation field at all.
    const fetched = await request('GET', '/outfits/o1');
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.outfit.explanation, undefined);
    const list = await request('GET', '/outfits/saved', { token: demo });
    assert.ok(list.body.outfits.some((o) => o.id === 'o1'));
  });
});
