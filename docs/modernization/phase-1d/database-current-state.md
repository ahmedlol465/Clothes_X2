# Phase 1D — Database Current State

## Overview

This document establishes the baseline state of the SmartWardrobe database layer before any migration work.

## Persistence Architecture — Three Separate Layers

The project currently has **three independent persistence mechanisms**, not one:

### Layer 1: Express → JSON File Store (`store.ts`)

**File:** `backend/src/store.ts` (converted from `store.js`)

**Used by:** `backend/server.js` (Express runtime, port 3001/3002)

**Operations:**
- `store.load()` — reads `data/db.json` into memory at boot
- `store.save(db)` — writes the entire in-memory document back to `data/db.json`
- `persist()` — called after every mutation in `server.js` (38 call sites)

**Data scope:** All user data (users, wardrobe items, outfits, events, conversations, feedback, wishlist, products, AI usage, sessions)

**File size:** `backend/data/db.json` = 96,820 bytes

**Note:** `server.js` requires `./src/store` which is now `src/store.ts`. At runtime, plain `require()` cannot load a `.ts` file unless there's a compiled `store.js` in `dist/` or ts-node registration. This may be a runtime breakage.

---

### Layer 2: NestJS Auth → LegacyDbService → MySQL

**File:** `backend/src/common/legacy/legacy-db.service.ts` (866 lines)

**Used by:**
- `backend/src/modules/auth/auth.service.ts` (user registration, login, logout, social auth)
- `backend/src/modules/auth/jwt.strategy.ts` (token validation lookup)

**Operations:**
- `onModuleInit()` — hydrates all data from MySQL tables into an in-memory `LegacyDb` document
- `persist()` — queues a full snapshot write (DELETE all rows + reINSERT all data in one TypeORM transaction)
- `persistStrict()` — awaits the snapshot write synchronously
- `findUser(id)`, `findUserByEmail(email)` — in-memory lookups

**Data scope:** Users, profiles, style profiles, sessions, wardrobe, outfits, feedback, style memories, conversations, interactions, events, plans, products, wishlist, AI usage

**Tables written (26):** users, user_profiles, style_profiles, style_preferences, style_memories, subscriptions, sessions, wardrobes, wardrobe_items, brands, categories, wear_events, occasions, outfits, outfit_items, outfit_feedback, recommendations, recommendation_feedback, weather_snapshots, calendar_events, event_schedules, trips, packing_lists, shopping_items, wishlist_items, purchases, ai_usage

---

### Layer 3: NestJS Feature Services → TypeORM Repositories Directly

**Services using `@InjectRepository` directly (NOT LegacyDbService):**

| Service | Entities Accessed |
|---------|------------------|
| `WardrobeService` | WardrobeItem, Wardrobe |
| `OutfitsService` | Outfit, OutfitItem, OutfitFeedback, WardrobeItem, Wardrobe, StyleProfile |
| `PlannerService` | CalendarEvent, EventSchedule, WeeklyPlan, WardrobeItem, Wardrobe, Outfit |
| `ShopService` | WardrobeItem, Wardrobe, ShoppingItem, WishlistItem |
| `StylistService` | WardrobeItem, Wardrobe, AIConversation, AIInteraction, AIUsage, StyleProfile, Outfit, OutfitFeedback, User |
| `UsersService` | User, StyleProfile |
| `AdminService` | User, WardrobeItem, Outfit, CalendarEvent, OutfitFeedback, AIUsage |

**Key finding:** These services bypass LegacyDbService entirely. They read/write TypeORM entities directly. This means they operate on a different data view than AuthService (which uses LegacyDbService's in-memory snapshot).

---

## Data Sharing Between Layers

| Layer Pair | Shares Data? | Notes |
|------------|-------------|-------|
| Express (JSON) ↔ LegacyDbService (MySQL) | **No** | Express uses `db.json` file; LegacyDbService uses MySQL tables. No shared state. |
| LegacyDbService ↔ TypeORM repos | **Partial** | Both use MySQL, but LegacyDbService caches everything in memory and overwrites via full snapshot. Direct repo writes by other services bypass the cache and may be overwritten by the next LegacyDbService `persist()`. |
| Express ↔ TypeORM repos | **No** | Express writes to `db.json`; TypeORM services write to MySQL. Completely separate. |

---

## Database Configuration

**File:** `backend/src/config/configuration.ts` (`databaseConfig`)

| Env Var | Default | Description |
|---------|---------|-------------|
| `DB_TYPE` | `sqlite` | `postgres`, `mysql`, or `sqlite` |
| `DB_SYNCHRONIZE` | `true` | TypeORM `synchronize` (auto-create schema) |
| `DB_LOGGING` | `false` | TypeORM SQL logging |
| `DB_HOST` | `localhost` / `127.0.0.1` | Database host |
| `DB_PORT` | 5432 (pg) / 3306 (mysql) | Database port |
| `DB_USERNAME` | `postgres` / `root` | Database user |
| `DB_PASSWORD` | `postgres` / `` | Database password |
| `DB_NAME` | `smartwardrobe` | Database name |
| `DB_SQLITE_PATH` | `data/smartwardrobe.sqlite` | SQLite file path |
| `DB_SSL` | `false` | SSL for PostgreSQL |

**Driver selection logic** (`data-source.ts`):
1. `DB_TYPE=postgres` → try PostgreSQL, fall back to SQLite if unreachable
2. `DB_TYPE=mysql` → try MySQL, fall back to SQLite if unreachable
3. Default → SQLite with `better-sqlite3` shim

**`synchronize=true`** — TypeORM auto-creates/alters tables on boot. No production migration safety.

---

## Migration Status

**File:** `backend/src/database/migrations/1-initial-schema.ts`

- `up()` — **no-op** (comment says tables created by `synchronize`)
- `down()` — **no-op** (safety: do not drop tables)

No production-ready migrations exist.

---

## Backup and Recovery

**Existing artifacts:**
- `backend/data/db.json` — 96,820 bytes (Express JSON store)
- `backend/data/db.json.bak` — 92,431 bytes (previous backup)
- `backend/data/db.json.phase0-backup-20261123-144657` — 96,820 bytes (Phase 0 verified backup)

**No MySQL/PostgreSQL dumps exist** — database servers not running in this environment.

---

## Environment Variables Summary

| Category | Variables | Status |
|----------|-----------|--------|
| Database | `DB_TYPE`, `DB_SYNCHRONIZE`, `DB_LOGGING`, `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `DB_SQLITE_PATH`, `DB_SSL` | Configured in `.env.example` |
| Redis | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_TTL_SECONDS`, `REDIS_MODE`, `REDIS_KEY_PREFIX` | Configured (cache, not used for persistence) |
| JWT | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `BCRYPT_ROUNDS` | Configured (defaults in `.env.example`) |

**`GEMINI_API_KEY` was removed from `.env` during Phase 1A.**
