/** 8.2 Users routes. */
'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { auth } = require('../middleware/auth');
const { str, readStyleProfile, writeStyleProfile, profilePayload } = require('../lib/style-profile');
const { persist } = require('../lib/context');
const { STORAGE_DIR, upload, storageUrl, isOwnStorageUrl, storagePathOf } = require('../lib/storage');

const router = express.Router();

// ================================================================= 8.2 Users
// Every route here is behind the strict `auth` guard, and the user is always
// resolved from the bearer token. There is no `:id` parameter anywhere, so a
// client cannot address another account by editing a request.

/** GET /users/me — the authenticated user, including their style profile. */
router.get('/users/me', auth, (req, res) => res.json({ user: profilePayload(req.user) }));

/**
 * PATCH /users/me — the only account fields a client may change.
 *
 * `id`, `email` and `passwordHash` are intentionally absent: the subject is
 * taken from the token, and email changes need a verification flow that does
 * not exist yet. `Object.assign(user, body)` would have allowed all three.
 */
router.patch('/users/me', auth, (req, res) => {
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = str(b.name, 80);
    if (!name) return res.status(400).json({ error: 'name cannot be empty.' });
    req.user.name = name;
  }
  if (b.avatarUrl !== undefined) {
    const avatar = str(b.avatarUrl, 500);
    // Avatars may only point at our own storage. Arbitrary http(s) URLs were
    // previously accepted, which let a client render a remote tracking pixel
    // inside someone else's profile card.
    req.user.avatarUrl = avatar && isOwnStorageUrl(avatar) ? avatar : null;
  }
  persist();
  res.json({ user: profilePayload(req.user) });
});

/**
 * POST /users/me/avatar — multipart `photo`, single image.
 *
 * Reuses the same multer disk storage and /storage mount that back
 * POST /wardrobe/upload, so there is exactly one place images are persisted.
 * The subject always comes from the bearer token: a client cannot name another
 * user, and any `userId` field in the body is ignored.
 *
 * The previous avatar is only unlinked once the replacement is on disk, so a
 * failed upload can never leave the profile with a dangling reference.
 */
router.post('/users/me/avatar', auth, (req, res) => {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        error: tooBig ? 'Image must be 10MB or smaller.' : err.message,
      });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Attach an image as photo.' });
    }

    const previous = req.user.avatarUrl;
    req.user.avatarUrl = storageUrl(req, req.file.filename);
    persist();

    // Best effort cleanup, only after the new file is safely written and the
    // new reference is committed. Never delete the file we just stored.
    if (previous && previous !== req.user.avatarUrl) {
      const old = storagePathOf(previous);
      if (old && old !== path.join(STORAGE_DIR, req.file.filename)) {
        try {
          fs.unlinkSync(old);
        } catch {
          /* a stale file is harmless; never fail the request over it */
        }
      }
    }

    res.json({ user: profilePayload(req.user) });
  });
});

/** GET /users/me/style-profile — the style blueprint shown on the Profile page. */
router.get('/users/me/style-profile', auth, (req, res) =>
  res.json({ styleProfile: readStyleProfile(req.user) }));

/** PATCH /users/me/style-profile — persist an edited style profile. */
router.patch('/users/me/style-profile', auth, (req, res) => {
  const styleProfile = writeStyleProfile(req.user, req.body || {});
  persist();
  res.json({ styleProfile, user: profilePayload(req.user) });
});

module.exports = router;
