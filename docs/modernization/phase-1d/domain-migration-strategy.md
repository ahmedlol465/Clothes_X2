# Phase 1D — Domain Migration Strategy

## Current State Summary

Three separate persistence layers exist:
1. **Express** → `store.ts` → `data/db.json` (JSON file)
2. **NestJS AuthService/JwtStrategy** → `LegacyDbService` → MySQL (full snapshot writes)
3. **NestJS feature services** (7 modules) → TypeORM `@InjectRepository` → MySQL (direct)

**Critical conflict:** `UsersService` and `AuthService` both write to the `users` table via different mechanisms. `LegacyDbService.persist()` overwrites direct TypeORM writes.

## Migration Principles

1. **One domain at a time** — never migrate multiple domains simultaneously
2. **Preserve API contracts** — Flutter client endpoints unchanged
3. **Preserve user-data isolation** — all queries filter by authenticated `userId`
4. **No dual ownership** — a domain is written by either LegacyDbService OR TypeORM repos, never both
5. **Rollback per domain** — each migration has a verified rollback path
6. **Data consistency checks** before and after each migration
7. **No destructive schema changes** — `synchronize` disabled in production, real migrations used
8. **Express remains operational** until its dependencies are migrated
9. **LegacyDbService removed only after all consumers migrated**

## Domain Migration Order

### Phase 1D-1: Auth / Users (Highest conflict risk)

**Why first:** `AuthService` (LegacyDbService) and `UsersService` (TypeORM) both write to `users`. This is the most dangerous conflict.

**Steps:**
1. Verify `UsersService` fully implements all AuthService user operations (create, find by email, find by ID, update)
2. Migrate `AuthService` to inject `UserRepository` + `UserProfileRepository` + `StyleProfileRepository` instead of `LegacyDbService`
3. Remove `LegacyDbService` from `AuthModule` providers
4. Build, test, runtime init
5. Consistency check: create user via NestJS → verify readable via Express JSON store (or vice versa, depending on which is source of truth)

**Rollback:** Re-add `LegacyDbService` to `AuthModule`, revert `AuthService` changes

**Entities affected:** users, user_profiles, style_profiles

---

### Phase 1D-2: Sessions

**Why:** `Session` entity has no expiration (security risk from Phase 1D). AuthService uses `LegacyDbService` for sessions; needs migration to TypeORM.

**Steps:**
1. Add `expiresAt` column to `Session` entity via migration
2. Migrate `AuthService` session operations to `SessionRepository`
3. Remove session handling from `LegacyDbService`
4. Build, test

**Rollback:** Revert `Session` entity change, revert `AuthService` session code

**Entities affected:** sessions

---

### Phase 1D-3: Wardrobe Items

**Why:** `WardrobeService` already uses TypeORM repos directly. LegacyDbService snapshot overwrites wardrobe data on every AuthService write.

**Steps:**
1. Verify `WardrobeService` implements all wardrobe CRUD operations used by Express routes
2. Remove wardrobe-related read/write from `LegacyDbService` (wardrobes, wardrobe_items, brands, categories)
3. Build, test

**Rollback:** Re-add wardrobe table handling to `LegacyDbService`

**Entities affected:** wardrobes, wardrobe_items, brands, categories

---

### Phase 1D-4: Outfits

**Why:** `OutfitsService` already uses TypeORM repos directly. LegacyDbService snapshot overwrites outfit data.

**Steps:**
1. Verify `OutfitsService` implements all outfit operations
2. Remove outfit-related tables from `LegacyDbService` (outfits, outfit_items, outfit_feedback)
3. Build, test

**Rollback:** Re-add outfit table handling to `LegacyDbService`

**Entities affected:** outfits, outfit_items, outfit_feedback

---

### Phase 1D-5: Planner / Events

**Why:** `PlannerService` already uses TypeORM repos directly.

**Steps:**
1. Verify `PlannerService` implements all planner operations
2. Remove planner tables from `LegacyDbService` (calendar_events, event_schedules, weekly_plans)
3. Fix `WeeklyPlan` entity — add `userId` column
4. Build, test

**Rollback:** Re-add planner table handling, revert `WeeklyPlan` change

**Entities affected:** calendar_events, event_schedules, weekly_plans

---

### Phase 1D-6: Shopping / Wishlist

**Why:** `ShopService` already uses TypeORM repos directly.

**Steps:**
1. Verify `ShopService` implements all shopping operations
2. Remove shopping tables from `LegacyDbService` (shopping_items, wishlist_items, purchases)
3. Build, test

**Rollback:** Re-add shopping table handling to `LegacyDbService`

**Entities affected:** shopping_items, wishlist_items, purchases

---

### Phase 1D-7: Stylist / AI Conversations

**Why:** `StylistService` already uses TypeORM repos directly. Most complex domain.

