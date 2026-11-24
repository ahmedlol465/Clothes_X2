# Phase 1D — Legacy Persistence Dependency Map

## Summary

Three persistence consumers exist in the codebase:

| Consumer | Runtime | Persistence Mechanism | Data Store |
|----------|---------|----------------------|------------|
| Express `server.js` | Legacy (port 3001/3002) | `store.ts` `load()`/`save()` | `data/db.json` (JSON file) |
| NestJS `AuthService` + `JwtStrategy` | NestJS (port 3000) | `LegacyDbService` | MySQL tables (full snapshot) |
| NestJS feature services (7 modules) | NestJS (port 3000) | TypeORM `@InjectRepository` | MySQL tables (direct) |

---

## LegacyDbService Consumer Detail

### 1. AuthService (`backend/src/modules/auth/auth.service.ts`)

**Injection:** `private readonly legacy: LegacyDbService`

**Read operations:**
- `this.legacy.findUserByEmail(email)` — line 41, 71, 91 — email lookup for registration/login/social
- `this.legacy.findUser(id)` — line 129, 139 — user lookup by ID for profile/me endpoints
- `this.legacy.data.users` — line 63, 108 — direct array push for new user creation
- `this.legacy.uid('u')` — line 52, 96 — generate user ID
- `this.legacy.now()` — line 56, 102 — generate timestamp
- `this.legacy.sha256(password)` — line 156 — legacy hash comparison

**Write operations:**
- `this.legacy.persist()` — line 64, 81, 109, 142 — full snapshot write after user mutation

**Tables accessed (via snapshot):** users, user_profiles, style_profiles, wardrobes, wardrobe_items, brands, sessions, style_memories, style_preferences, subscriptions, outfits, outfit_items, outfit_feedback, calendar_events, event_schedules, weekly_plans, shopping_items, wishlist_items, purchases, ai_conversations, ai_interactions, ai_usage, weather_snapshots, calendar_events, wear_events, occasions, categories, clothing_attributes, recommendations, recommendation_feedback, app_notifications, trips, packing_lists

**Relationships:** Full document — all 26 tables rewritten on every write

**Same domain via TypeORM repos?** No — AuthService exclusively uses LegacyDbService

**Express overlap?** Yes — Express also manages users via `store.ts` JSON file. Separate data stores.

---

### 2. JwtStrategy (`backend/src/modules/auth/jwt.strategy.ts`)

**Injection:** `private readonly legacy: LegacyDbService`

**Read operations:**
- `this.legacy.findUser(payload.sub)` — line 36 — user lookup for JWT validation

**Write operations:** None

**Tables accessed:** users (via in-memory LegacyDb document)

**Same domain via TypeORM repos?** No

**Express overlap?** Yes — Express also validates JWT tokens against its own JSON store

---

## TypeORM Repository Consumer Detail

### 3. WardrobeService (`backend/src/modules/wardrobe/wardrobe.service.ts`)

**Repositories:** `@InjectRepository(WardrobeItem)`, `@InjectRepository(Wardrobe)`

**Operations:** Direct TypeORM CRUD — no LegacyDbService usage

**Tables:** wardrobe_items, wardrobes

**Same domain via LegacyDbService?** No — bypasses LegacyDbService entirely

**Express overlap?** Yes — Express wardrobe routes use `store.ts` JSON

---

### 4. OutfitsService (`backend/src/modules/outfits/outfits.service.ts`)

**Repositories:** `@InjectRepository(Outfit)`, `@InjectRepository(OutfitItem)`, `@InjectRepository(OutfitFeedback)`, `@InjectRepository(WardrobeItem)`, `@InjectRepository(Wardrobe)`, `@InjectRepository(StyleProfile)`

**Operations:** Direct TypeORM CRUD

**Tables:** outfits, outfit_items, outfit_feedback, wardrobe_items, wardrobes, style_profiles

**Same domain via LegacyDbService?** No

**Express overlap?** Yes

---

### 5. PlannerService (`backend/src/modules/planner/planner.service.ts`)

**Repositories:** `@InjectRepository(CalendarEvent)`, `@InjectRepository(EventSchedule)`, `@InjectRepository(WeeklyPlan)`, `@InjectRepository(WardrobeItem)`, `@InjectRepository(Wardrobe)`, `@InjectRepository(Outfit)`

**Operations:** Direct TypeORM CRUD

