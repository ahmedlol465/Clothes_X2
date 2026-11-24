# Phase 1D — Database Integration Test Plan

## Test Engine Recommendation

**Use PostgreSQL for integration testing.**

**Justification:**
1. PostgreSQL is the documented primary database (`data-source.ts:22-33`)
2. `better-sqlite3` shim does not fully replicate PostgreSQL/MySQL behavior (JSON columns, decimal transformers, foreign key enforcement)
3. `synchronize=true` masks schema issues that would fail in production
4. LegacyDbService writes to MySQL tables — testing against SQLite doesn't validate the actual production path

**SQLite fallback** is acceptable for unit tests only, not integration tests.

---

## Test Categories

### TD-1: Repository CRUD Operations

**Scope:** Each TypeORM repository used by NestJS services

**Tests per entity:**
- Create → verify returned ID and fields
- Read by ID → verify field values
- Read by query (e.g., `where: { userId }`) → verify filtering
- Update → verify changed fields persisted
- Delete → verify row removed
- Count → verify total matches expectation

**Entities to test:** User, WardrobeItem, Wardrobe, Outfit, OutfitItem, OutfitFeedback, CalendarEvent, EventSchedule, WeeklyPlan, ShoppingItem, WishlistItem, AIConversation, AIInteraction, AIUsage, Session, StyleProfile, StyleMemory

**Pass criteria:** All CRUD operations succeed, data matches input

---

### TD-2: Foreign Key Integrity

**Scope:** All `@ManyToOne` and `@OneToMany` relations with `onDelete` behavior

**Tests:**
- Delete a `User` → verify `Wardrobe` rows cascade deleted (onDelete: 'CASCADE')
- Delete a `Wardrobe` → verify `WardrobeItem` rows cascade deleted
- Delete an `Outfit` → verify `OutfitItem` rows cascade deleted
- Delete a `CalendarEvent` → verify `EventSchedule` rows cascade deleted
- Set NULL on `WardrobeItem.categoryRef` when `Category` deleted (onDelete: 'SET NULL')
- Set NULL on `EventSchedule.outfit` when `Outfit` deleted (onDelete: 'SET NULL')

**Pass criteria:** Cascade/delete behavior matches entity decorators

---

### TD-3: Transaction Rollback

**Scope:** Multi-table write operations

**Tests:**
- Create user + profile + style profile in one transaction → rollback → verify none persisted
- Create outfit + outfit items in one transaction → rollback → verify none persisted
- LegacyDbService `writeSnapshot()` — simulate failure mid-transaction → verify database unchanged

**Pass criteria:** Atomic all-or-nothing behavior

---

### TD-4: Concurrent Writes

**Scope:** LegacyDbService snapshot write contention

**Tests:**
- Two concurrent `persist()` calls → verify write queue serializes them
- Two concurrent direct TypeORM `save()` calls on same row → verify last-write-wins or error
- Concurrent read during snapshot write → verify reads see consistent state (pre-snapshot or post-snapshot, not partial)

**Pass criteria:** No data corruption under concurrent access

---

### TD-5: User-Data Isolation

**Scope:** All user-scoped queries

**Tests:**
- Create WardrobeItem for User A → query as User B → verify not returned
- Create Outfit for User A → query as User B → verify not returned
- Create CalendarEvent for User A → query as User B → verify not returned
- Create ShoppingItem for User A → query as User B → verify not returned
- Update Outfit belonging to User A with User B's token → verify 403/404

**Pass criteria:** Users cannot access other users' data

---

### TD-6: Snapshot Recovery

**Scope:** LegacyDbService `writeSnapshot()` reliability

**Tests:**
- Populate MySQL tables → call `legacy.persist()` → verify all tables match in-memory document
- Simulate process crash mid-snapshot → verify database rolls back to consistent state
- Call `legacy.persistStrict()` → verify synchronous completion
- Verify `writeQueue` serializes multiple concurrent `persist()` calls

**Pass criteria:** Snapshot produces consistent database state

---

### TD-7: Data Migration Integrity

**Scope:** `LegacyDbService.importFromJson()` and domain migration

**Tests:**
- Import `data/db.json` into empty MySQL database → verify row counts match JSON
- After domain migration (e.g., users moved to TypeORM repos) → verify data accessible via both old and new paths during transition
- Verify no data loss during domain cutover

**Pass criteria:** Zero data loss, consistent counts

---

### TD-8: Express/NestJS Shared Data Consistency

**Scope:** During transition period when both runtimes access same data

**Tests:**
- Create user via NestJS → query via Express JSON store → verify visible (or document that they're separate)
- Create wardrobe item via NestJS TypeORM → query via Express JSON store → verify visible (or document separate)
- Verify no silent data loss when both runtimes write to same MySQL tables

**Pass criteria:** Documented consistency model (shared or separate)

**Note:** Currently Express and NestJS use SEPARATE stores (JSON vs MySQL). This test documents the current state and validates consistency after migration.

---

## Test Environment

| Component | Recommendation |
|-----------|---------------|
| Database | PostgreSQL (Docker container for CI) |
| ORM | TypeORM with `synchronize=false` (use migrations) |
| Test runner | Jest (existing) |
| Seeding | Seed from `data/db.json` via `seed.cli.ts` |
| Teardown | Drop/recreate schema between test files |

**Do not use** `better-sqlite3` for integration tests — it doesn't enforce foreign keys the same way as PostgreSQL and masks production issues.

---

## Test File Locations

```
backend/src/modules/auth/auth.repository.spec.ts
backend/src/modules/wardrobe/wardrobe.repository.spec.ts
backend/src/modules/outfits/outfits.repository.spec.ts
backend/src/modules/planner/planner.repository.spec.ts
backend/src/modules/shop/shop.repository.spec.ts
backend/src/modules/stylist/stylist.repository.spec.ts
backend/src/modules/users/users.repository.spec.ts
backend/src/modules/admin/admin.repository.spec.ts
backend/src/common/legacy/legacy-db.repository.spec.ts
backend/src/database/migrations/*.spec.ts
```

---

## Pass/Fail Criteria

| Criterion | Threshold |
|-----------|-----------|
| Repository CRUD | 100% pass |
| FK integrity | 100% pass |
| Transaction rollback | 100% pass |
| Concurrent writes | No corruption |
| User-data isolation | 100% pass |
| Snapshot recovery | Consistent state |
| Migration integrity | Zero data loss |

---

## Tests NOT in Scope (Phase 1D)

- Controller-level API tests (require running HTTP server)
- End-to-end tests (require Flutter + backend)
- Performance/load testing (requires production-like data volume)
- Express JSON store tests (being phased out)
