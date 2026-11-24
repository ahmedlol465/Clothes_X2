/** 8.1 Auth routes. */
'use strict';
const express = require('express');
const crypto = require('crypto');
const store = require('../data/store');
const { auth, findSession, pruneSessions } = require('../middleware/auth');
const { readStyleProfile, profilePayload } = require('../lib/style-profile');
const { now, db, persist } = require('../lib/context');

const router = express.Router();

// ================================================================== 8.1 Auth
router.post('/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required.' });
  if (db.users.some((u) => u.email === String(email).toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered.' });
  }
  const user = {
    id: store.uid('u'), name: name || email.split('@')[0], email: String(email).toLowerCase(),
    passwordHash: store.hashPassword(password), createdAt: now(), avatarUrl: null,
    styleProfile: readStyleProfile(null),
  };
  const token = crypto.randomBytes(24).toString('hex');
  db.users.push(user);
  db.sessions.push({ token, userId: user.id, createdAt: now() });
  persist();
  res.status(201).json({ user: profilePayload(user), accessToken: token, refreshToken: token });
});

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find((u) => u.email === String(email || '').toLowerCase());
  const check = user ? store.verifyPassword(password, user.passwordHash) : { ok: false };
  if (!check.ok) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  // Legacy unsalted SHA-256 hash: silently upgrade to bcrypt now that we have the plaintext.
  if (check.upgrade) user.passwordHash = store.hashPassword(password);
  pruneSessions();
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions.push({ token, userId: user.id, createdAt: now() });
  persist();
  res.json({ user: profilePayload(user), accessToken: token, refreshToken: token });
});

router.post('/auth/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  const session = findSession(refreshToken);
  if (!session) return res.status(401).json({ error: 'Invalid refresh token.' });
  pruneSessions();
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions.push({ token, userId: session.userId, createdAt: now() });
  persist();
  res.json({ accessToken: token, refreshToken: token });
});

router.post('/auth/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').slice(7);
  db.sessions = db.sessions.filter((s) => s.token !== token);
  persist();
  res.json({ ok: true });
});

module.exports = router;
