/**
 * Auth and access-control tests: bcrypt passwords (and upgrade of legacy
 * SHA-256 hashes), session expiry, admin guard, CORS allow-list.
 *
 * Run from backend/:  node --test test/auth-security.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Must be set before the app is required: the store resolves its data
// directory at import time.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-auth-'));
process.env.SMARTWARDROBE_DATA_DIR = TMP_DIR;
process.env.ADMIN_EMAILS = 'boss@example.com';
process.env.CORS_ORIGINS = 'https://app.example.com';

const app = require('../server');
const store = require('../src/data/store');
const { db } = require('../src/lib/context');

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

async function call(method, url, body, token, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

test('new passwords are stored as bcrypt, never plain or SHA-256', async () => {
  const r = await call('POST', '/auth/register', { name: 'A', email: 'a@example.com', password: 'secret-123' });
  assert.equal(r.status, 201);
  const user = db.users.find((u) => u.email === 'a@example.com');
  assert.match(user.passwordHash, /^\$2[aby]\$/);
  assert.equal((await call('POST', '/auth/login', { email: 'a@example.com', password: 'secret-123' })).status, 200);
  assert.equal((await call('POST', '/auth/login', { email: 'a@example.com', password: 'wrong' })).status, 401);
});

test('the login error no longer prints the demo password', async () => {
  const r = await call('POST', '/auth/login', { email: 'nobody@example.com', password: 'x' });
  assert.equal(r.status, 401);
  assert.ok(!JSON.stringify(r.body).includes('wardrobe2024'));
});

test('the demo account still logs in (the Flutter login screen pre-fills it)', async () => {
  const r = await call('POST', '/auth/login', { email: 'karim@fashiontech.com', password: 'wardrobe2024' });
  assert.equal(r.status, 200);
  assert.ok(r.body.accessToken);
});

test('a legacy SHA-256 hash still works once and is upgraded to bcrypt', async () => {
  db.users.push({
    id: 'u_legacy', name: 'Legacy', email: 'legacy@example.com',
    passwordHash: crypto.createHash('sha256').update('old-pass').digest('hex'),
    createdAt: new Date().toISOString(), avatarUrl: null,
  });
  const r = await call('POST', '/auth/login', { email: 'legacy@example.com', password: 'old-pass' });
  assert.equal(r.status, 200);
  assert.match(db.users.find((u) => u.id === 'u_legacy').passwordHash, /^\$2[aby]\$/);
  assert.equal((await call('POST', '/auth/login', { email: 'legacy@example.com', password: 'old-pass' })).status, 200);
});

test('expired sessions are rejected and cannot be refreshed', async () => {
  const login = await call('POST', '/auth/login', { email: 'karim@fashiontech.com', password: 'wardrobe2024' });
  const token = login.body.accessToken;
  assert.equal((await call('GET', '/users/me', null, token)).status, 200);
  const session = db.sessions.find((s) => s.token === token);
  session.createdAt = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
  assert.equal((await call('GET', '/users/me', null, token)).status, 401);
  assert.equal((await call('POST', '/auth/refresh', { refreshToken: token })).status, 401);
});

test('/admin/* needs a login AND an admin email', async () => {
  assert.equal((await call('GET', '/admin/users')).status, 401);
  const user = await call('POST', '/auth/login', { email: 'karim@fashiontech.com', password: 'wardrobe2024' });
  assert.equal((await call('GET', '/admin/users', null, user.body.accessToken)).status, 403);
  await call('POST', '/auth/register', { name: 'Boss', email: 'boss@example.com', password: 'boss-pass-1' });
  const boss = await call('POST', '/auth/login', { email: 'boss@example.com', password: 'boss-pass-1' });
  const r = await call('GET', '/admin/users', null, boss.body.accessToken);
  assert.equal(r.status, 200);
  assert.ok(r.body.users.every((u) => !('passwordHash' in u)));
  assert.equal((await call('GET', '/admin/dashboard', null, boss.body.accessToken)).status, 200);
});

test('CORS: localhost and listed origins are allowed, others are not', async () => {
  const ok = await call('GET', '/health', null, null, { Origin: 'http://localhost:5555' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5555');
  const listed = await call('GET', '/health', null, null, { Origin: 'https://app.example.com' });
  assert.equal(listed.headers.get('access-control-allow-origin'), 'https://app.example.com');
  const bad = await call('GET', '/health', null, null, { Origin: 'https://evil.example.net' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('store.verifyPassword handles bcrypt, legacy and garbage hashes', () => {
  const h = store.hashPassword('pw');
  assert.deepEqual(store.verifyPassword('pw', h), { ok: true, upgrade: false });
  assert.equal(store.verifyPassword('nope', h).ok, false);
  assert.deepEqual(store.verifyPassword('pw', store.sha256('pw')), { ok: true, upgrade: true });
  assert.equal(store.verifyPassword('pw', undefined).ok, false);
  assert.equal(store.verifyPassword('pw', '').ok, false);
});
