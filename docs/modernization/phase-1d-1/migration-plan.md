# Phase 1D-1 — Auth & Users Persistence Migration Plan (Corrected)

## Executive Summary

Migrate `AuthService` and `JwtStrategy` from `LegacyDbService` to TypeORM repositories (`UserRepository` + `StyleProfileRepository`). `UsersService` already uses TypeORM repos directly — no changes needed. Express `server.js` remains unchanged (separate JSON store).

**Critical corrections from original plan:**
1. **JwtStrategy MUST be migrated** — uses `LegacyDbService.findUser()` which reads from in-memory document; would fail to find users created via TypeORM
2. **SessionRepository NOT needed** — AuthService uses JWT tokens only, doesn't touch Session entity
3. **UserProfileRepository NOT needed** — AuthService doesn't manage UserProfile; UsersService handles it separately
4. **`passwordHash: select: false`** — must use `.addSelect('user.passwordHash')` for auth queries
5. **User IDs are not UUIDs** — existing IDs like `u_demo` preserved via explicit ID on create

## Current State

### Three separate persistence mechanisms

| Layer | Runtime | Mechanism | Store | Consumers |
|-------|---------|-----------|-------|-----------|
| Express | Port 3001/3002 | `store.ts` → `data/db.json` | JSON file | All Express routes |
| NestJS Auth | Port 3000 | `LegacyDbService` → MySQL snapshot | MySQL tables | AuthService, JwtStrategy |
| NestJS Features | Port 3000 | TypeORM `@InjectRepository` → MySQL direct | MySQL tables | Wardrobe, Outfits, Planner, Shop, Stylist, Users, Admin |

### Critical conflict

`AuthService` (LegacyDbService) and `UsersService` (TypeORM) both write to `users` table. LegacyDbService's full-snapshot `persist()` overwrites direct TypeORM writes.

### Express and NestJS are separate stores

Express writes to `data/db.json`; NestJS writes to MySQL tables. **This phase does NOT unify them.** Express auth routes remain unchanged.

## Source of Truth After Migration

| Component | Persistence Mechanism | Store |
|-----------|----------------------|-------|
| NestJS AuthService | `UserRepository` + `StyleProfileRepository` | MySQL `users`, `style_profiles` |
| NestJS JwtStrategy | `UserRepository` | MySQL `users` |
| NestJS UsersService | `UserRepository` + `StyleProfileRepository` | MySQL `users`, `style_profiles`, `user_profiles` |
| Express `server.js` | `store.ts` → `data/db.json` | JSON file (unchanged) |
| Flutter client | Calls Express on port 3001/3002 | Unchanged |

## Exact Source Files to Modify (3 files only)

| File | Change |
|------|--------|
| `backend/src/modules/auth/auth.service.ts` | Replace `LegacyDbService` injection with `UserRepository` + `StyleProfileRepository`; replace all `this.legacy.*` calls |
| `backend/src/modules/auth/auth.module.ts` | Add `TypeOrmModule.forFeature([User, StyleProfile])` to imports; remove `LegacyDbService` from providers |
| `backend/src/modules/auth/jwt.strategy.ts` | Replace `LegacyDbService` injection with `UserRepository`; replace `this.legacy.findUser()` with `userRepo.findOne()` |

### Files NOT Modified (Strict Scope)

- `backend/server.js` (Express runtime unchanged)
- `backend/src/store.ts` (Express JSON store unchanged)
- `backend/src/common/legacy/legacy-db.service.ts` (not removed yet — other domains still use it)
- `backend/src/common/legacy/legacy-module.ts` (not removed yet)
- `backend/src/common/legacy/legacy-types.ts` (not removed yet)
- `backend/src/common/legacy/legacy-style.ts` (still used by UsersService for `profilePayload()`)
- `backend/src/database/entities/*.ts` (no entity changes)
- `backend/src/database/migrations/*.ts` (no new migrations)
- `backend/src/modules/users/users.service.ts` (already uses TypeORM repos)
- `backend/src/modules/users/users.controller.ts` (unchanged)
- `backend/src/modules/auth/auth.controller.ts` (unchanged)
- `lib/` (Flutter unchanged)

## User ID Compatibility

### Problem

User entity uses `@PrimaryGeneratedColumn('uuid')` but existing users have IDs like `u_demo` and `u_xxxxxxxx` (from `legacy.uid('u')` = `u_` + 6 hex bytes).

### Solution

TypeORM accepts explicitly provided IDs on `create()`. Migration plan must:

1. Preserve existing user IDs by explicitly setting `id` on `userRepo.create()`
2. Generate new IDs using `legacy.uid('u')` format for new registrations (consistent with existing format)
3. Do NOT change `@PrimaryGeneratedColumn('uuid')` (entity changes out of scope)

### Example

```typescript
// New registration
const user = this.userRepo.create({
  id: `u_${crypto.randomBytes(6).toString('hex')}`,  // Same format as legacy.uid('u')
  email: dto.email.toLowerCase(),
  passwordHash: await bcrypt.hash(dto.password, rounds),
  name: name.trim(),
  ...
});
await this.userRepo.save(user);
```

## `passwordHash: select: false` Handling

### Problem

`User.passwordHash` has `select: false`. `userRepo.findOne({ where: { email } })` won't return the hash.

### Solution

Use `createQueryBuilder` with `.addSelect()` for auth operations that need the hash:

