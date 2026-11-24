# Phase 1D — Snapshot Persistence Risk Assessment

## Snapshot Write Mechanism

**File:** `backend/src/common/legacy/legacy-db.service.ts:497-796` (`writeSnapshot()`)

## How It Works

1. `onModuleInit()` hydrates all 26 tables from MySQL into an in-memory `LegacyDb` document
2. Controllers mutate the in-memory document synchronously
3. `persist()` queues a full snapshot write via `writeQueue` promise chain
4. `writeSnapshot()` performs:
   - `DELETE FROM <table>` for all 24 tables in `clear()` order (line 798-828)
   - Re-INSERT all data from the in-memory document in one TypeORM transaction
   - All inside `this.dataSource.transaction()` (line 501)

## Risk Assessment

### SR-1: Full-table delete/reinsert (Write Amplification)

**Evidence:** `legacy-db.service.ts:798-828` (`clear()` method) — iterates through 24 entity classes, executing `DELETE FROM <table>` for each. Then lines 504-794 reINSERT all data.

**Consequence:** Every single write operation (user registration, login, wardrobe item add, outfit feedback, chat message, etc.) triggers:
- 24 DELETE statements
- N INSERT statements (one per row across all tables)

**Impact:** O(n) write amplification where n = total data size. As the database grows, every mutation becomes progressively slower. Write latency grows linearly with total stored data across all 26 tables.

**Severity:** High

**Estimated impact:** At 1,000 users with average data, each write could involve 10,000+ row operations. Write latency would increase from milliseconds to seconds.

---

### SR-2: Transactional but not crash-safe mid-write

**Evidence:** `legacy-db.service.ts:501` — `await this.dataSource.transaction(async (manager) => { ... })` wraps the entire snapshot.

**Consequence:** The transaction is atomic — either all DELETEs and INSERTs complete, or none do. However:
- If the process crashes mid-transaction, the database rolls back to the pre-snapshot state (last successful persist)
- Any data written since the last successful persist is lost
- The in-memory document and database diverge until the next successful persist

**Severity:** Medium — data loss window between persists

---

### SR-3: Concurrent write serialization

**Evidence:** `legacy-db.service.ts:97` — `private writeQueue: Promise<void> = Promise.resolve()` and lines 478-488 (`persist()` method).

**Consequence:** All writes are serialized through a single promise queue. Two concurrent requests cannot interleave a snapshot. However:
- Request A calls `persist()` → queued
- Request B calls `persist()` → queued after A
- Request B reads `this.db` (which may include A's changes) and writes full snapshot including both A and B
- If B's snapshot fails, A's changes are also lost (they were in the same snapshot)

**Severity:** Low — serialization prevents corruption, but failure cascades

---

### SR-4: Express and NestJS write to different stores

**Evidence:** `server.js:34-35` — `let db = store.load(); const persist = () => store.save(db);` (JSON file). `legacy-db.service.ts` — MySQL tables.

**Consequence:** Express writes to `data/db.json`; LegacyDbService writes to MySQL tables. They never share data. A user registered via Express is invisible to NestJS AuthService, and vice versa.

**Severity:** High — data silos, users cannot authenticate across runtimes

---

### SR-5: LegacyDbService overwrites direct TypeORM writes

**Evidence:** `legacy-db.service.ts:497-796` — `writeSnapshot()` deletes ALL rows from ALL tables and reINSERTs from the in-memory document. NestJS services like `UsersService`, `StylistService`, `PlannerService`, etc. use `@InjectRepository` directly and bypass LegacyDbService.

**Consequence:** If UsersService creates a user via TypeORM `save()`, then AuthService calls `legacy.persist()`, the snapshot DELETEs that user (if not in the in-memory document) and reINSERTs only the in-memory version. Direct TypeORM writes are lost.

**Severity:** High — data corruption risk when both writers touch the same tables

**Affected tables:** users (AuthService vs UsersService), outfits (AuthService snapshot vs StylistService/OutfitsService), wardrobe_items (AuthService snapshot vs WardrobeService), etc.

---

### SR-6: 7 entities not in snapshot clear order

**Evidence:** `legacy-db.service.ts:798-828` — `clear()` order lists 24 entities. Missing: `Purchase`, `AppNotification`, `WeatherSnapshot`, `Trip`, `ClothingAttribute`, `WearEvent`, `Occasion` (7 entities).

**Consequence:** These 7 tables are never cleared or written by the snapshot. Data written directly to them via TypeORM repos persists independently. Data written via LegacyDbService never touches them. Inconsistent state between snapshot-managed and non-snapshot-managed tables.

**Severity:** Medium — orphaned data, inconsistent state

---

### SR-7: No partial updates — full document rewrite

**Evidence:** `legacy-db.service.ts:497` — "Replace the database contents with the current working set, atomically."

**Consequence:** Changing a single wardrobe item's `timesWorn` counter rewrites all 26 tables. No ability to update individual rows.

**Severity:** High — performance and correctness issue

---

### SR-8: `ownerId` fallback to first user

**Evidence:** `legacy-db.service.ts:128-130` — `get ownerId(): string | null { return this.db.users[0]?.id ?? null; }` and used throughout `writeSnapshot()` (lines 499, 579, 615, 648, 768, 788) as fallback when `userId` is null.

**Consequence:** If a record has no `userId`, it's attributed to the first user in the database. This is a data ownership bug — records could be misattributed.

**Severity:** Medium — incorrect data ownership

---

## Summary of Risks

| ID | Severity | Risk | Location |
|----|----------|------|----------|
| SR-1 | High | Full-table delete/reinsert on every write | `legacy-db.service.ts:497-796` |
| SR-2 | Medium | Transactional but data loss window | `legacy-db.service.ts:501` |
| SR-3 | Low | Write queue serialization with failure cascade | `legacy-db.service.ts:97,478-488` |
| SR-4 | High | Express and NestJS use separate data stores | `server.js:34-35` vs `legacy-db.service.ts` |
| SR-5 | High | LegacyDbService overwrites direct TypeORM writes | `legacy-db.service.ts:497-796` |
| SR-6 | Medium | 7 entities not in snapshot clear order | `legacy-db.service.ts:798-828` |
| SR-7 | High | No partial updates, full document rewrite | `legacy-db.service.ts:497` |
| SR-8 | Medium | `ownerId` fallback misattributes records | `legacy-db.service.ts:128-130` |

## Deployment Model Safety

**Not safe for:**
- Multi-instance deployment (each instance has its own in-memory cache; snapshots overwrite each other)
- High-write workloads (O(n) amplification)
- Concurrent users on same data (last-write-wins via snapshot)

**Safe for:**
- Single-instance, low-write, development/demo usage
