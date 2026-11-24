# Phase 1D — TypeORM Entity Audit

## Overview

35 entities defined across 7 entity files, exported from `src/database/entities/index.ts`.

## Entity Inventory

### identity.entity.ts (11 entities)

| Entity | Table | PK | Indexes | Relations | Notes |
|--------|-------|-----|---------|-----------|-------|
| User | users | uuid | email (unique) | UserProfile (1:1), StyleProfile (1:1), StyleMemory (1:M), Subscription (1:1) | `passwordHash` nullable (social login), `role` default `user`, `tokenVersion` default 0 |
| UserProfile | user_profiles | uuid | userId (unique) | User (1:1, cascade delete) | JSON arrays for colors/styles, all measurements nullable |
| StyleProfile | style_profiles | uuid | userId (unique) | User (1:1, cascade delete) | JSON fields for dimensions/palette/categoryMix/evolution, all float fields nullable |
| StylePreference | style_preferences | uuid | userId, preference | User (M:1, cascade delete) | `weight` default 0.5 |
| StyleMemory | style_memories | uuid | userId, (userId+preference unique) | User (M:1, cascade delete) | `value` and `confidence` are floats |
| Subscription | subscriptions | uuid | userId (unique) | User (1:1, cascade delete) | `plan` default 'free', `status` default 'active' |
| Wardrobe | wardrobes | uuid | userId | User (M:1, cascade delete) | `itemCount` default 0 (denormalized) |
| Brand | brands | uuid | name (unique) | None | Lookup table |
| Category | categories | uuid | name (unique) | None | Lookup table, `group` default 'apparel' |
| WardrobeItem | wardrobe_items | uuid | wardrobeId, (wardrobeId+status) | Wardrobe (M:1), Brand (M:1), Category (M:1), ClothingAttribute (1:M) | JSON fields for secondaryColors, tags, compatibleColors, confidenceByAttribute, legacy, embeddings |
| ClothingAttribute | clothing_attributes | uuid | itemId, (itemId+name unique) | WardrobeItem (1:1, cascade delete) | Vision model attribute rows |
| WearEvent | wear_events | uuid | itemId, wornAt, (itemId+wornAt) | WardrobeItem (M:1, cascade delete) | No FK to User directly (via item) |

### outfit.entity.ts (7 entities)

| Entity | Table | PK | Indexes | Relations | Notes |
|--------|-------|-----|---------|-----------|-------|
| Occasion | occasions | uuid | userId | None | `tags` JSON array, `isRecurring` default false |
| Outfit | outfits | uuid | userId, (userId+status) | OutfitItem (1:M cascade), OutfitFeedback (1:M) | JSON fields for factorBreakdown, reasons, weatherContext; `parentOutfitId` for remix lineage |
| OutfitItem | outfit_items | uuid | outfitId, (outfitId+slot unique) | Outfit (M:1 cascade), WardrobeItem (M:1 cascade) | `slot` default TOP, `layerOrder` default 0, `contribution` nullable float |
| OutfitFeedback | outfit_feedback | uuid | userId, outfitId | Outfit (M:1 cascade delete) | `rating` nullable int, `tags` JSON array |
| Recommendation | recommendations | uuid | userId, createdAt | Outfit (M:1 set null), RecommendationFeedback (1:M) | `itemIds` JSON array, `expiresAt` nullable |
| RecommendationFeedback | recommendation_feedback | uuid | userId, recommendationId | Recommendation (M:1 cascade delete) | `perItemReaction` JSON nullable |

### planner.entity.ts (5 entities)

