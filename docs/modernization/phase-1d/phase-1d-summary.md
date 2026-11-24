# Phase 1D — Summary

## Executive Summary

Phase 1D (Database Layer Assessment) is complete. The SmartWardrobe database layer has **three separate persistence mechanisms** with significant risks. No source code was modified. This phase is assessment and planning only.

## Current Persistence Architecture

| Layer | Runtime | Mechanism | Store | Consumers |
|-------|---------|-----------|-------|-----------|
| Express | Port 3001/3002 | `store.ts` `load()`/`save()` | `data/db.json` (JSON file) | All Express routes |
| NestJS Auth | Port 3000 | `LegacyDbService` | MySQL (full snapshot) | AuthService, JwtStrategy |
| NestJS Features | Port 3000 | TypeORM `@InjectRepository` | MySQL (direct) | 7 feature services |

**Critical finding:** Express and NestJS do NOT share data. Express uses a JSON file; NestJS uses MySQL. A user registered via Express is invisible to NestJS, and vice versa.

**Critical conflict:** `AuthService` (LegacyDbService) and `UsersService` (TypeORM) both write to the `users` table. LegacyDbService's full-snapshot `persist()` overwrites direct TypeORM writes.

---

## LegacyDbService Consumers

| Consumer | File | Operations |
|----------|------|------------|
| AuthService | `src/modules/auth/auth.service.ts` | Read: findUser, findUserByEmail. Write: push user + persist() |
| JwtStrategy | `src/modules/auth/jwt.strategy.ts` | Read: findUser(payload.sub) |

**Tables affected (26):** All except Purchase, AppNotification, WeatherSnapshot, Trip, ClothingAttribute, WearEvent, Occasion (7 not in clear order)

---

## TypeORM Entity Audit (35 entities)

### Confirmed Issues

| ID | Severity | Issue | Location |
|----|----------|-------|----------|
| IF-1 | Medium | `WeeklyPlan` has no `userId` — multi-user collision risk | `weekly-plan.entity.ts:22` |
| IF-2 | High | `Session` has no expiration — stolen tokens valid indefinitely | `session.entity.ts:31-38` |
| IF-3 | High | LegacyDbService snapshot bypasses entity constraints | `legacy-db.service.ts:497-796` |
| IF-4 | High | `synchronize=true` with no-op migration — no production safety | `configuration.ts:30`, `migrations/1-initial-schema.ts` |
| IF-5 | Medium | JSON columns without schema validation | Multiple entities |
| IF-6 | Low | Decimal transformers for SQLite compatibility | Multiple entities |
| IF-7 | Medium | Denormalized `Wardrobe.itemCount` — consistency risk | `identity.entity.ts:368` |
| IF-8 | Medium | `categoryId` JoinColumn without `@Column` declaration | `identity.entity.ts:437-439` |
| IF-9 | Low | `calendarEventId`/`parentOutfitId` without FK constraints | `outfit.entity.ts:110-114` |
| IF-10 | Medium | 7 entities not in LegacyDbService clear order | `legacy-db.service.ts:798-828` |

---

## Snapshot Persistence Risks

| ID | Severity | Risk | Location |
|----|----------|------|----------|
| SR-1 | High | Full-table delete/reinsert on every write (O(n) amplification) | `legacy-db.service.ts:497-796` |
| SR-2 | Medium | Transactional but data loss window between persists | `legacy-db.service.ts:501` |
| SR-3 | Low | Write queue serialization with failure cascade | `legacy-db.service.ts:97,478-488` |
| SR-4 | High | Express and NestJS use separate data stores | `server.js:34-35` vs `legacy-db.service.ts` |
| SR-5 | High | LegacyDbService overwrites direct TypeORM writes | `legacy-db.service.ts:497-796` |
| SR-6 | Medium | 7 entities not in snapshot clear order | `legacy-db.service.ts:798-828` |
| SR-7 | High | No partial updates — full document rewrite | `legacy-db.service.ts:497` |
| SR-8 | Medium | `ownerId` fallback misattributes records | `legacy-db.service.ts:128-130` |

## Domain Migration Order (9 phases)

| Phase | Domain | Priority | Conflict Risk |
|-------|--------|----------|---------------|
| 1 | Users/Auth | High | High (3 writers) |
| 2 | Sessions | Medium | Medium |
| 3 | Wardrobe Items | High | High |
| 4 | Outfits | High | High |
| 5 | Planner/Events | Medium | Medium |
| 6 | Shopping/Wishlist | Low | Low |
| 7 | Stylist/AI | Medium | Medium |
| 8 | Admin (read-only) | Low | Low |
| 9 | Remove LegacyDbService | — | — |

## Recommended Database Engine

**PostgreSQL** — documented primary database, full feature support (JSON, decimal, foreign keys, transactions), production-ready.

**Not recommended for production testing:** `better-sqlite3` shim — masks schema issues, different JSON/decimal behavior.

## Integration Test Plan

8 test categories (TD-1 through TD-8) covering CRUD, FK integrity, transactions, concurrency, isolation, snapshot recovery, migration integrity, and Express/NestJS consistency.

## Files That Would Need Modification (Implementation Phase)

| File | Changes |
|------|---------|
| `backend/src/modules/auth/auth.service.ts` | Replace LegacyDbService with TypeORM repositories |
| `backend/src/modules/auth/auth.module.ts` | Remove LegacyDbService from providers |
| `backend/src/modules/auth/jwt.strategy.ts` | Replace LegacyDbService with UserRepository |
| `backend/src/common/legacy/legacy-db.service.ts` | Remove domain tables as they migrate |
| `backend/src/database/entities/weekly-plan.entity.ts` | Add `userId` column |
| `backend/src/database/entities/session.entity.ts` | Add `expiresAt` column |
| `backend/src/database/migrations/` | Create real migrations |
| `backend/src/modules/users/users.service.ts` | May need additional methods |

## Files NOT to Modify

- Express `server.js`
- Flutter `lib/`
- Controller files
- Other feature service files (already use TypeORM repos directly)

## Stop Conditions

- Domain migration requires breaking Flutter API contract → stop
- Domain migration requires destructive schema change → stop
- Express and NestJS data cannot be reconciled → stop
- LegacyDbService removal breaks authentication → stop

## Readiness

Phase 1D is complete. All findings are evidence-based. No source code was modified. No database schema was changed. No tests were run against a live database (none available in this environment).

Awaiting explicit approval before implementing any migration.
