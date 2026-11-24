# Phase 1C.1 — Integration Analysis

## Current Route Configuration

### AiController (REGISTERED in AiModule)
**File:** `backend/src/modules/ai/ai.controller.ts`
- **Prefix:** `@Controller('ai-analysis')`
- **Auth:** None (no `@ApiBearerAuth()`, no `@Roles()`)
- **Routes:**
  - `GET /ai-analysis/health`
  - `POST /ai-analysis/analyze`

### StylistController (NOT registered — StylistModule not in AppModule)
**File:** `backend/src/modules/stylist/stylist.controller.ts`
- **Prefix:** `@Controller('ai')`
- **Auth:** `@ApiBearerAuth()` on controller, `@CurrentUser('id')` on all methods
- **Routes:**
  - `POST /ai/analyze-clothing`
  - `POST /ai/generate-outfit`
  - `POST /ai/calculate-compatibility`
  - `POST /ai/style-profile`
  - `POST /ai/wardrobe-gap`
  - `POST /ai/packing-list`
  - `POST /ai/chat`
  - `POST /ai/chat/stream`
  - `POST /ai/match-outfit`
  - `POST /ai/remix`
  - `GET /ai/style-dna`
  - `GET /ai/conversations`
  - `DELETE /ai/conversations`
  - `GET /ai/capabilities`

### PlannerController (NOT registered — PlannerModule not in AppModule)
**File:** `backend/src/modules/planner/planner.controller.ts`
- **Prefix:** `@Controller()` (no prefix, root level)
- **Auth:** `@ApiBearerAuth()` on controller, `@CurrentUser('id')` on user-scoped methods
- **Routes:**
  - `GET /events`
  - `POST /events`
  - `PATCH /events/:id`
  - `DELETE /events/:id`
  - `GET /planner/weekly`
  - `POST /planner/weekly`
  - `POST /travel/packing-list`

## Route Conflict Analysis

**There is NO route conflict between AiController and StylistController.**

- `AiController` prefix: `ai-analysis`
- `StylistController` prefix: `ai`

NestJS treats these as distinct prefixes. `ai` does not match `ai-analysis/*` routes. The two controllers can coexist.

**Previously documented conflict was incorrect.** The Phase 1C plan stated both used `@Controller('ai')`, but the actual code shows `AiController` uses `@Controller('ai-analysis')`. This was a documentation error in Phase 1C, not a code issue.

## Flutter API Client Route References

**File:** `lib/core/api/smartwardrobe_api.dart`

The Flutter client connects to **Express** (`http://10.0.2.2:3001` / `http://localhost:3002`), NOT NestJS (`:3000`).

| Flutter Method | Route | Backend Runtime |
|----------------|-------|-----------------|
| `analyzeClothing()` | `POST /ai/analyze-clothing` | Express |
| `generateOutfit()` | `POST /ai/generate-outfit` | Express |
| `compatibility()` | `POST /ai/calculate-compatibility` | Express |
| `chat()` | `POST /ai/chat` | Express |
| `chatStream()` | `POST /ai/chat/stream` | Express |
| `matchOutfit()` | `POST /ai/match-outfit` | Express |
| `remix()` | `POST /ai/remix` | Express |
| `styleDna()` | `GET /ai/style-dna` | Express |
| `conversations()` | `GET /ai/conversations` | Express |
| `clearConversations()` | `DELETE /ai/conversations` | Express |
| `capabilities()` | `GET /ai/capabilities` | Express |
| `wardrobeGap()` | `POST /ai/wardrobe-gap` | Express |
| `packingList()` | `POST /ai/packing-list` | Express |
| `events()` | `GET /events` | Express |
| `weeklyPlan()` | `GET /planner/weekly` | Express |
| `regenerateWeeklyPlan()` | `POST /planner/weekly` | Express |
| `travelPacking()` | → `packingList()` → `POST /ai/packing-list` | Express |

**Conclusion:** Changing the StylistController NestJS prefix will NOT break the Flutter client, because:
1. Flutter connects to Express, not NestJS
2. Express continues to serve all `/ai/*` routes unchanged
3. NestJS is not yet in the Flutter request path

## Express Route Overlap

**File:** `backend/server.js`

Express serves all `/ai/*` routes on port 3001/3002. NestJS runs on port 3000. They are on different ports, so there is no runtime conflict. Express continues to serve the Flutter client.

## Module Dependencies

### StylistModule
- **Controller:** StylistController
- **Service:** StylistService
- **Exports:** StylistService
- **Dependencies:** 10 TypeORM repositories (WardrobeItem, Wardrobe, AIConversation, AIInteraction, AIUsage, StyleProfile, Outfit, OutfitFeedback, User), legacy-modules (aiEngine, llm, memoryStore, retrieval, scoring, taxonomy, vision, weatherEngine), legacy-style
- **Imports needed:** None (DatabaseModule provides repos; ConfigModule is global)
- **Safe to register:** Yes

### PlannerModule
- **Controller:** PlannerController
- **Service:** PlannerService
- **Exports:** (none)
- **Dependencies:** StylistModule (imports it directly), 7 TypeORM repositories, legacy-modules (aiEngine), legacy-style
- **Imports needed:** StylistModule must be registered first
- **Safe to register:** Yes, AFTER StylistModule

## Security Analysis

| Controller | Auth Guard | Role Guard | User Scoping |
|------------|-----------|------------|--------------|
| StylistController | Global `JwtAuthGuard` | Global `RolesGuard` (no `@Roles()` → any authenticated user) | `@CurrentUser('id')` on all methods |
| PlannerController | Global `JwtAuthGuard` | Global `RolesGuard` (no `@Roles()` → any authenticated user) | `@CurrentUser('id')` on user-scoped methods |

Both controllers are protected by JWT authentication. No admin-only routes in either module. User data isolation is enforced at the service layer (all queries filter by `userId`).

## Proposed Route Mapping

No route prefix change is needed. `StylistController` can keep `@Controller('ai')` since `AiController` uses `@Controller('ai-analysis')` — they are distinct.

**Registration order:**
1. Register `StylistModule` (no dependencies on other feature modules)
2. Register `PlannerModule` (depends on `StylistModule`)

## Compatibility Measures

- **Flutter:** No changes needed — connects to Express, not NestJS
- **Express:** No changes needed — continues serving all routes
- **NestJS routes:** StylistController routes under `/ai/*` are unique (no overlap with AiController's `/ai-analysis/*`)

## Dependency and Security Risks

| Risk | Level | Mitigation |
|------|-------|------------|
| None — no route conflict exists | — | Register StylistModule directly |
| PlannerModule depends on StylistModule | Low | Register StylistModule first |
| No test coverage for new modules | Medium | Existing 40 tests still pass; no regressions expected |

## Approval Checkpoint

**Proposed implementation:**
1. Register `StylistModule` in `AppModule` imports
2. Build and verify (0 TS errors)
3. Register `PlannerModule` in `AppModule` imports
4. Build and verify (0 TS errors)
5. Run Jest tests (40/40)
6. Runtime init verification

**No source code changes to controllers or services required.**

Please confirm approval to proceed with implementation.
