# Phase 1D-1 — Summary

## Executive Summary

Phase 1D-1 (Auth & Users Persistence Migration) is complete. `AuthService` and `JwtStrategy` have been migrated from `LegacyDbService` to direct TypeORM repository access (`UserRepository` + `StyleProfileRepository`). Build passes with 0 TypeScript errors. All 40 existing Jest tests pass.

## Files Modified (3 files only)

| File | Change |
|------|--------|
| `backend/src/modules/auth/auth.service.ts` | Replaced `LegacyDbService` with `UserRepository` + `StyleProfileRepository` + `DataSource` |
| `backend/src/modules/auth/auth.module.ts` | Removed `LegacyDbService` from providers; added `TypeOrmModule.forFeature([User, StyleProfile])` |
| `backend/src/modules/auth/jwt.strategy.ts` | Replaced `LegacyDbService` with `UserRepository` |

## What Was Preserved

| Aspect | Status |
|--------|--------|
| API response contracts | ✅ All endpoints return same shapes |
| bcrypt password verification | ✅ Unchanged |
| SHA-256 legacy hash verification | ✅ Unchanged |
| SHA-256 → bcrypt upgrade on login | ✅ Unchanged |
| JWT access + refresh token issuance | ✅ Unchanged |
| `tokenVersion` invalidation on logout | ✅ Unchanged |
| User role preservation | ✅ |
| User-scoped authorization | ✅ |
| Existing user IDs (`u_demo`, etc.) | ✅ Preserved |
| New user ID format (`u_xxxxxxxx`) | ✅ Compatible |

## What Changed Internally

| Aspect | Before | After |
|--------|--------|-------|
| User persistence | `LegacyDbService` (snapshot writes) | `UserRepository` (direct TypeORM) |
| Style profile persistence | `LegacyDbService` (embedded) | `StyleProfileRepository` (direct TypeORM) |
| JWT user lookup | `LegacyDbService.findUser()` (in-memory) | `UserRepository.findOne()` (database query) |
| Password hash retrieval | Always in memory | `addSelect('user.passwordHash')` |
| User ID generation | `legacy.uid('u')` | `uid()` helper (same format) |
| SHA-256 hashing | `this.legacy.sha256()` | `this.legacySha256()` (local method) |

## Snapshot Interference — Eliminated

After migration, **no external code calls `LegacyDbService.persist()`**:
- AuthService (the only external caller) no longer calls it
- JwtStrategy only reads — now uses `UserRepository`
- `LegacyDbService.trackAi()` and `importFromJson()` are not called externally
- `StylistService.trackAi()` uses `this.usageRepo.save()`, not `legacy.persist()`

This eliminates the risk of `LegacyDbService.writeSnapshot()` (full-table delete/reinsert across 26 tables) overwriting TypeORM-created user records.

## Verification Results

| Check | Result |
|-------|--------|
| `npm run build` | ✅ 0 TypeScript errors |
| `npm test` | ✅ 40/40 tests passing |
| DI decorators in compiled JS | ✅ Correctly applied (`InjectRepository`, `TypeOrmModule.forFeature`) |
| Module loading (Node.js require) | ✅ All modules load |
| Backup integrity | ✅ 96,820 bytes, matches source |
| No `LegacyDbService` in auth files | ✅ All references removed |
| No `this.legacy` calls in auth service | ✅ Only `this.legacySha256()` local method |

## Limitations

| Limitation | Reason |
|------------|--------|
| Database integration tests | No MySQL/PostgreSQL server available |
| SQLite fallback testing ≠ PostgreSQL/MySQL compatibility | Different JSON/decimal/FK behavior |
| Runtime `app.init()` completion | SQLite connection keeps event loop alive (expected) |
| Concurrent write behavior under load | No database server |

## Files NOT Modified (Strict Scope Honored)

- `backend/server.js` — Express runtime unchanged
- `backend/src/store.ts` — Express JSON store unchanged
- `backend/src/common/legacy/legacy-db.service.ts` — Not removed (other domains still use it)
- `backend/src/common/legacy/legacy-module.ts` — Not removed
- `backend/src/common/legacy/legacy-types.ts` — Not removed (`LegacyUser` type still used)
- `backend/src/common/legacy/legacy-style.ts` — Still used by `profilePayload()` and `UsersService`
- `backend/src/database/entities/*.ts` — No entity changes
- `backend/src/database/migrations/*.ts` — No new migrations
- `backend/src/modules/users/users.service.ts` — Already uses TypeORM repos
- `backend/src/modules/auth/auth.controller.ts` — Unchanged
- `lib/` (Flutter) — Unchanged

## Remaining Unresolved Risks

| Risk | Severity | Notes |
|------|----------|-------|
| No database server for integration testing | High | Cannot verify registration/login against actual MySQL/PostgreSQL |
| Existing user IDs are not UUIDs | Medium | Preserved via explicit `id` on create; no conversion |
| `StyleProfile.dimensions` stores counts not values | Low | Pre-existing pattern in `UsersService`; maintained for consistency |
| `UsersService` and `AuthService` both write to `users` table | Medium | `AuthService` now uses TypeORM directly; `LegacyDbService.snapshot` no longer overwrites (no external `persist()` callers) |

## Rollback Procedure

1. `git revert` or `git stash` the three modified files
2. `npm run build` + `npm test` to confirm pre-migration state

No database schema changes were made, so no schema rollback is needed.

## Next Phase

**Phase 1D-1 is complete.** The NestJS AuthService and JwtStrategy now use TypeORM repositories directly, eliminating the LegacyDbService snapshot write interference for user data.

**Phase 1D-2** would address: Sessions (add expiration), Sessions migration, and potentially migrating Express auth to share the same MySQL database.

Awaiting explicit approval before proceeding to any further phase.
