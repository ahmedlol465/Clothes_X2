/**
 * Express app factory. Builds the app (middleware + routers) without binding a
 * port, so tests can import it and server.js can listen on it.
 */
'use strict';
const express = require('express');
const cors = require('cors');
const { STORAGE_DIR } = require('./lib/storage');

// Allowed browser origins. Native Flutter apps send no Origin header and are
// never blocked by CORS, so the default only needs the local web/dev origins.
// Set CORS_ORIGINS=https://a.com,https://b.com (or "*" to allow everything).
function corsOptions() {
  const raw = (process.env.CORS_ORIGINS || '').trim();
  if (raw === '*') return {};
  const extra = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.0\.2\.2)(:\d+)?$/;
  return {
    origin(origin, cb) {
      if (!origin || local.test(origin) || extra.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  };
}

const app = express();
app.use(cors(corsOptions()));
app.use(express.json({ limit: '10mb' }));
app.use('/storage', express.static(STORAGE_DIR, { maxAge: '7d' }));

// Route order matters: /outfits/recommended and /outfits/saved are declared
// before /outfits/:id inside outfits.routes.js.
for (const name of ['auth', 'users', 'wardrobe', 'ai', 'outfits', 'planner', 'shop', 'admin', 'misc']) {
  app.use(require(`./routes/${name}.routes`));
}

module.exports = app;
