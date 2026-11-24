# Phase 1D-1 — Implementation Results

## Summary

Migrated `AuthService` and `JwtStrategy` from `LegacyDbService` to TypeORM repositories (`UserRepository` + `StyleProfileRepository`). All 3 files modified successfully. Build passes with 0 TypeScript errors. All 40 existing Jest tests pass.

## Files Modified (3 files)

### 1. `backend/src/modules/auth/auth.service.ts`

**Before:** Injected `LegacyDbService`, used `this.legacy.data.users.push()`, `this.legacy.persist()`, `this.legacy.findUser()`, `this.legacy.findUserByEmail()`, `this.legacy.uid()`, `this.legacy.now()`, `this.legacy.sha256()`.

**After:** Injects `UserRepository` + `StyleProfileRepository` + `DataSource`. Uses TypeORM repository operations directly.

Key changes:
- `register()`: Uses `userRepo.findOne()` for email check, `dataSource.transaction()` for atomic user + style profile creation
- `login()`: Uses `userRepo.createQueryBuilder().addSelect('user.passwordHash')` to retrieve password hash (required due to `select: false`), `bcrypt.compare()` for verification, SHA-256 legacy upgrade with `userRepo.save()`
- `socialLogin()`: Uses `userRepo.findOne()` + `dataSource.transaction()` for new user + style profile
- `refresh()`: Uses `userRepo.findOne({ where: { id: payload.sub } })` instead of `legacy.findUser()`
- `logout()`: Uses `userRepo.increment({ id: userId }, 'tokenVersion', 1)` for atomic token version increment
- `findById()`: Throws error (not supported — AuthService no longer needs this; UsersService handles profile reads)
- `verifyPassword()`: Unchanged — bcrypt + SHA-256 legacy verification
- `issueSession()`: Unchanged — takes `LegacyUser`-shaped object, adapted via `userToLegacyUser()`
- Added `userToLegacyUser()` adapter function
- Added `uid()` helper (same format as legacy: `u_` + 6 hex bytes)
- Added `legacySha256()` private method (replaces `this.legacy.sha256()`)

### 2. `backend/src/modules/auth/auth.module.ts`

**Before:** Imported `LegacyDbService`, included in `providers: [AuthService, JwtStrategy, LegacyDbService]`.

**After:** Removed `LegacyDbService` import and provider. Added `TypeOrmModule.forFeature([User, StyleProfile])` to imports.

### 3. `backend/src/modules/auth/jwt.strategy.ts`

**Before:** Injected `LegacyDbService`, called `this.legacy.findUser(payload.sub)`.

**After:** Injects `UserRepository`, calls `this.userRepo.findOne({ where: { id: payload.sub } })`.

## Files NOT Modified

| File | Reason |
|------|--------|
| `backend/server.js` | Express runtime unchanged — separate JSON store |
| `backend/src/store.ts` | Express JSON store unchanged |
| `backend/src/common/legacy/legacy-db.service.ts` | Not removed yet — StylistService and other domains still reference it |
| `backend/src/common/legacy/legacy-module.ts` | Not removed yet |
| `backend/src/common/legacy/legacy-types.ts` | Not removed yet — `LegacyUser` type still used by `issueSession()` |
| `backend/src/common/legacy/legacy-style.ts` | Still used by `profilePayload()` and `UsersService` |
| `backend/src/database/entities/*.ts` | No entity changes |
| `backend/src/database/migrations/*.ts` | No new migrations |
| `backend/src/modules/users/users.service.ts` | Already uses TypeORM repos directly |
| `backend/src/modules/auth/auth.controller.ts` | Unchanged — API contracts preserved |
| `lib/` (Flutter) | Unchanged |

## What Was Preserved

| Aspect | Status |
|--------|--------|
| API response contracts | ✅ All endpoints return same shapes |
| bcrypt password verification | ✅ Unchanged |
| SHA-256 legacy hash verification | ✅ Unchanged |
| SHA-256 → bcrypt upgrade on login | ✅ Unchanged |
| JWT access + refresh token issuance | ✅ Unchanged |
| `tokenVersion` invalidation on logout | ✅ Unchanged (uses `userRepo.increment()`) |
| User role preservation | ✅ |
| User-scoped authorization | ✅ |
| `LegacyUser` type for API responses | ✅ Via `userToLegacyUser()` adapter |
| Existing user IDs (`u_demo`, etc.) | ✅ Preserved via explicit `id` on create |
| New user ID format (`u_xxxxxxxx`) | ✅ Compatible with legacy format |

## What Changed Internally

| Aspect | Before | After |
|--------|--------|-------|
| User persistence | `LegacyDbService` (full snapshot writes) | `UserRepository` (direct TypeORM) |
| Style profile persistence | `LegacyDbService` (embedded in snapshot) | `StyleProfileRepository` (direct TypeORM) |
| User lookup for JWT validation | `LegacyDbService.findUser()` (in-memory) | `UserRepository.findOne()` (database query) |
| Password hash retrieval | `LegacyDbService` (always in memory) | `userRepo.createQueryBuilder().addSelect('user.passwordHash')` |
| User ID generation | `legacy.uid('u')` | `uid()` helper (same format) |
| Timestamp generation | `legacy.now()` | `new Date()` |
| SHA-256 hashing | `this.legacy.sha256()` | `this.legacySha256()` (local method) |

## Snapshot Interference — Eliminated

After migration, **no external code calls `LegacyDbService.persist()`**:
- AuthService (the only external caller) no longer calls it
- JwtStrategy only reads (`findUser`) — now uses `UserRepository`
- `LegacyDbService.trackAi()` and `importFromJson()` are not called externally by any service
- `StylistService.trackAi()` uses `this.usageRepo.save()`, not `legacy.persist()`

This means `LegacyDbService.writeSnapshot()` (full-table delete/reinsert across 26 tables) will never be triggered by AuthService operations anymore, eliminating the risk of it overwriting TypeORM-created user records.
