/** Bearer-token auth middleware. */
'use strict';
const { db } = require('../lib/context');

/** Session lifetime. Override with SESSION_TTL_DAYS. */
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_DAYS || 30) * 24 * 60 * 60 * 1000;

const bearer = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

const isExpired = (session) => {
  const created = Date.parse(session.createdAt || '');
  // Sessions written by older versions without a usable date stay valid.
  return Number.isFinite(created) && Date.now() - created > SESSION_TTL_MS;
};

/** Find a live (non-expired) session for a token. */
function findSession(token) {
  if (!token) return null;
  const session = db.sessions.find((s) => s.token === token);
  return session && !isExpired(session) ? session : null;
}

/** Drop expired sessions so db.sessions cannot grow without bound. */
function pruneSessions() {
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => !isExpired(s));
  return before - db.sessions.length;
}

function auth(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Missing bearer token. POST /auth/login first.' });
  const session = findSession(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired token.' });
  req.user = db.users.find((u) => u.id === session.userId);
  if (!req.user) return res.status(401).json({ error: 'User not found.' });
  next();
}

const optionalAuth = (req, _res, next) => {
  const session = findSession(bearer(req));
  const sessionUser = session ? db.users.find((u) => u.id === session.userId) : null;
  // Reads stay open, but an anonymous caller must never be mistaken for a real
  // account. `req.user` keeps the legacy db.users[0] fallback for response
  // shaping, while `req.authUserId` is set ONLY for a verified session, so
  // endpoints that write per-user data cannot attribute it to db.users[0].
  req.user = sessionUser || db.users[0] || null;
  req.authUserId = sessionUser ? sessionUser.id : null;
  next();
};

/**
 * Admin routes: a valid login AND an email listed in ADMIN_EMAILS
 * (comma separated), or a user record with role "admin". With neither set,
 * admin routes answer 403 to everyone.
 */
function adminOnly(req, res, next) {
  auth(req, res, () => {
    const allowed = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (req.user.role === 'admin' || allowed.includes(String(req.user.email).toLowerCase())) return next();
    return res.status(403).json({ error: 'Admin access required.' });
  });
}

module.exports = { auth, optionalAuth, adminOnly, findSession, pruneSessions };
