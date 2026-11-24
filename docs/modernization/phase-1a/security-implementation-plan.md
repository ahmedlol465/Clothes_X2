# Phase 1A — Security Implementation Plan

## Overview

This plan addresses the critical security findings from Phase 0 without architectural changes. All fixes are backward-compatible and reversible.

## Confirmed Security Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| S-1 | Critical | No rate limiting on any endpoint | All routes (Express + NestJS) |
| S-2 | Critical | Admin endpoints have no role enforcement — any authenticated user is admin | `admin.controller.ts` (NestJS), `server.js` (Express) |
| S-3 | High | CORS `*` with `credentials: true` | `main.ts:40-45`, `server.js:38` |
| S-4 | High | Default JWT secrets in `.env.example` | `.env.example:80-81` |
| S-5 | High | `GEMINI_API_KEY` visible in `.env` | `.env:3` |
| S-6 | Medium | No input validation on Express auth routes | `server.js:342-370` |
| S-7 | Medium | `optionalAuth` falls back to `db.users[0]` (first user) | `server.js:101` |

## Fixes and Priorities

### Fix S-2: Admin Authorization (Critical)

**NestJS (`AdminController`):**
- Add `@Roles(UserRole.ADMIN)` decorator to all 5 admin methods
- `RolesGuard` already exists and checks `user.role` against required roles
- No code changes needed to the guard itself

**Express (`server.js`):**
- Add `auth` middleware to all 5 `/admin/*` routes (currently none have it)
- Add role check: `req.user.role === 'admin'`
- Add `role` field to new user registrations
- Existing users won't have a role → won't be admin (secure default)

**Affected files:**
- `backend/src/modules/admin/admin.controller.ts`
- `backend/server.js`

**Risk:** Low. Admin endpoints currently have no auth at all (Express) or no role check (NestJS). Adding auth+role check only restricts access further.

**Expected behavior:** Only users with `role: 'admin'` can access `/admin/*` endpoints. All others get 403.

**Test strategy:** Unit test RolesGuard with admin/non-admin users. Integration test Express admin routes with/without token and role.

**Rollback:** Remove `@Roles()` decorators and `auth` middleware from Express routes.

---

### Fix S-1: Rate Limiting (Critical)

**Approach:** Implement simple in-memory rate limiter (no new dependencies).

**Express (`server.js`):**
- Add rate limit middleware with per-IP, per-endpoint counters
- Apply to: `/auth/login` (5/min), `/auth/register` (3/min), `/auth/refresh` (10/min), `/ai/*` (20/min), upload endpoints (10/min)
- Return 429 with `Retry-After` header when limit exceeded

**NestJS (`main.ts`):**
- Add global rate limit middleware using `express-rate-limit`-like logic
- Since `@nestjs/throttler` is not installed, implement inline middleware

**Affected files:**
- `backend/server.js`
- `backend/src/main.ts`

**Risk:** Low. Rate limiting is additive — it only rejects excessive requests.

**Expected behavior:** Clients exceeding limits receive HTTP 429. Normal users unaffected.

**Test strategy:** Test that repeated requests to `/auth/login` eventually return 429. Test that legitimate single requests pass.

**Rollback:** Remove rate limit middleware.

---

### Fix S-3: CORS (High)

**NestJS (`main.ts`):**
- Never combine `origin: true` (wildcard) with `credentials: true`
- Default to empty array (no origins) unless explicitly configured
- Allow `localhost` ports for development only via env var

**Express (`server.js`):**
- Replace `app.use(cors())` with restricted origins
- Read `CORS_ORIGINS` env var, default to empty (no CORS) or specific dev origins

**Affected files:**
- `backend/src/main.ts`
- `backend/server.js`

**Risk:** Medium. If CORS_ORIGINS is not set correctly, frontend may be blocked. But this is more secure than wildcard.

**Expected behavior:** Only configured origins can make cross-origin requests. Credentials only sent to same-origin or explicitly allowed origins.

**Test strategy:** Verify CORS headers in response. Test with allowed and disallowed origins.

**Rollback:** Revert to `app.use(cors())` and `origin: true`.

---

### Fix S-4: JWT Secret Security (High)

**NestJS (`configuration.ts`):**
- Remove default JWT secrets (`smartwardrobe-dev-access-secret`, `smartwardrobe-dev-refresh-secret`)
- Fail securely: throw error at startup if `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` not set in production
- In development, allow defaults but log a warning

**`.env.example`:**
- Replace default secrets with `CHANGE_ME` placeholders
- Add comment about generating strong secrets

**Affected files:**
- `backend/src/config/configuration.ts`
- `backend/.env.example`

**Risk:** Medium. Existing deployments using default secrets will need to rotate. But default secrets are inherently insecure.

**Expected behavior:** App refuses to start in production without explicit secrets. Development logs a warning if defaults are used.

**Test strategy:** Verify app starts with explicit secrets. Verify warning logged with defaults in dev.

**Rollback:** Restore default secrets in configuration.ts.

---

### Fix S-5: GEMINI_API_KEY Exposure (High)

**`.env`:**
- Remove `GEMINI_API_KEY` value (leave commented placeholder or remove entirely)
- The key should be provided via environment at deploy time, not stored in the repo

**Affected files:**
- `backend/.env`

**Risk:** Low-Medium. The key is in the working tree (not committed to git), but visible to anyone with filesystem access.

**Expected behavior:** `GEMINI_API_KEY` not present in `.env` file. LLM features degrade gracefully without it (already handled by existing fallback logic).

**Test strategy:** Verify `.env` no longer contains the key. Verify app starts without it.

**Rollback:** Re-add the key to `.env`.

---

### Fix S-6: Input Validation (Medium)

**Express (`server.js`):**
- Add basic validation to `/auth/register` and `/auth/login`
- Validate email format, password length, non-empty fields
- Reject malformed bodies with 400

**Affected files:**
- `backend/server.js`

**Risk:** Low. Validation only adds checks — it doesn't change valid request handling.

**Expected behavior:** Malformed auth requests return 400 with error message.

**Test strategy:** Test invalid email, missing password, empty body return 400.

**Rollback:** Remove validation checks.

---

### Fix S-7: optionalAuth Data Isolation (Medium)

**Express (`server.js`):**
- Change `optionalAuth` to NOT fall back to `db.users[0]`
- When no valid token, `req.user` should be `null`
- Routes that use `optionalAuth` should handle `null` user gracefully

**Affected files:**
- `backend/server.js`

**Risk:** Medium. Some routes may depend on `req.user` being truthy. Need to verify each `optionalAuth` route.

**Expected behavior:** Unauthenticated requests have `req.user = null`. Routes that require auth use `auth` middleware instead.

**Test strategy:** Verify unauthenticated request to optionalAuth route doesn't leak first user's data.

**Rollback:** Restore `db.users[0]` fallback.

---

## Fixes NOT in Scope (Phase 1A constraints)

- LegacyDbService replacement (would require data migration)
- Database schema changes
- New npm dependencies (implement rate limiter inline)
- Express → NestJS rewrite
- Flutter client changes
- AI architecture changes
- BullMQ/Redis enablement

## Rollback Plan

All changes are additive or restrictive. Rollback = revert the specific file changes. Database backup exists at `backend/data/db.json.phase0-backup-20261123-144657`.
