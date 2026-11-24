# Phase 0 — Dependency and Request Flow Map

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Flutter Client (lib/)                               │
│  lib/core/api/api_config.dart → baseUrl: http://10.0.2.2:3001 (Express)    │
│  lib/core/api/api_client.dart → HTTP client with JWT token                  │
│  lib/core/api/smartwardrobe_api.dart → typed wrappers for all endpoints     │
│  lib/features/* → UI screens that call SmartWardrobeApi methods             │
└─────────────────────────────────────────────────────────────────────────────┘
                              │ HTTP/REST + multipart + SSE
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              EXPRESS RUNTIME (server.js) — ACTIVE, SERVING FLUTTER          │
│  Port: EXPRESS_PORT (3001 default, 3002 in .env)                            │
│  Middleware: cors(*), express.json(10mb), body normalizers                  │
│                                                                             │
│  Route groups (58 routes):                                                  │
│  ├── Auth      → auth.controller logic inline in server.js                  │
│  ├── Users     → inline in server.js                                        │
│  ├── Wardrobe  → inline in server.js                                        │
│  ├── AI        → inline in server.js                                        │
│  ├── Outfits   → inline in server.js                                        │
│  ├── Planner   → inline in server.js                                        │
│  ├── Shop      → inline in server.js                                        │
│  ├── Admin     → inline in server.js                                        │
│  ├── Weather   → inline in server.js                                        │
│  └── System    → inline in server.js                                        │
│                                                                             │
│  Dependencies required at runtime:                                          │
│  ├── require('./src/store')          → JSON file persistence (db.json)      │
│  ├── require('./src/ai-engine')      → TS-compiled AI rule engine           │
│  ├── require('./src/llm')            → TS-compiled LLM client               │
│  ├── require('./src/scoring')        → TS-compiled scoring                   │
│  ├── require('./src/style-memory')   → TS-compiled learning loop             │
│  ├── require('./src/retrieval')      → TS-compiled retrieval                  │
│  ├── require('./src/weather')        → TS-compiled weather                   │
│  ├── require('./src/vision')         → TS-compiled vision pipeline           │
│  ├── require('./src/taxonomy')       → TS-compiled fashion taxonomy          │
│  └── require('dotenv').config()      → loads .env                           │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────────────┐
│              NESTJS RUNTIME (src/main.ts) — COMPILES, NOT SERVING FLUTTER   │
│  Port: 3000 (default)                                                       │
│  Global prefix: /api                                                        │
│                                                                             │
│  Registered modules (3 of 10):                                              │
│  ├── AuthModule     → auth.controller, auth.service, jwt.strategy           │
│  ├── AiModule       → ai.controller, ai.service                             │
│  └── WeatherModule  → weather.controller, weather.service                   │
│                                                                             │
│  NOT registered (7 modules exist but are inert):                            │
│  ├── WardrobeModule     → wardrobe.controller, wardrobe.service             │
│  ├── OutfitsModule      → outfits.controller, outfits.service               │
│  ├── PlannerModule      → planner.controller, planner.service               │
│  ├── ShopModule         → shop.controller, shop.service                     │
│  ├── StylistModule      → stylist.controller, stylist.service               │
│  ├── UsersModule        → users.controller, users.service                   │
│  └── AdminModule        → admin.controller, admin.service                   │
│                                                                             │
│  Shared infrastructure:                                                     │
│  ├── DatabaseModule   → TypeORM (PostgreSQL primary, SQLite fallback)       │
│  ├── AppCacheModule   → Redis + in-process cache                            │
│  ├── LegacyModule     → LegacyDbService (global, MySQL-backed document)     │
│  └── HealthController → /health endpoint                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
          ┌───────────────┐   ┌──────────────────┐
          │   MySQL       │   │ Python FastAPI   │
          │ (primary DB)  │   │ (ai-service:8000)│
          │ TypeORM 35    │   │ Optional clothing│
          │ entities      │   │ analysis service │
          └───────────────┘   └──────────────────┘
                    │
          ┌───────────────┐
          │   Redis       │
          │ (cache, auto) │
          └───────────────┘
```

## 2. Active Express Routes → Implementation Mapping

Each Express route in `server.js` handles the request inline (no controller/service separation). Key implementation details:

| Route | Implementation Location | Dependencies |
|-------|------------------------|--------------|
| `/auth/register` | server.js:342 | store (JSON), bcrypt |
| `/auth/login` | server.js:360 | store, bcrypt, JWT sign |
| `/auth/logout` | server.js:382 | store, JWT |
| `/users/me` | server.js:395 | profilePayload, store |
| `/wardrobe/items` | server.js:497 | store (db.wardrobe) |
| `/wardrobe/items` POST | server.js:511 | store, aiEngine (optional analysis) |
| `/ai/analyze-clothing` | server.js:650 | vision, aiEngine |
| `/ai/generate-outfit` | server.js:723 | aiEngine |
| `/ai/chat` | server.js:915 | llm, aiEngine, memoryStore |
| `/ai/chat/stream` | server.js:1014 | llm, aiEngine, SSE response |
| `/outfits` POST | server.js:1304 | aiEngine, store |
| `/outfits/:id/feedback` | server.js:1351 | aiEngine, memoryStore, style-memory |
| `/planner/weekly` POST | server.js:1418 | aiEngine, store |
| `/shop/recommended` | server.js:1438 | aiEngine.wardrobeGap, store |
| `/weather/current` | server.js:1527 | weatherService |
| `/admin/*` | server.js:1463-1487 | store, llm.status(), retrieval.status() |

## 3. NestJS Module → Controller → Service → Database Flow

### AuthModule (REGISTERED)
```
Request → AuthController → AuthService → UserRepository (TypeORM)
                    → JwtStrategy → LegacyDbService.findUser()
                    → JWT sign/verify
```

### AiModule (REGISTERED)
```
Request → AiController → AiService → axios → Python FastAPI (localhost:8000)
                              → fallback: unavailable response
```

### WeatherModule (REGISTERED)
```
Request → WeatherController → WeatherService → Open-Meteo API
                                            → OpenWeatherMap (if key)
                                            → seasonal estimate (fallback)
```

### WardrobeModule (NOT REGISTERED — inert)
```
Would flow: WardrobeController → WardrobeService → WardrobeItemRepository
                                      → LegacyDbService (if wired)
```

### OutfitsModule (NOT REGISTERED — inert)
```
Would flow: OutfitsController → OutfitsService → OutfitRepository, WardrobeItemRepository
                                      → aiEngine.generateOutfits(), aiEngine.calculateCompatibility()
                                      → memoryStore (style memory)
```

### StylistModule (NOT REGISTERED — inert)
```
Would flow: StylistController → StylistService → AI conversation/interaction repos
                                      → aiEngine.chatReply(), aiEngine.generateOutfits()
                                      → llm.complete(), weatherEngine.current()
```

### Others (NOT REGISTERED)
- PlannerModule, ShopModule, UsersModule, AdminModule — all exist but are not imported in `AppModule`

## 4. LegacyDbService — The Central Persistence Anti-Pattern

**File:** `src/common/legacy/legacy-db.service.ts` (866 lines)

The LegacyDbService is the single point through which all data flows:

```
Boot: Hydrate all 26 tables from MySQL → in-memory LegacyDb document
Read:  Controllers read from in-memory document (synchronous, no DB query)
Write: Mutate in-memory document → writeQueue serializes → writeSnapshot()
       writeSnapshot() = DELETE all rows from ALL 26 tables + re-insert all data
       All inside one TypeORM transaction
```

**Tables in the snapshot:** users, sessions, wardrobe, outfits, wearEvents, feedback,
styleMemory, conversations, events, weeklyPlan, wishlist, products, aiUsage, styleMemories

**Impact:** Every write operation (register, login, wardrobe item add, outfit feedback,
chat message) rewrites the entire database. O(n) write amplification where n = total
data size across all tables.

## 5. TypeORM Entities (35 total) vs Actual Usage

| Entity | Table | Used by LegacyDbService | Used by NestJS Repositories |
|--------|-------|------------------------|----------------------------|
| User | users | Yes (hydrate + snapshot) | AuthService, UsersService, AdminService |
| UserProfile | user_profiles | Yes | UsersService |
| StyleProfile | style_profiles | Yes | OutfitsService, UsersService, AdminService |
| StylePreference | style_preferences | Yes | (none directly) |
| StyleMemory | style_memories | Yes | OutfitsService (via LegacyDb) |
| Subscription | subscriptions | Yes | AdminService |
| Wardrobe | wardrobes | Yes | OutfitsService, PlannerService, ShopService, UsersService |
| WardrobeItem | wardrobe_items | Yes | OutfitsService, PlannerService, ShopService, UsersService, AdminService |
| ClothingAttribute | clothing_attributes | Yes | (none directly) |
| Brand | brands | Yes | (none directly) |
| Category | categories | Yes | (none directly) |
| WearEvent | wear_events | Yes | (none directly) |
| Occasion | occasions | Yes | (none directly) |
| Outfit | outfits | Yes | OutfitsService, PlannerService, AdminService |
| OutfitItem | outfit_items | Yes | OutfitsService |
| OutfitFeedback | outfit_feedback | Yes | OutfitsService, AdminService |
| Recommendation | recommendations | Yes | (none directly) |
| RecommendationFeedback | rec_feedback | Yes | (none directly) |
| WeatherSnapshot | weather_snapshots | Yes | (none directly) |
| CalendarEvent | calendar_events | Yes | PlannerService, AdminService |
| EventSchedule | event_schedules | Yes | PlannerService |
| Trip | trips | Yes | (none directly) |
| PackingList | packing_lists | Yes | (none directly) |
| ShoppingItem | shopping_items | Yes | ShopService, AdminService |
| WishlistItem | wishlist_items | Yes | ShopService, AdminService |
| Purchase | purchases | Yes | (none directly) |
| AIConversation | ai_conversations | Yes | StylistService, AdminService |
| AIInteraction | ai_interactions | Yes | StylistService, AdminService |
| AppNotification | app_notifications | Yes | (none directly) |
| AIUsage | ai_usage | Yes | AdminService |
| Session | sessions | Yes | (none directly — JWT is stateless) |
| WeeklyPlan | weekly_plans | Yes | PlannerService |

**Key finding:** NestJS services (`OutfitsService`, `PlannerService`, `ShopService`, `UsersService`, `AdminService`) use TypeORM `@InjectRepository` directly for reads. Writes still go through LegacyDbService in some paths.

## 6. AI Pipeline Dependencies

### In-process TypeScript (default, `AI_MODE=rule-engine`)
```
ai-engine.ts → scoring.ts, style-memory.ts, retrieval.ts, vision.ts, weather.ts, taxonomy.ts
llm.ts → axios → LLM provider (Gemini/Groq/OpenRouter/OpenAI)
```

### Python FastAPI (optional, `AI_MODE=http`)
```
AiService (NestJS) → axios POST → ai-service/main.py (FastAPI, port 8000)
ai-service/ → torch, torchvision, open_clip_torch, transformers, opencv-python, Pillow, scikit-learn
```

**Model cache:** `backend/.model-cache/` contains Marqo fashionCLIP and Xenova all-MiniLM-L6-v2 ONNX models.

## 7. File Storage Dependencies

```
storage.ts → multer.diskStorage() → backend/storage/ directory
           → fs.readFileSync() for reading stored images
           → storageUrl() generates `${req.protocol}://${req.get('host')}/storage/<file>`
```

**Limitations:** Local disk only. Not compatible with horizontal scaling (multiple instances would have different files). No virus scanning, no image dimension validation beyond mimetype check.

## 8. Cache Dependencies

```
AppCacheModule → @nestjs/cache-manager + keyv-redis
               → Redis when reachable (mode=auto)
               → in-process Map when Redis unavailable
               → TTL configurable (default 300s)
```

**Queue (BullMQ):** Configured but disabled (`QUEUE_ENABLED=false`). No job processors exist.

## 9. Request Flow Examples

### Flow 1: User registers (Express)
```
Flutter POST /auth/register
  → server.js inline handler
  → bcrypt.hash(password)
  → store.load() / store.save() (JSON file)
  → JWT sign (accessToken)
  → res.json({accessToken, user})
```

### Flow 2: User adds wardrobe item with AI analysis (Express)
```
Flutter POST /wardrobe/items (multipart)
  → server.js inline handler
  → multer saves file to storage/
  → vision.analyzeClothingImage() (fashionCLIP)
  → store.save() (JSON file with full snapshot via LegacyDb equivalent)
  → res.json({item})
```

### Flow 3: Stylist chat (Express)
```
Flutter POST /ai/chat
  → server.js inline handler
  → llm.complete() (Gemini/Groq/etc.)
  → fallback: aiEngine.chatReply() (rule engine)
  → memoryStore.record() (learn from feedback)
  → store.save() (JSON file)
  → res.json({reply, outfit, weather, memory, source})
```

### Flow 4: Weather request (Express + NestJS both)
```
Flutter GET /weather/current?city=Cairo
  → Express server.js:1527 OR NestJS WeatherController
  → WeatherService.current()
  → Open-Meteo API (keyless)
  → fallback: OpenWeatherMap (if key)
  → fallback: seasonal estimate
  → res.json({weather: {...}})
```

### Flow 5: NestJS outfit recommendation (NOT served to Flutter — module not registered)
```
[Would be] Flutter GET /api/outfits/recommended
  → [Not registered] OutfitsController
  → OutfitsService.userWardrobeIds() → WardrobeRepository
  → aiEngine.generateOutfits(items, {occasion, weather, styleProfile, count})
  → res.json({outfits, weather, occasion})
```

## 10. Code That Exists vs Code That Is Executed

| Code | Exists | Executed by Flutter | Notes |
|------|--------|---------------------|-------|
| Express server.js | Yes | Yes (port 3001/3002) | The only runtime Flutter talks to |
| NestJS AuthModule | Yes | No (port 3000, not configured in Flutter) | Registered but unreachable |
| NestJS AiModule | Yes | No | Registered but unreachable |
| NestJS WeatherModule | Yes | No | Registered but unreachable |
| NestJS WardrobeModule | Yes | No | Not registered in AppModule |
| NestJS OutfitsModule | Yes | No | Not registered in AppModule |
| NestJS StylistModule | Yes | No | Not registered in AppModule |
| NestJS PlannerModule | Yes | No | Not registered in AppModule |
| NestJS ShopModule | Yes | No | Not registered in AppModule |
| NestJS UsersModule | Yes | No | Not registered in AppModule |
| NestJS AdminModule | Yes | No | Not registered in AppModule |
| LegacyDbService | Yes | Yes (via Express require chain) | Full-snapshot writes on every mutation |
| Python FastAPI ai-service | Yes | No (AI_MODE=rule-engine default) | Only used if AI_MODE=http |
| BullMQ queue | Yes | No | QUEUE_ENABLED=false, no processors |
| Redis | Configured | No | QUEUE_ENABLED=false, mode=auto degrades |
| Jest tests (40) | Yes | N/A | 2 spec files, all passing |
