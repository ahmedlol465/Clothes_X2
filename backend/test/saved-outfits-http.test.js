/**
 * Saved-outfit HTTP integration tests (§8.5).
 *
 * These differ from saved-outfits.test.js on purpose: that file unit-tests the
 * relationship module against hand-built objects, while this one boots the real
 * Express app from server.js and drives the actual routes over HTTP, including
 * auth, route order and persistence.
 *
 * Isolation: SMARTWARDROBE_DATA_DIR is pointed at a throwaway temp directory
 * BEFORE server.js/store.js are required, so the store loads and persists there
 * and backend/data/db.json is never opened for writing (asserted at the end).
 *
 * Coverage:
 *   A  GET /outfits/saved is auth-only, returns per-user outfit records, and
 *      the literal route beats GET /outfits/:id
 *   B  POST /outfits auto-saves for the verified creator; POST :id/save is
 *      idempotent
 *   C  DELETE :id/save removes only the relationship — record, feedback and
 *      StyleMemory are untouched
 *   D  unknown ids: save 404 / unsave no-op / unauthenticated 401
 *   E  two users are isolated
 *   F  an ANONYMOUS POST /outfits creates the record but saves it for nobody
 *      (regression: optionalAuth must not attribute it to db.users[0])
 *   G  deleting an outfit purges relationships for every user
 *   H  relationships persist to disk with deterministic ids across a reload
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before the app is required: store.js resolves its data directory
// at import time and server.js loads the db immediately.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-saved-http-'));
process.env.SMARTWARDROBE_DATA_DIR = TMP_DIR;

const app = require('../server');
const store = require('../src/store');
const savedOutfits = require('../src/saved-outfits');

const REAL_DB = path.join(__dirname, '..', 'data', 'db.json');
const realBefore = fs.existsSync(REAL_DB) ? fs.statSync(REAL_DB) : null;

let server;
let base;

function savedIdsFor(db, userId) {
  return (db.savedOutfits || [])
    .filter((r) => r && r.userId === userId)
    .map((r) => r.outfitId);
}

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
    body: { name: 'HTTP Test', email, password: 'secret123' },
  });
  assert.ok(res.status === 201, `register failed for ${email}: ${res.status}`);
  return res.body.accessToken;
}

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // The test must never have touched the real store.
  if (realBefore) {
    const realAfter = fs.statSync(REAL_DB);
    assert.equal(realAfter.mtimeMs, realBefore.mtimeMs, 'backend/data/db.json was written');
    assert.equal(realAfter.size, realBefore.size, 'backend/data/db.json changed size');
  }
  assert.ok(fs.existsSync(path.join(TMP_DIR, 'db.json')), 'temp store was not used');
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

test('saved outfits over HTTP', async (t) => {
  const demo = await login('karim@fashiontech.com', 'wardrobe2024');

  await t.test('A — GET /outfits/saved is auth-only and per-user; literal route wins', async () => {
    const anon = await request('GET', '/outfits/saved');
    assert.equal(anon.status, 401);

    const res = await request('GET', '/outfits/saved', { token: demo });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.outfits));
    assert.deepEqual(res.body.outfits.map((o) => o.id).sort(), ['o1', 'o2', 'o3', 'o4']);
    for (const outfit of res.body.outfits) {
      // Outfit records, not raw relationship rows.
      assert.equal(typeof outfit.name, 'string');
      assert.ok(Array.isArray(outfit.itemIds));
      assert.equal(outfit.userId, undefined);
      assert.equal(outfit.id.startsWith('so_'), false);
    }

    // optionalAuth reads stay open: :id still works anonymously.
    const rec = await request('GET', '/outfits/o1');
    assert.equal(rec.status, 200);
    assert.equal(rec.body.outfit.id, 'o1');
  });

  let ownedId;
  await t.test('B — authenticated POST /outfits auto-saves; POST :id/save is idempotent', async () => {
    const created = await request('POST', '/outfits', {
      token: demo,
      body: { name: 'HTTP Owned Outfit', itemIds: ['w1', 'w2'] },
    });
    assert.equal(created.status, 201);
    ownedId = created.body.outfit.id;

    let saved = await request('GET', '/outfits/saved', { token: demo });
    assert.ok(saved.body.outfits.some((o) => o.id === ownedId), 'creator did not get auto-save');

    const first = await request('POST', `/outfits/${ownedId}/save`, { token: demo });
    assert.equal(first.status, 200);
    assert.equal(first.body.saved, true);
    assert.equal(first.body.outfit.id, ownedId);

    const before = (await request('GET', '/outfits/saved', { token: demo })).body.outfits.length;
    const second = await request('POST', `/outfits/${ownedId}/save`, { token: demo });
    assert.equal(second.status, 200);
    const after = (await request('GET', '/outfits/saved', { token: demo })).body.outfits.length;
    assert.equal(after, before, 're-saving duplicated the relationship');
  });

  await t.test('C — DELETE :id/save removes only the relationship', async () => {
    const rated = await request('POST', `/outfits/${ownedId}/feedback`, {
      token: demo,
      body: { rating: 5 },
    });
    assert.ok(rated.status < 400, `feedback failed: ${rated.status}`);

    const beforeDisk = store.load();
    const memoryBefore = JSON.stringify(beforeDisk.styleMemory);
    const feedbackCount = (beforeDisk.feedback || []).filter((f) => f.outfitId === ownedId).length;
    const historyBefore = JSON.stringify(beforeDisk.recommendationHistory || []);

    const res = await request('DELETE', `/outfits/${ownedId}/save`, { token: demo });
    assert.equal(res.status, 200);
    assert.equal(res.body.saved, false);
    assert.equal(res.body.removed, 1);

    // The record survives the unsave.
    const rec = await request('GET', `/outfits/${ownedId}`);
    assert.equal(rec.status, 200);
    assert.equal(rec.body.outfit.id, ownedId);

    const saved = await request('GET', '/outfits/saved', { token: demo });
    assert.ok(!saved.body.outfits.some((o) => o.id === ownedId));

    const repeat = await request('DELETE', `/outfits/${ownedId}/save`, { token: demo });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.removed, 0);

    const afterDisk = store.load();
    assert.ok(!(afterDisk.savedOutfits || []).some((r) => r.outfitId === ownedId));
    assert.ok(afterDisk.outfits.some((o) => o.id === ownedId), 'record was deleted by unsave');
    assert.equal(JSON.stringify(afterDisk.styleMemory), memoryBefore, 'unsave changed StyleMemory');
    assert.equal(
      (afterDisk.feedback || []).filter((f) => f.outfitId === ownedId).length,
      feedbackCount,
      'unsave changed feedback',
    );
    assert.equal(
      JSON.stringify(afterDisk.recommendationHistory || []),
      historyBefore,
      'unsave changed recommendation history',
    );
  });

  await t.test('D — unknown ids and missing auth', async () => {
    const saveUnknown = await request('POST', '/outfits/nope_missing/save', { token: demo });
    assert.equal(saveUnknown.status, 404);

    const unsaveUnknown = await request('DELETE', '/outfits/nope_missing/save', { token: demo });
    assert.equal(unsaveUnknown.status, 200);
    assert.equal(unsaveUnknown.body.removed, 0);

    const saveNoToken = await request('POST', '/outfits/o1/save');
    assert.equal(saveNoToken.status, 401);
    const unsaveNoToken = await request('DELETE', '/outfits/o1/save');
    assert.equal(unsaveNoToken.status, 401);
  });

  await t.test('E — two users are isolated', async () => {
    const other = await register('http-second@example.com');

    const startOther = await request('GET', '/outfits/saved', { token: other });
    assert.deepEqual(startOther.body.outfits, []);

    const save = await request('POST', '/outfits/o1/save', { token: other });
    assert.equal(save.status, 200);
    const otherSaved = await request('GET', '/outfits/saved', { token: other });
    assert.deepEqual(otherSaved.body.outfits.map((o) => o.id), ['o1']);

    // The other user's save must not leak into demo's list, and vice versa.
    const demoSaved = await request('GET', '/outfits/saved', { token: demo });
    assert.ok(demoSaved.body.outfits.some((o) => o.id === 'o1'));
    assert.ok(demoSaved.body.outfits.some((o) => o.id === 'o4'));

    await request('DELETE', '/outfits/o1/save', { token: other });
    const otherAfter = await request('GET', '/outfits/saved', { token: other });
    assert.deepEqual(otherAfter.body.outfits, []);
    const demoAfter = await request('GET', '/outfits/saved', { token: demo });
    assert.ok(demoAfter.body.outfits.some((o) => o.id === 'o1'), "other user's unsave hit demo");
  });

  await t.test('F — anonymous POST /outfits saves for nobody (security fix)', async () => {
    const before = store.load();
    const countBefore = (before.savedOutfits || []).length;
    const demoIdsBefore = savedIdsFor(before, 'u_demo').slice().sort();

    const created = await request('POST', '/outfits', {
      body: { name: 'Anonymous Outfit', itemIds: ['w1'] },
    });
    assert.equal(created.status, 201);
    const anonId = created.body.outfit.id;

    // The record exists and is readable...
    const rec = await request('GET', `/outfits/${anonId}`);
    assert.equal(rec.status, 200);
    assert.equal(rec.body.outfit.id, anonId);

    // ...but no relationship was written for anyone.
    const after = store.load();
    assert.equal((after.savedOutfits || []).length, countBefore, 'anonymous create added a relationship');
    assert.deepEqual(savedIdsFor(after, 'u_demo').slice().sort(), demoIdsBefore);
    assert.ok(!(after.savedOutfits || []).some((r) => r.outfitId === anonId));

    const demoView = await request('GET', '/outfits/saved', { token: demo });
    assert.ok(!demoView.body.outfits.some((o) => o.id === anonId), 'anonymous outfit leaked into demo saves');
  });

  await t.test('G — deleting an outfit purges relationships for every user', async () => {
    const other = await login('http-second@example.com', 'secret123');

    const created = await request('POST', '/outfits', {
      token: demo,
      body: { name: 'Purge Me', itemIds: ['w1', 'w3'] },
    });
    const purgeId = created.body.outfit.id;
    await request('POST', `/outfits/${purgeId}/save`, { token: other });

    let disk = store.load();
    assert.ok((disk.savedOutfits || []).some((r) => r.outfitId === purgeId));

    const del = await request('DELETE', `/outfits/${purgeId}`, { token: demo });
    assert.equal(del.status, 200);

    disk = store.load();
    assert.ok(!(disk.savedOutfits || []).some((r) => r.outfitId === purgeId), 'dangling relationship');
    assert.ok(!disk.outfits.some((o) => o.id === purgeId));
    assert.ok((disk.savedOutfits || []).some((r) => r.outfitId === 'o1'), 'unrelated saves were purged');
  });

  await t.test('H — relationships persist with deterministic ids across a reload', async () => {
    const first = store.load();
    const second = store.load();
    assert.deepEqual(savedIdsFor(first, 'u_demo').slice().sort(), savedIdsFor(second, 'u_demo').slice().sort());
    assert.ok(savedIdsFor(second, 'u_demo').includes('o1'));

    for (const row of second.savedOutfits || []) {
      assert.equal(row.id, savedOutfits.relationshipId(row.userId, row.outfitId));
    }
  });
});