| Entity | Table | PK | Indexes | Relations | Notes |
|--------|-------|-----|---------|-----------|-------|
| CalendarEvent | calendar_events | uuid | userId, (userId+startsAt) | EventSchedule (1:M cascade) | `weatherSnapshot` JSON nullable, `startsAtRaw`/`endsAtRaw` text fields |
| EventSchedule | event_schedules | uuid | eventId, (eventId+status) | CalendarEvent (M:1 cascade), Outfit (M:1 set null) | `outfitId` nullable, `status` default 'planned' |
| WeatherSnapshot | weather_snapshots | uuid | userId, capturedAt | None | Full weather record with forecast JSON array |
| Trip | trips | uuid | userId, (userId+startsOn) | PackingList (1:M cascade) | `activities`/`formalEventTitles`/`weatherForecast` JSON arrays |
| PackingList | packing_lists | uuid | tripId | Trip (M:1 cascade delete), WardrobeItem (M:1 cascade) | `dayPlan` JSON array, `outfitCount` default 0 |

### shopping.entity.ts (3 entities)

| Entity | Table | PK | Indexes | Relations | Notes |
|--------|-------|-----|---------|-----------|-------|
| ShoppingItem | shopping_items | uuid | None | None | `price` decimal(10,2), `compatibleColors` JSON array |
| WishlistItem | wishlist_items | uuid | userId, (userId+productUrl unique) | ShoppingItem (M:1 set null) | `price`/`lowestPrice`/`targetPrice` decimal(10,2) nullable |
| Purchase | purchases | uuid | userId, wardrobeItemId | None | `price` decimal(10,2), `purchasedOn` date |

### ai.entity.ts (4 entities)

| Entity | Table | PK | Indexes | Relations | Notes |
|--------|-------|-----|---------|-----------|-------|
| AIConversation | ai_conversations | uuid | userId, (userId+updatedAt) | AIInteraction (1:M cascade) | `context` JSON nullable, `messageCount` default 0 |
| AIInteraction | ai_interactions | uuid | conversationId, (conversationId+createdAt) | AIConversation (M:1 cascade), Outfit (M:1 set null) | `payload` JSON nullable, `referencedItemIds` JSON array, `tokens` default 0 |
| AIUsage | ai_usage | uuid | userId, createdAt, userId | None | `costUsd` decimal(12,4), `provider` default 'rule-engine', `metadata` JSON nullable |
| AppNotification | notifications | uuid | userId, (userId+readAt) | None | `channel` default 'in_app', `readAt`/`sentAt` nullable |

### session.entity.ts (1 entity)

| Entity | Table | PK | Indexes | Relations | Notes |
|--------|-------|-----|---------|-----------|-------|
| Session | sessions | uuid | token (unique) | User (M:1 cascade delete) | **No expiration column**, **no refreshToken column** |

### weekly-plan.entity.ts (1 entity)

| Entity | Table | PK | Indexes | Relations | Notes |
|--------|-------|-----|---------|-----------|-------|
| WeeklyPlan | weekly_plans | uuid | None | None | **No userId column** (global plan), `isToday` default false |

---

## Entity Audit Findings

### IF-1: WeeklyPlan has no userId

**Location:** `src/database/entities/weekly-plan.entity.ts:22`

**Issue:** The `WeeklyPlan` entity has no `userId` column. The comment says "globally regenerated 7-day outfit plan" and "Source JSON `weeklyPlan` has no userId". However, `PlannerService` injects `WeeklyPlan` repository and the Flutter API calls `/planner/weekly` with user context. If multiple users exist, their plans would collide.

**Severity:** Medium — data integrity risk for multi-user

---

### IF-2: Session has no expiration

**Location:** `src/database/entities/session.entity.ts:31-38`

**Issue:** `Session` entity has `token` (unique) and `userId` but no `expiresAt` column. Comment confirms: "No expiration, no tokenVersion, no separate refreshToken column."

**Severity:** High — stolen session tokens remain valid indefinitely

---

### IF-3: LegacyDbService snapshot bypasses entity constraints

**Location:** `src/common/legacy/legacy-db.service.ts:497-796`

