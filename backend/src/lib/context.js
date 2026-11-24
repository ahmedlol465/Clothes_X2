/** Shared runtime state: the in-memory database object, its persist hook and small helpers. */
'use strict';
const store = require('../data/store');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || ''; // e.g. http://localhost:8000

const db = store.load();
const persist = () => store.save(db);

async function proxyAI(path, body) {
  // If a FastAPI AI service is configured, delegate; else use embedded engine.
  if (!AI_SERVICE_URL) return null;
  const res = await fetch(`${AI_SERVICE_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

function trackAi(endpoint, ms, extra = {}) {
  db.aiUsage.push({ endpoint, ms, at: new Date().toISOString(), ...extra });
  if (db.aiUsage.length > 500) db.aiUsage = db.aiUsage.slice(-500);
  persist();
}

const now = () => new Date().toISOString();

function groupBy(rows, key) {
  const out = {};
  for (const r of rows) out[r[key]] = (out[r[key]] || 0) + 1;
  return out;
}

module.exports = { AI_SERVICE_URL, db, persist, proxyAI, trackAi, now, groupBy };
