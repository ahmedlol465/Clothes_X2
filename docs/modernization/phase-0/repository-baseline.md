# Phase 0 — Repository Baseline

## Repository State

| Field | Value |
|-------|-------|
| Working directory | `/media/h/New Volume1/Development/Clothes_X/clothes_x` |
| Git branch | `main` (ahead of `origin/main` by 11 commits) |
| Working tree | Dirty — 100+ modified files, 24 deleted files, 34 untracked files |
| Last commit | `f833fc9` Fix weather location: reverse-geocode GPS first, IP fallback for web, honest offline pill, time-aware greeting |

## Top-Level Directory Structure

```
clothes_x/
├── ai-service/              # Python FastAPI clothing analysis service
├── android/                 # Android project files
├── backend/                 # NestJS + Express backend
├── build/                   # Flutter build output
├── ios/                     # iOS project files
├── lib/                     # Flutter application source
├── test/                    # Flutter tests
├── web/                     # Flutter web build
├── pubspec.yaml             # Flutter dependencies
└── README.md                # Project README
```

## Backend Directory Structure

```
backend/
├── server.js                # Express legacy runtime (entry point, port 3001/3002)
├── package.json             # Backend dependencies and scripts
├── nest-cli.json            # NestJS CLI configuration
├── tsconfig.json            # TypeScript configuration
├── .env                     # Local secrets (gitignored)
├── .env.example             # Environment variable template
├── data/                    # JSON persistence files
│   ├── db.json              # Live JSON data store (96,820 bytes)
│   └── db.json.bak          # Previous backup (92,431 bytes)
├── storage/                 # Local file uploads (images, avatars)
├── src/                     # NestJS TypeScript source
│   ├── main.ts              # NestJS bootstrap (port 3000)
│   ├── app.module.ts        # NestJS root module
│   ├── ai-engine.ts         # AI rule engine (converted from JS)
│   ├── llm.ts               # LLM client (converted from JS)
│   ├── scoring.ts           # Outfit scoring (converted from JS)
│   ├── retrieval.ts         # Wardrobe retrieval (converted from JS)
│   ├── store.ts             # Data store (converted from JS)
│   ├── style-memory.ts      # Learning loop (converted from JS)
│   ├── taxonomy.ts          # Fashion taxonomy (converted from JS)
│   ├── vision.ts            # Vision pipeline (converted from JS)
│   ├── weather.ts           # Weather service (converted from JS)
│   ├── clothing-vision/     # FashionCLIP vision pipeline (converted from JS)
│   ├── common/              # Shared NestJS infrastructure
│   │   ├── cache/cache.service.ts     # Redis + in-process cache
│   │   ├── decorators/auth.decorators.ts
│   │   ├── dto/pagination.dto.ts
│   │   ├── filters/all-exceptions.filter.ts
│   │   ├── guards/jwt-auth.guard.ts
│   │   ├── guards/roles.guard.ts
│   │   ├── health.controller.ts
│   │   ├── interceptors/response.interceptor.ts
│   │   ├── legacy/                  # LegacyDbService bridge
│   │   │   ├── legacy-db.service.ts     # Full-snapshot MySQL persistence
│   │   │   ├── legacy-modules.ts        # AI pipeline bridge
│   │   │   ├── legacy.module.ts
│   │   │   ├── legacy-style.ts
│   │   │   └── legacy.types.ts
│   │   └── storage/storage.ts         # Local file storage + multer
│   ├── config/configuration.ts        # All config factories
│   ├── database/
│   │   ├── data-source.ts             # TypeORM DataSource with SQLite fallback
│   │   ├── database.module.ts         # TypeORM module
│   │   ├── entities/                  # 35 TypeORM entities
│   │   ├── migrations/                # One empty migration
│   │   ├── seed.cli.ts                # Seed script
│   │   └── sqlite/node-sqlite-driver.ts
│   └── modules/                     # NestJS feature modules
│       ├── ai/              # AI analysis (registered in AppModule)
│       ├── auth/            # Authentication (registered in AppModule)
│       ├── weather/         # Weather (registered in AppModule)
│       ├── wardrobe/        # Wardrobe items (NOT registered in AppModule)
│       ├── outfits/         # Outfits (NOT registered in AppModule)
│       ├── planner/         # Planner/events (NOT registered in AppModule)
│       ├── shop/            # Shopping (NOT registered in AppModule)
│       ├── stylist/         # AI stylist (NOT registered in AppModule)
│       ├── users/           # Users (NOT registered in AppModule)
│       └── admin/           # Admin (NOT registered in AppModule)
```

## Runtime Configuration

### Dual Runtime Setup

The project runs **two backend runtimes simultaneously**:

| Runtime | Entry Point | Port | Used By |
|---------|------------|------|---------|
| Express (legacy) | `server.js` | `EXPRESS_PORT` (default 3001, `.env` overrides to 3002) | Flutter client via `ApiConfig.baseUrl` |
| NestJS (target) | `src/main.ts` | `PORT` (default 3000) | Not yet connected to Flutter |

### Express Routes (58 total)