**Steps:**
1. Verify `StylistService` implements all stylist operations (chat, outfit generation, compatibility, conversations)
2. Remove AI tables from `LegacyDbService` (ai_conversations, ai_interactions, ai_usage, style_memories, style_preferences)
3. Build, test

**Rollback:** Re-add AI table handling to `LegacyDbService`

**Entities affected:** ai_conversations, ai_interactions, ai_usage, style_memories, style_preferences

---

### Phase 1D-8: Admin / Read-Only Dashboard

**Why:** `AdminService` reads data for dashboards. No writes via TypeORM (read-only dashboard).

**Steps:**
1. Verify `AdminService` reads are consistent with direct TypeORM queries
2. No LegacyDbService removal needed (AdminService doesn't write via LegacyDbService)
3. Build, test

**Entities affected:** users, wardrobe_items, outfits, calendar_events, outfit_feedback, ai_usage (read-only)

---

### Phase 1D-9: Remove LegacyDbService

**Why:** All consumers migrated.

**Steps:**
1. Verify no remaining imports of `LegacyDbService`
2. Remove `LegacyDbService` class and `LegacyModule`
3. Remove `legacy-types.ts` if unused
4. Build, test
5. Remove `data/db.json` and `store.ts` (Express runtime retirement — separate decision)

**Rollback:** Re-add `LegacyDbService` from git

---

## Migration Readiness Assessment

| Domain | TypeORM Repo Ready? | Express Dependency? | Conflict Risk | Migration Priority |
|--------|--------------------|---------------------|---------------|-------------------|
| Users/Auth | ✅ UsersService exists | ✅ server.js auth routes | High (3 writers) | 1 |
| Sessions | ✅ Session entity | ✅ server.js auth | Medium | 2 |
| Wardrobe | ✅ WardrobeService | ✅ server.js wardrobe | High | 3 |
| Outfits | ✅ OutfitsService | ✅ server.js outfits | High | 4 |
| Planner | ✅ PlannerService | ✅ server.js planner | Medium | 5 |
| Shopping | ✅ ShopService | ✅ server.js shop | Low | 6 |
| Stylist/AI | ✅ StylistService | ✅ server.js AI | Medium | 7 |
| Admin | ✅ AdminService (read) | ✅ server.js admin | Low | 8 |

## Data Consistency Checks

For each migrated domain:

**Before migration:**
1. Count rows in each MySQL table
2. Count items in Express `db.json` for same domain
3. Document any discrepancies

**After migration:**
1. Verify same count in MySQL tables
2. Verify Express JSON store unchanged (if Express still owns it)
3. Verify NestJS API returns same data as Express API for same requests
4. Run existing Jest tests (40/40)

## Rollback Strategy

**Per domain:** Git revert of the specific migration changes + re-add LegacyDbService handling for that domain's tables.

**Full rollback:** `git revert` all Phase 1D changes + restore `data/db.json` from Phase 0 backup.

## Files That Would Need Modification (Implementation Phase)

| File | Changes |
|------|---------|
| `backend/src/modules/auth/auth.service.ts` | Replace LegacyDbService with TypeORM repositories |
| `backend/src/modules/auth/auth.module.ts` | Remove LegacyDbService from providers |
| `backend/src/modules/auth/jwt.strategy.ts` | Replace LegacyDbService with UserRepository |
| `backend/src/common/legacy/legacy-db.service.ts` | Remove domain tables as they migrate (shrink writeSnapshot) |
| `backend/src/database/entities/weekly-plan.entity.ts` | Add `userId` column |
| `backend/src/database/entities/session.entity.ts` | Add `expiresAt` column |
| `backend/src/database/migrations/` | Create real migrations for schema changes |
| `backend/src/modules/users/users.service.ts` | May need additional methods for AuthService |
| `backend/src/modules/wardrobe/wardrobe.service.ts` | No changes (already uses repos) |
| `backend/src/modules/outfits/outfits.service.ts` | No changes (already uses repos) |
| `backend/src/modules/planner/planner.service.ts` | No changes (already uses repos) |
| `backend/src/modules/shop/shop.service.ts` | No changes (already uses repos) |
| `backend/src/modules/stylist/stylist.service.ts` | No changes (already uses repos) |
| `backend/src/modules/admin/admin.service.ts` | No changes (already uses repos) |

**Files NOT to modify:** Express `server.js`, Flutter `lib/`, any controller files

## Stop Conditions

- If a domain migration requires breaking the Flutter API contract → stop, request approval
- If a domain migration requires destructive schema change (DROP column, RENAME table) → stop, request approval
- If Express and NestJS data cannot be reconciled → stop, document inconsistency
- If LegacyDbService removal breaks AuthService authentication → stop, fix auth first
