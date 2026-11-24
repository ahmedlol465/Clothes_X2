# Phase 1D-1 — Legacy Snapshot Interference Analysis

## Background

`LegacyDbService.writeSnapshot()` (lines 497-796) performs:
1. `DELETE FROM <table>` for all 24 tables in `clear()` order (lines 798-828), including `User`
2. Re-INSERTs all data from the in-memory `this.db` document inside one TypeORM transaction

This is a full-table delete/reinsert on every `persist()` call.

## Who Calls `persist()` — Before Migration

| Caller | File | Line | Context |
|--------|------|------|---------|
| `AuthService.register()` | `auth.service.ts` | 64 | After creating user via `this.legacy.data.users.push(user)` |
| `AuthService.login()` (SHA-256 upgrade) | `auth.service.ts` | 81 | After upgrading password hash |
| `AuthService.socialLogin()` | `auth.service.ts` | 109 | After creating social user |
| `AuthService.logout()` | `auth.service.ts` | 142 | After incrementing tokenVersion |
| `LegacyDbService.trackAi()` | `legacy-db.service.ts` | 160 | Internal, after pushing to `db.aiUsage` |
| `LegacyDbService.importFromJson()` | `legacy-db.service.ts` | 863 | One-time migration tool |

## Who Calls `persist()` — After Migration (AuthService → TypeORM)

| Caller | File | Line | After Migration |
|--------|------|------|-----------------|
| `AuthService.register()` | `auth.service.ts` | — | **REMOVED** — uses `userRepo.save()` |
| `AuthService.login()` | `auth.service.ts` | — | **REMOVED** — uses `userRepo.save()` |
| `AuthService.socialLogin()` | `auth.service.ts` | — | **REMOVED** — uses `userRepo.save()` |
| `AuthService.logout()` | `auth.service.ts` | — | **REMOVED** — uses `userRepo.save()` |
| `LegacyDbService.trackAi()` | `legacy-db.service.ts` | 160 | Still exists, but **not called externally** |
| `LegacyDbService.importFromJson()` | `legacy-db.service.ts` | 863 | Still exists, one-time tool only |

## External Callers of `LegacyDbService.trackAi()`

Searched for `legacy.trackAi` and `this.legacy.trackAi` across the codebase — **no external callers found**. `StylistService` has its own `trackAi()` method that uses `this.usageRepo.save()`, not `this.legacy.persist()`.

## External Callers of `LegacyDbService.importFromJson()`

Searched across the codebase — **no external callers found**. One-time migration tool only.

## Remaining LegacyDbService Consumers After Migration

| Consumer | File | Usage | Calls persist()? |
|----------|------|-------|-----------------|
| `JwtStrategy` | `jwt.strategy.ts` | `this.legacy.findUser(payload.sub)` — read-only | NO |
| `LegacyDbService` itself | `legacy-db.service.ts` | Internal hydration + trackAi/importFromJson | Only internally |

## Interference Risk Assessment

### Scenario: AuthService creates user via TypeORM, then LegacyDbService.writeSnapshot() runs

**Before migration:**
- AuthService creates user via `this.legacy.data.users.push(user)` then `this.legacy.persist()`
- Snapshot writes the user from in-memory document → user is persisted

**After migration (AuthService → TypeORM, JwtStrategy → TypeORM):**
- AuthService creates user via `userRepo.save(user)` → user is in MySQL
- No one calls `legacy.persist()` anymore → `writeSnapshot()` never runs
- **No interference**

**Risk scenario: If some future code calls `legacy.persist()`:**
- `writeSnapshot()` DELETEs all users, then re-INSERTs from `this.db.users` (in-memory)
- If `this.db.users` doesn't include the TypeORM-created user → user is LOST
- **Mitigation:** After migration, no code calls `legacy.persist()` externally. LegacyDbService remains as a read-only cache for JwtStrategy (until JwtStrategy is also migrated).

## JwtStrategy Read-Consistency (Critical)

`JwtStrategy.validate()` calls `this.legacy.findUser(payload.sub)` which reads from `this.db.users` (in-memory, hydrated at `onModuleInit()`).

**Problem:** If AuthService creates a user via TypeORM directly, that user is NOT in `this.db.users` until LegacyDbService re-hydrates (on restart). JwtStrategy will throw "Account no longer exists" for that user's JWT.

**Fix:** Migrate JwtStrategy to use `UserRepository.findOne()` instead of `LegacyDbService.findUser()`. This must happen in the same change as AuthService migration.

## Conclusion

The snapshot write interference risk is **eliminated** after migration because:
1. AuthService (the only external caller of `legacy.persist()`) stops calling it
2. No other service calls `legacy.persist()` externally
3. LegacyDbService remains only as a read-source for JwtStrategy (which is also migrated)

**Migration order:** AuthService and JwtStrategy must be migrated together (same commit) to avoid the read-consistency gap.
