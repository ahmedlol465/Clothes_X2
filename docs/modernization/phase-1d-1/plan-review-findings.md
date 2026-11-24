# Phase 1D-1 — Plan Review Findings

## Executive Summary

The original migration plan had **3 critical issues** that must be corrected before implementation:

1. **JwtStrategy read-consistency blocker**: JwtStrategy uses `LegacyDbService.findUser()` which reads from an in-memory document hydrated at boot. If AuthService creates a user via TypeORM directly, JwtStrategy won't find that user until LegacyDbService re-hydrates (on restart). **JwtStrategy must be migrated to UserRepository at the same time as AuthService.**

2. **User ID incompatibility**: User entity uses `@PrimaryGeneratedColumn('uuid')` but existing users have IDs like `u_demo` and `u_xxxxxxxx` (from `legacy.uid('u')`). TypeORM will accept explicitly provided IDs, but the migration plan must document this and ensure existing IDs are preserved.

3. **`passwordHash: select: false`**: The User entity has `select: false` on passwordHash. `userRepo.findOne({ where: { email } })` won't return the hash. Need `.addSelect('user.passwordHash')` for login operations.

The original plan's scope (SessionRepository, UserProfileRepository) needs correction:
- **SessionRepository**: NOT needed — AuthService uses JWT tokens only, doesn't touch Session entity
- **UserProfileRepository**: NOT needed for AuthService — UsersService handles UserProfile separately
- **StyleProfileRepository**: NEEDED — AuthService creates style profiles on registration

## Corrected Files to Modify

| File | Change |
|------|--------|
| `backend/src/modules/auth/auth.service.ts` | Replace LegacyDbService with UserRepository + StyleProfileRepository |
| `backend/src/modules/auth/auth.module.ts` | Add `TypeOrmModule.forFeature([User, StyleProfile])`, remove LegacyDbService |
| `backend/src/modules/auth/jwt.strategy.ts` | Replace LegacyDbService with UserRepository (CRITICAL — was missing from original scope) |

**Files NOT modified:** `users.service.ts` (already uses TypeORM), `server.js`, `store.ts`, `legacy-db.service.ts`, entities, migrations, Flutter, controllers

## Unresolved Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Existing user IDs (`u_demo`, `u_xxxxxxxx`) are not UUIDs | High | TypeORM accepts explicit IDs on create; migration plan must preserve them |
| `passwordHash: select: false` | Medium | Use `.addSelect('user.passwordHash')` for auth queries |
| JwtStrategy and AuthService must be migrated atomically | High | Both files changed in same commit; no partial deployment |
| No MySQL/PostgreSQL available for testing | High | Cannot verify database integration; document limitation |