Auth: `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`
Users: `/users/me` (GET/PATCH), `/users/me/avatar`, `/users/me/style-profile` (GET/PATCH)
Wardrobe: `/wardrobe/items` (GET/POST), `/wardrobe/items/:id` (GET/PATCH/DELETE), `/wardrobe/items/batch-upload`, `/wardrobe/upload`, `/wardrobe/collections`
AI: `/ai/analyze-clothing`, `/ai/generate-outfit`, `/ai/calculate-compatibility`, `/ai/style-profile`, `/ai/wardrobe-gap`, `/ai/packing-list`, `/ai/chat`, `/ai/chat/stream`, `/ai/match-outfit`, `/ai/remix`, `/ai/style-dna`, `/ai/conversations` (GET/DELETE), `/ai/capabilities`
Outfits: `/outfits/recommended`, `/outfits` (GET/POST), `/outfits/:id` (GET/PATCH/DELETE), `/outfits/:id/favorite`, `/outfits/:id/feedback`
Planner: `/events` (GET/POST/PATCH/DELETE), `/planner/weekly` (GET/POST), `/travel/packing-list`
Shop: `/shop/recommended`, `/shop/before-you-buy`, `/shop/wishlist` (GET/POST)
Admin: `/admin/dashboard`, `/admin/users`, `/admin/ai-performance`, `/admin/reports`, `/admin/system-health`
Weather: `/weather/current`
System: `/health`, `/docs`

### NestJS Routes (registered modules only)

Currently registered in `app.module.ts`: `AuthModule`, `AiModule`, `WeatherModule`.
Not registered: `WardrobeModule`, `OutfitsModule`, `PlannerModule`, `ShopModule`, `StylistModule`, `UsersModule`, `AdminModule`.

The NestJS server compiles but cannot serve wardrobe, outfit, planner, shop, user, or admin requests.

## Environment Configuration

`.env` (local, gitignored):
- `PORT=3002`, `EXPRESS_PORT=3002`
- `DB_TYPE=sqlite`, `DB_SYNCHRONIZE=true`
- `USE_MYSQL=false`
- `GEMINI_API_KEY` is set (visible in file)
- `WEATHER_KEY` is empty
- `QUEUES_ENABLED=false`

`.env.example` (committed):
- `PORT=3000`, `DB_TYPE=postgres`, `DB_SYNCHRONIZE=true`
- `REDIS_MODE=auto`, `QUEUE_ENABLED=false`
- `JWT_ACCESS_SECRET=smartwardrobe-dev-access-secret` (default secret)
- `GEMINI_API_KEY=` (empty)
- `EXPRESS_PORT=3001`

## Dependencies

Backend key dependencies:
- `@nestjs/core`, `@nestjs/common`, `@nestjs/config`, `@nestjs/typeorm`, `@nestjs/jwt`, `@nestjs/passport`, `@nestjs/cache-manager`, `@nestjs/swagger`, `@nestjs/schedule`
- `typeorm`, `pg`, `mysql2`, `better-sqlite3` (via shim), `axios`, `bcryptjs`, `cache-manager`, `keyv-redis`, `multer`, `sharp`, `compression`, `helmet`, `cors`, `express`, `passport`, `passport-jwt`, `uuid`, `rxjs`
- `@nestjs/cli`, `jest`, `ts-jest`, `ts-node`, `typescript`, `eslint`, `prettier`

AI service (Python): `fastapi`, `uvicorn`, `pydantic`, `torch`, `torchvision`, `open_clip_torch`, `transformers`, `opencv-python`, `Pillow`, `scikit-learn`

Flutter: `http`, `http_parser`, `image_picker`, `geolocator`, `shared_preferences`, `flutter_lints`

## Deleted/Converted Files (JS → TS)

Deleted JS files (now tracked as deleted in git):
- `src/ai-engine.js`, `src/llm.js`, `src/scoring.js`, `src/retrieval.js`, `src/store.js`, `src/style-memory.js`, `src/taxonomy.js`, `src/vision.js`, `src/weather.js`
- `src/clothing-vision/{classify,color,encoder,index,prompts}.js`

New TS files (untracked):
- `src/ai-engine.ts`, `src/llm.ts`, `src/scoring.ts`, `src/retrieval.ts`, `src/store.ts`, `src/style-memory.ts`, `src/taxonomy.ts`, `src/vision.ts`, `src/weather.ts`
- `src/clothing-vision/{classify,color,encoder,index,prompts}.ts`
- `src/common/legacy/` (5 files)
- `src/common/storage/` (1 file)
- All NestJS module directories under `src/modules/`

## Build Artifacts

- `backend/dist/` — does not exist (build fails due to TS errors)
- `backend/node_modules/` — exists (1464 directories)
- `backend/.model-cache/` — exists (Marqo fashionCLIP, Xenova all-MiniLM-L6-v2 models)

## Known Pre-Existing Issues

1. NestJS build fails with 10 TypeScript errors (outfits.service, planner.service, stylist.service, auth.service, auth.controller, all-exceptions.filter)
2. `app.module.ts` only registers 3 of 10 modules
3. Flutter `ApiConfig` points to Express port 3001/3002, not NestJS port 3000
4. `.env` contains a visible `GEMINI_API_KEY`
5. No Dockerfile, no docker-compose.yml, no CI/CD configuration
6. No `docs/` directory existed before Phase 0
