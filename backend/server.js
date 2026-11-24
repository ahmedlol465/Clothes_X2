/**
 * SmartWardrobe backend entry point.
 *
 *   npm install && npm start   ->   http://localhost:3001   (endpoint index: GET /docs)
 *
 * The Express app itself lives in src/app.js; this file loads the environment,
 * initialises storage and binds the port. Requiring this module (as the
 * integration tests do) only exports the app and never listens.
 */
'use strict';
require('dotenv').config(); // backend/.env (gitignored): API keys, DB_* settings
const app = require('./src/app');

const PORT = process.env.EXPRESS_PORT || process.env.PORT || 3001;

async function start() {
  const store = require('./src/data/store');
  const { db } = require('./src/lib/context');
  try {
    const info = await store.init(db);
    console.log(`[db] ${info.driver}`, info.host ? `${info.host}/${info.database}` : info.file || '', info.imported ? `(imported ${info.imported})` : '');
  } catch (e) {
    console.error(`\n[db] Could not start the ${store.driver} database: ${e.message}\n` +
      'Check DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME in backend/.env (see backend/.env.example),\n' +
      'or run `docker compose up -d db` from backend/ to start a local MySQL.\n');
    process.exit(1);
  }
  const retrieval = require('./src/services/retrieval');
  const server = app.listen(PORT, () =>
    console.log(`SmartWardrobe backend listening on http://localhost:${PORT}  (docs: /docs)`),
  );

  // Preload the local embedding model in the background so the first stylist
  // request is not the slow one. Optional: on failure retrieval falls back to
  // lexical scoring and the server is unaffected.
  retrieval.warmup().then((ok) => {
    if (ok) console.log('[ai] local embeddings ready');
    else console.log('[ai] embeddings unavailable, using lexical retrieval');
  });
  const shutdown = async () => {
    server.close();
    try { await store.close(); } finally { process.exit(0); }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(
        `\nPort ${PORT} is already in use: another copy of the backend is already running.\n` +
          `You do NOT need to start it again: open http://localhost:${PORT}/docs to use it.\n` +
          `To run your own copy, stop the other one first, e.g.:\n` +
          `  netstat -ano | findstr :${PORT}\n  taskkill /PID <number> /F\n`,
      );
      process.exit(1);
    }
    throw err;
  });
}

if (require.main === module) start();

module.exports = app;
