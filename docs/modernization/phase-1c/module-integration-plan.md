# Phase 1C — Module Integration Plan

## Current Module State

**Registered in AppModule (3):**
| Module | Controller | Providers | Exports |
|--------|-----------|-----------|---------|
| AuthModule | AuthController | AuthService, JwtStrategy, LegacyDbService | AuthService, JwtModule, PassportModule |
| AiModule | AiController | AiService | AiService |
| WeatherModule | WeatherController | WeatherService | WeatherService |

**Not registered (7):**
| Module | Controller | Providers | Exports |
|--------|-----------|-----------|---------|
| WardrobeModule | WardrobeController | WardrobeService | WardrobeService |
| OutfitsModule | OutfitsController | OutfitsService | OutfitsService |
| PlannerModule | PlannerController | PlannerService | (none) |
| ShopModule | ShopController | ShopService | (none) |
| StylistModule | StylistController | StylistService | StylistService |
| UsersModule | UsersController | UsersService | UsersService |
| AdminModule | AdminController | AdminService | (none) |

## Dependency Analysis

### WardrobeModule
- **Controller:** WardrobeController (`@Controller('wardrobe')`)
- **Service:** WardrobeService
- **Dependencies:** `@InjectRepository(WardrobeItem)`, `@InjectRepository(Wardrobe)`, `aiEngine` (legacy-modules), `readStoredImage`, `storageUrl` (storage)
- **Imports needed:** None (DatabaseModule provides repos; ConfigModule is global)
- **Exports:** WardrobeService
- **Circular deps:** None
- **Safe to register:** Yes

### UsersModule
- **Controller:** UsersController (`@Controller('users')`)
- **Service:** UsersService
- **Dependencies:** `@InjectRepository(User)`, `@InjectRepository(StyleProfile)`, `profilePayload`, `readStyleProfile`, `writeStyleProfile` (legacy-style), storage functions
- **Imports needed:** None
- **Exports:** UsersService
- **Circular deps:** None
- **Safe to register:** Yes

### OutfitsModule
- **Controller:** OutfitsController (`@Controller('outfits')`)
- **Service:** OutfitsService
- **Dependencies:** `@InjectRepository(Outfit)`, `@InjectRepository(OutfitItem)`, `@InjectRepository(OutfitFeedback)`, `@InjectRepository(WardrobeItem)`, `@InjectRepository(Wardrobe)`, `@InjectRepository(StyleProfile)`, `aiEngine`, `memoryStore` (legacy-modules), `readStyleProfile`
- **Imports needed:** None
- **Exports:** OutfitsService
- **Circular deps:** None
- **Safe to register:** Yes

### ShopModule
- **Controller:** ShopController (`@Controller('shop')`)
- **Service:** ShopService
- **Dependencies:** `@InjectRepository(WardrobeItem)`, `@InjectRepository(Wardrobe)`, `@InjectRepository(ShoppingItem)`, `@InjectRepository(WishlistItem)`, `aiEngine` (legacy-modules), `toLegacyItem` (function imported from planner.service — NOT a module dependency)
- **Imports needed:** None
- **Exports:** (none)
- **Circular deps:** None (function import, not module import)
- **Safe to register:** Yes

### AdminModule
- **Controller:** AdminController (`@Controller('admin')`, `@Roles(UserRole.ADMIN)`)
- **Service:** AdminService
- **Dependencies:** `@InjectRepository(User)`, `@InjectRepository(WardrobeItem)`, `@InjectRepository(Outfit)`, `@InjectRepository(CalendarEvent)`, `@InjectRepository(OutfitFeedback)`, `@InjectRepository(AIUsage)`, `llm`, `retrieval` (legacy-modules)
- **Imports needed:** None
- **Exports:** (none)
- **Circular deps:** None
- **Safe to register:** Yes

### StylistModule — BLOCKED
- **Controller:** StylistController (`@Controller('ai')`)
- **Service:** StylistService
- **Dependencies:** `@InjectRepository(WardrobeItem)`, `@InjectRepository(Wardrobe)`, `@InjectRepository(AIConversation)`, `@InjectRepository(AIInteraction)`, `@InjectRepository(AIUsage)`, `@InjectRepository(StyleProfile)`, `@InjectRepository(Outfit)`, `@InjectRepository(OutfitFeedback)`, `@InjectRepository(User)`, legacy-modules (aiEngine, llm, memoryStore, retrieval, scoring, taxonomy, vision, weatherEngine)
- **Route CONFLICT:** `@Controller('ai')` — AiModule already registers AiController with `@Controller('ai')`. Both controllers claim the same route prefix with identical route paths (`/ai/analyze-clothing`, `/ai/generate-outfit`, `/ai/chat`, etc.)
- **Exports:** StylistService
- **Circular deps:** None
- **Safe to register:** NO — route conflict with AiController
- **Resolution needed:** StylistController must use a different route prefix, or AiController must be changed. Since AiModule is already registered and serving the Flutter client, StylistController cannot use `@Controller('ai')`.

### PlannerModule — BLOCKED (depends on StylistModule)
- **Controller:** PlannerController (`@Controller()` — no prefix, root-level routes)
- **Service:** PlannerService
- **Dependencies:** `@InjectRepository(CalendarEvent)`, `@InjectRepository(EventSchedule)`, `@InjectRepository(WeeklyPlan)`, `@InjectRepository(WardrobeItem)`, `@InjectRepository(Wardrobe)`, `@InjectRepository(Outfit)`, `StylistService` (imported from StylistModule), `aiEngine`, `readStyleProfile`
- **Imports:** StylistModule
- **Exports:** (none)
- **Circular deps:** PlannerModule → StylistModule (if StylistModule were registered)
- **Safe to register:** NO — depends on StylistModule which is blocked
- **Note:** PlannerController uses `@Controller()` (no prefix). Routes: `/events`, `/planner/weekly`, `/travel/packing-list` under global `/api` prefix.

## Registration Order (Independent Modules First)

**Batch 1 — Independent, no conflicts:**
1. WardrobeModule
2. UsersModule
3. OutfitsModule
4. ShopModule
5. AdminModule

**Batch 2 — Blocked:**
6. StylistModule — route conflict with AiController (`@Controller('ai')`)
7. PlannerModule — depends on StylistModule

## Verification Checklist per Module

1. Module registered in AppModule imports
2. `npm run build` passes (0 TypeScript errors)
3. No route conflicts detected at runtime
4. `@ApiBearerAuth()` on all controllers (auth preserved)
5. `@Roles(UserRole.ADMIN)` on AdminController (admin auth preserved)
6. TypeORM repositories resolve via DatabaseModule
7. Legacy-modules imports resolve correctly

## Stop Conditions

- Route conflict between StylistController and AiController cannot be resolved without changing an already-registered controller
- PlannerModule cannot register without StylistModule
- Any registration causes build failure or test regression