**Tables:** calendar_events, event_schedules, weekly_plans, wardrobe_items, wardrobes, outfits

**Same domain via LegacyDbService?** No

**Express overlap?** Yes

---

### 6. ShopService (`backend/src/modules/shop/shop.service.ts`)

**Repositories:** `@InjectRepository(WardrobeItem)`, `@InjectRepository(Wardrobe)`, `@InjectRepository(ShoppingItem)`, `@InjectRepository(WishlistItem)`

**Operations:** Direct TypeORM CRUD

**Tables:** wardrobe_items, wardrobes, shopping_items, wishlist_items

**Same domain via LegacyDbService?** No

**Express overlap?** Yes

---

### 7. StylistService (`backend/src/modules/stylist/stylist.service.ts`)

**Repositories:** `@InjectRepository(WardrobeItem)`, `@InjectRepository(Wardrobe)`, `@InjectRepository(AIConversation)`, `@InjectRepository(AIInteraction)`, `@InjectRepository(AIUsage)`, `@InjectRepository(StyleProfile)`, `@InjectRepository(Outfit)`, `@InjectRepository(OutfitFeedback)`, `@InjectRepository(User)`

**Operations:** Direct TypeORM CRUD

**Tables:** wardrobe_items, wardrobes, ai_conversations, ai_interactions, ai_usage, style_profiles, outfits, outfit_feedback, users

**Same domain via LegacyDbService?** No

**Express overlap?** Yes

---

### 8. UsersService (`backend/src/modules/users/users.service.ts`)

**Repositories:** `@InjectRepository(User)`, `@InjectRepository(StyleProfile)`

**Operations:** Direct TypeORM CRUD

**Tables:** users, style_profiles

**Same domain via LegacyDbService?** Partially — AuthService manages users via LegacyDbService; UsersService manages users via TypeORM repos. **Conflict risk: both write to the same `users` table.**

**Express overlap?** Yes

---

### 9. AdminService (`backend/src/modules/admin/admin.service.ts`)

**Repositories:** `@InjectRepository(User)`, `@InjectRepository(WardrobeItem)`, `@InjectRepository(Outfit)`, `@InjectRepository(CalendarEvent)`, `@InjectRepository(OutfitFeedback)`, `@InjectRepository(AIUsage)`

**Operations:** Direct TypeORM CRUD (read-only dashboards)

**Tables:** users, wardrobe_items, outfits, calendar_events, outfit_feedback, ai_usage

**Same domain via LegacyDbService?** Partially — AuthService writes users via LegacyDbService snapshot; AdminService reads users via TypeORM. **Conflict risk.**

**Express overlap?** Yes

---

## Domain-Level Dependency Matrix

| Domain | LegacyDbService | TypeORM Repos | Express store.ts | Conflict Risk |
|--------|----------------|---------------|------------------|---------------|
| Users / Auth | ✅ AuthService | ✅ UsersService | ✅ server.js | High (3 writers) |
| Wardrobe items | ❌ (via snapshot only) | ✅ WardrobeService | ✅ server.js | High |
| Outfits | ❌ (via snapshot only) | ✅ OutfitsService | ✅ server.js | High |
| Planner / Events | ❌ (via snapshot only) | ✅ PlannerService | ✅ server.js | High |
| Shopping / Wishlist | ❌ (via snapshot only) | ✅ ShopService | ✅ server.js | High |
| Stylist / AI conversations | ❌ (via snapshot only) | ✅ StylistService | ✅ server.js | High |
| Admin dashboard | ❌ (via snapshot only) | ✅ AdminService | ✅ server.js | Medium (read-only) |
| Sessions | ✅ LegacyDbService | ❌ None | ✅ server.js | High |
| AI usage | ❌ (via snapshot only) | ✅ StylistService, AdminService | ✅ server.js | High |

**Key risk:** `UsersService` and `AuthService` both write to the `users` table — AuthService via LegacyDbService full snapshot (overwrites), UsersService via direct TypeORM repository (bypasses cache). The next `legacy.persist()` will overwrite any direct TypeORM user changes.

## Indirect / Dynamic Persistence

- `LegacyDbService.trackAi()` — calls `this.legacy.persist()` after tracking AI usage (line 160)
- `LegacyDbService.importFromJson()` — one-time migration from `data/db.json` (line 836)
- All `persist()` calls are fire-and-forget via `writeQueue` promise chain
