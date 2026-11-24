/** Photo upload (multer) and /storage helpers (§8.3). */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { now } = require('./context');

// ------------------------------------------------- real photo uploads (§8.3)
// Device photos land in backend/storage/ (gitignored) and are served back at
// GET /storage/<file> so the app can display the exact photo that was taken.
const STORAGE_DIR = path.join(__dirname, '..', '..', 'storage');

fs.mkdirSync(STORAGE_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, STORAGE_DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype || '')) return cb(null, true);
    cb(new Error('Only image files are allowed.'));
  },
});

/** Absolute URL for a stored file, based on the incoming request host. */
function storageUrl(req, filename) {
  return `${req.protocol}://${req.get('host')}/storage/${filename}`;
}

/** Resolve a previously-uploaded /storage/<file> URL to raw bytes. */
function readStoredImage(imageUrl) {
  const m = String(imageUrl || '').match(/\/storage\/([^/?#]+)$/);
  if (!m) return null;
  const file = path.join(STORAGE_DIR, path.basename(m[1]));
  if (!file.startsWith(STORAGE_DIR) || !fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

/**
 * Sniff an image type from its magic bytes.
 *
 * Never trust the filename or a client-supplied content type. `assets/images/
 * item_shirt_white_small.jpg` is PNG data behind a .jpg name, and a decoder
 * handed the wrong type can throw or silently mis-sample.
 */
function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.slice(0, 6).toString('latin1') === 'GIF87a'
    || bytes.slice(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
  if (bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return null;
}

/** True when a URL is served by this backend's own /storage mount. */
function isOwnStorageUrl(u) {
  const m = String(u || '').match(/\/storage\/([^/?#]+)$/);
  return Boolean(m) && path.basename(m[1]) === m[1];
}

/** Absolute filesystem path for one of our /storage files, or null. */
function storagePathOf(storageUrl) {
  const m = String(storageUrl || '').match(/\/storage\/([^/?#]+)$/);
  if (!m) return null;
  const name = path.basename(m[1]);
  if (name !== m[1]) return null; // reject traversal like /storage/../../x
  const file = path.join(STORAGE_DIR, name);
  if (!file.startsWith(STORAGE_DIR + path.sep)) return null;
  return fs.existsSync(file) ? file : null;
}

module.exports = { STORAGE_DIR, upload, storageUrl, readStoredImage, sniffImageMime, isOwnStorageUrl, storagePathOf };