**Issue:** `writeSnapshot()` performs `DELETE FROM <table>` for all 26 tables then reINSERTs all data. This bypasses all entity-level constraints (unique indexes, foreign keys, NOT NULL) during the delete phase. If a concurrent process reads mid-snapshot, it sees empty tables.

**Severity:** High — data integrity risk under concurrent access

---

### IF-4: `synchronize=true` with no-op migration

**Location:** `src/config/configuration.ts:30`, `src/database/migrations/1-initial-schema.ts:7-15`

**Issue:** TypeORM `synchronize` auto-creates/alters schema on boot. Migration `up()` and `down()` are both no-ops. No production migration path exists.

**Severity:** High — no schema rollback capability

---

### IF-5: JSON columns without schema validation

**Location:** Multiple entities (e.g., `WardrobeItem.legacy`, `Outfit.factorBreakdown`, `UserProfile.preferredColors`)

**Issue:** TypeORM `json` columns store unstructured data. No application-level schema validation ensures consistency. LegacyDbService snapshot reads/writes these as `Record<string, any>`.

**Severity:** Medium — data quality risk

---

### IF-6: Decimal transformers for SQLite compatibility

**Location:** `WardrobeItem.purchasePrice`, `ShoppingItem.price`, `WishlistItem.price`, `WishlistItem.lowestPrice`, `WishlistItem.targetPrice`, `Purchase.price`, `AIUsage.costUsd`

**Issue:** Decimal columns use transformers to convert between string (SQLite) and number (TypeORM). Works but adds complexity. PostgreSQL/MySQL handle decimal natively without transformers.

**Severity:** Low — works correctly, just adds complexity

---

### IF-7: Denormalized `Wardrobe.itemCount`

**Location:** `src/database/entities/identity.entity.ts:368-369`

**Issue:** `itemCount` is a denormalized counter kept in sync by the wardrobe service. If LegacyDbService snapshot overwrites while a direct repo write updates `itemCount`, the counter can become stale.

**Severity:** Medium — consistency risk under concurrent writers

---

### IF-8: `WardrobeItem.categoryId` column missing from entity

**Location:** `src/database/entities/identity.entity.ts:437-439`

**Issue:** Entity has `@JoinColumn({ name: 'categoryId' })` referencing `Category`, but no `@Column()` declaration for `categoryId` itself. The `category` string field exists separately. This may cause TypeORM to not persist the FK relationship correctly.

**Severity:** Medium — potential FK persistence issue

---

### IF-9: `Outfit.calendarEventId` and `parentOutfitId` without FK constraints

**Location:** `src/database/entities/outfit.entity.ts:110-114`

**Issue:** These columns are nullable with no `@ManyToOne` relation or `@JoinColumn`. They're treated as plain string columns, not foreign keys.

**Severity:** Low — intentional (soft references)

---

### IF-10: Entity count (35) vs LegacyDbService tables (26)

**Location:** `src/database/entities/index.ts:105-138` vs `legacy-db.service.ts:798-828`

**Issue:** 9 entities are NOT included in LegacyDbService's `clear()` order: `Purchase`, `AppNotification`, `WeatherSnapshot`, `Trip`, `PackingList`, `ClothingAttribute`, `WearEvent`, `Occasion`, `Recommendation`, `RecommendationFeedback` (10 actually). Let me recount...

LegacyDbService `clear()` order (24 entities): OutfitItem, EventSchedule, PackingList, AIInteraction, OutfitFeedback, RecommendationFeedback, Recommendation, CalendarEvent, WeeklyPlan, WishlistItem, AIUsage, AIConversation, WardrobeItem, Outfit, Brand, Wardrobe, Session, StyleMemory, StylePreference, Subscription, UserProfile, StyleProfile, ShoppingItem, User

Missing from clear(): Purchase, AppNotification, WeatherSnapshot, Trip, ClothingAttribute, WearEvent, Occasion — 7 entities not cleared by snapshot

**Severity:** Medium — orphaned data possible for entities not in snapshot clear order