```typescript
const user = await this.userRepo
  .createQueryBuilder('user')
  .addSelect('user.passwordHash')
  .where('user.email = :email', { email })
  .getOne();
```

For all other operations (profile, logout, refresh), use standard `findOne()` without password hash.

## Field Mapping: User Entity → LegacyUser Shape

AuthService methods (`issueSession`, `findById`) expect `LegacyUser`-shaped objects. Adapter function:

```typescript
function userToLegacyUser(user: User, styleProfile: StyleProfile | null): LegacyUser {
  const dimensions = (styleProfile?.dimensions ?? {}) as Record<string, unknown>;
  return {
    id: user.id,
    name: user.name ?? user.email.split('@')[0],
    email: user.email,
    passwordHash: user.passwordHash ?? null,
    createdAt: user.createdAt?.toISOString() ?? new Date().toISOString(),
    avatarUrl: user.avatarUrl ?? null,
    styleProfile: {
      favoriteColors: Array.isArray(dimensions.favoriteColors) ? dimensions.favoriteColors : [],
      preferredStyles: Array.isArray(dimensions.preferredStyles) ? dimensions.preferredStyles : [],
      avoidedColors: Array.isArray(dimensions.avoidedColors) ? dimensions.avoidedColors : [],
      heightCm: typeof dimensions.heightCm === 'number' ? dimensions.heightCm : null,
      weightKg: typeof dimensions.weightCm === 'number' ? dimensions.weightCm : null,
      fitPreference: typeof dimensions.fitPreference === 'string' ? dimensions.fitPreference : 'regular',
      sizes: {
        top: typeof dimensions.sizes?.top === 'string' ? dimensions.sizes.top : null,
        bottom: typeof dimensions.sizes?.bottom === 'string' ? dimensions.sizes.bottom : null,
        shoe: typeof dimensions.sizes?.shoe === 'string' ? dimensions.sizes.shoe : null,
      },
    },
    tokenVersion: user.tokenVersion ?? 0,
    role: user.role ?? 'user',
  };
}
```

## StyleProfile Storage Format

`StyleProfile.dimensions` is `Record<string, number> | null`. For Phase 1D-1, store actual legacy values (not counts):

```typescript
const styleProfile = this.styleProfileRepo.create({
  userId: user.id,
  dimensions: {
    favoriteColors: [],        // string[] stored in JSON
    preferredStyles: [],       // string[] stored in JSON
    avoidedColors: [],         // string[] stored in JSON
    heightCm: null,            // number stored in JSON
    weightKg: null,            // number stored in JSON
    fitPreference: 'regular',  // string stored in JSON
    sizes: { top: null, bottom: null, shoe: null },
  },
  overallConfidence: 0,
});
await this.styleProfileRepo.save(styleProfile);
```

Note: `UsersService.updateStyleProfile()` has a pre-existing bug storing counts instead of values — **not fixed in Phase 1D-1**.

## Transaction Boundaries

| Operation | Transaction | Repositories from Transaction Manager |
|-----------|-------------|--------------------------------------|
| `register()` | Yes | `userRepo`, `styleProfileRepo` |
| `socialLogin()` | Yes | `userRepo`, `styleProfileRepo` |
| `login()` (SHA-256 upgrade) | Yes | `userRepo` (passwordHash update) |
| `logout()` | Yes | `userRepo` (tokenVersion increment) |
| `refresh()` | No | Read-only |
| `profile()` (UsersService) | No | Read-only (already exists) |

Implementation uses `this.userRepo.manager.transaction(async (manager) => { ... })` for multi-entity operations.

## Concurrency Handling

| Scenario | Strategy |
|----------|----------|
| Concurrent registration (same email) | Database unique constraint on `email` rejects second insert; catch `QueryFailedError`, return 409 |
| Concurrent logout (tokenVersion) | Accept best-effort race (tokenVersion is best-effort invalidation) |
| Concurrent social login (same email) | Same as concurrent registration |

## Data Integrity Verification

### Before Migration
- Count MySQL `users` table rows
- Check duplicate emails: `SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1`
- Verify LegacyDbService can still read/write (baseline)

### After Migration
- Count MySQL `users` table rows (should match before)
- No duplicate emails
- `userRepo.findOne({ where: { email: 'karim@fashiontech.com' } })` returns demo user (if exists)
- Password verification works for bcrypt hash
- SHA-256 legacy hash upgrade works on login
- Role preservation (`role: 'user'` for demo user)
- Registration + login flow works end-to-end

### Cannot Verify (No MySQL Available)
- Database integration tests
- Concurrent write behavior under load
- Foreign key enforcement

## Rollback Procedure

1. `git revert` or `git stash` the three modified files
2. Restore `AuthModule` providers: `[AuthService, JwtStrategy, LegacyDbService]`
3. Restore `AuthService` constructor: inject `LegacyDbService`
4. Restore `JwtStrategy` constructor: inject `LegacyDbService`
5. `npm run build` + `npm test` to confirm pre-migration state

No database schema changes → no schema rollback needed.

## Stop Conditions

- User registration/login breaks after migration → stop, rollback
- Duplicate emails exist in MySQL and cannot be resolved → stop, document
- SHA-256 legacy hash verification fails after migration → stop, fix
- JwtStrategy cannot validate existing JWT tokens → stop, rollback
- Express auth routes are affected → stop (they should not be touched)
- MySQL/PostgreSQL unavailable for integration testing → document limitation, do not claim database compatibility
