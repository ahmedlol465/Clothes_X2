# SmartWardrobe Architecture

## Overview

SmartWardrobe is an AI-powered fashion stylist application with three main components:

1. **Flutter App** (client) - Cross-platform mobile app
2. **NestJS Backend** (server) - Primary API, auth, data persistence, orchestration
3. **Python AI Service** (analysis) - Computer vision, outfit generation, compatibility scoring

## High-Level Data Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Flutter   │────▶│    NestJS API    │────▶│  Python AI Svc  │
│   (Client)  │     │   (Canonical)    │     │  (Analysis)     │
└─────────────┘     └──────────────────┘     └─────────────────┘
       ▲                   │                       │
       │                   ▼                       ▼
       │            ┌──────────────┐      ┌──────────────┐
       │            │  PostgreSQL  │      │   Gemini/    │
       └────────────│  (Primary)   │      │  Heuristics  │
                    └──────────────┘      └──────────────┘
```

## Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Mobile | Flutter | 3.x |
| Backend | NestJS | 10.x |
| Database | PostgreSQL | 15+ |
| ORM | TypeORM | 0.3+ |
| AI Service | Python | 3.11+ |
| Vision | Google Gemini | 1.5 Flash |
| Weather | Open-Meteo | keyless |
| Auth | JWT (HS256) | — |
| Rate Limiting | In-memory | — |

## Module Structure

### Flutter App (`lib/`)

```
lib/
├── app.dart                 # App entry, routing, theme
├── core/                    # Shared infrastructure
│   ├── api/                 # HTTP client, endpoints, exceptions
│   ├── theme/               # Colors, typography, spacing
│   ├── widgets/             # Reusable UI components
│   └── icons/               # Custom icon font
├── data/                    # State & data layer
│   ├── controllers/         # Feature controllers (Account, Wardrobe, etc.)
│   ├── models.dart          # Pure Dart domain models
│   ├── dto/mappers.dart     # JSON ↔ Model mapping
│   └── assets.dart          # Centralized asset constants
└── features/                # Feature modules
    ├── auth/                # Login, signup, onboarding
    ├── home/                # Dashboard, today's pick
    ├── wardrobe/            # Grid, detail, add clothing
    ├── outfits/             # Saved, history, planner, perfect match
    ├── stylist/             # AI chat, photo match, remix
    ├── profile/             # Account, style profile, settings
    └── insights/            # Wardrobe analytics
```

### NestJS Backend (`backend/src/`)

```
src/
├── main.ts                  # Bootstrap, Swagger, CORS, rate limit
├── app.module.ts            # Root module
├── common/                  # Shared utilities
│   ├── legacy/              # Legacy engine adapters
│   ├── storage/             # File upload handling
│   ├── filters/             # Exception filters
│   └── interceptors/        # Response wrapping
├── modules/
│   ├── auth/                # JWT auth, login, register
│   ├── users/               # Profile, avatar, style blueprint
│   ├── wardrobe/            # Items, upload, analysis, categories
│   ├── ai/                  # Clothing analyzer, analyzer selection
│   ├── outfits/             # Saved, today, history, favorites
│   ├── planner/             # Weekly, travel, packing
│   ├── shop/                # Recommendations, wishlist
│   ├── stylist/             # Chat, streaming, photo match, remix
│   ├── admin/               # Health, metrics, user mgmt
│   └── weather/             # Open-Meteo integration
└── database/
    └── entities/            # TypeORM entities
```

### Python AI Service (`ai-service/`)

```
ai-service/
├── main.py                  # FastAPI entry point
├── pipelines/               # Analysis pipelines
│   ├── clothing.py          # Clothing attribute extraction
│   ├── outfit.py            # Outfit generation, compatibility
│   └── remix.py             # Outfit variant generation
├── vision/                  # Computer vision
│   ├── gemini.py            # Google Gemini integration
│   └── heuristics.py        # Filename/EXIF fallback
├── retrieval/               # Semantic search
│   └── embeddings.py        # Item embeddings, ranking
├── scoring/                 # Compatibility algorithms
│   └── outfit_scorer.py     # Weighted attribute scoring
└── taxonomy/                # Vocabulary normalization
    └── normalizer.py        # Category, color, style canonicalization
```

## Key Architectural Decisions

### 1. NestJS as Canonical Backend (ADR 001)
- Single source of truth for business logic, auth, data access
- Express legacy code wrapped behind interfaces, not removed
- Clean migration path: legacy modules → NestJS services

### 2. Python AI Service as Analysis Source of Truth (ADR 002)
- All clothing analysis routes through Python service
- NestJS `ClothingAnalyzerService` delegates with local fallback
- Python owns vision models, heuristics, taxonomy

### 3. Mock Fallback as Demo Mode (ADR 003)
- `AI_ANALYZER=local|python|auto` controls analysis source
- Local heuristics work offline for demos
- Graceful degradation when Python service unavailable

### 4. Controller-Based State (Flutter)
- `AppState` → thin facade over feature controllers
- `AccountController`, `WardrobeController`, `OutfitsController`, etc.
- Screens migrate from `AppState.instance` → injected controllers
- Enables testing, decoupling, incremental migration

### 5. Named Routing (Flutter)
- All screens registered in `app.dart` `Routes` class
- `MaterialPageRoute` only for argument-passing routes
- Eliminates 22 `MaterialPageRoute` usages → 5 named routes

## Data Models

### Core Entities (TypeORM)

| Entity | Table | Key Relations |
|--------|-------|---------------|
| `User` | `users` | Wardrobe, StyleProfile, AIUsage |
| `Wardrobe` | `wardrobes` | User (1:1), WardrobeItem (1:N) |
| `WardrobeItem` | `wardrobe_items` | Wardrobe, Brand, Category |
| `StyleProfile` | `style_profiles` | User (1:1) |
| `Outfit` | `outfits` | User, OutfitFeedback |
| `OutfitFeedback` | `outfit_feedback` | Outfit, User |
| `AIConversation` | `ai_conversations` | User, AIInteraction |
| `AIInteraction` | `ai_interactions` | AIConversation |
| `AIUsage` | `ai_usage` | User |

### Flutter Models (Pure Dart)

- No JSON serialization in models
- Mapping functions in `data/dto/mappers.dart`
- Immutable with `copyWith()` for updates

## API Design

### Conventions
- RESTful with plural nouns: `/api/wardrobe/items`
- JWT Bearer auth on all protected routes
- Standard error envelope: `{ error, message, statusCode }`
- Pagination: `?page=1&limit=20` → `{ data, total, page, limit }`

### Key Endpoints

| Domain | Endpoints |
|--------|-----------|
| Auth | `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh` |
| Wardrobe | `GET /wardrobe/items`, `POST /wardrobe/upload`, `POST /wardrobe/items` |
| AI | `POST /ai/analyze-clothing`, `POST /ai/generate-outfit`, `POST /ai/calculate-compatibility` |
| Stylist | `POST /stylist/chat`, `GET /stylist/chat/stream`, `POST /stylist/match-outfit` |
| Outfits | `GET /outfits`, `GET /outfits/today`, `POST /outfits/remix` |
| Planner | `GET /planner/weekly`, `POST /travel/packing-list` |
| Shop | `GET /shop/recommended`, `POST /shop/wishlist` |

## Security

- JWT tokens: 15min access, 7d refresh (httpOnly cookie)
- Password hashing: bcrypt (12 rounds)
- Rate limiting: per-IP + per-endpoint (auth: 5/min, AI: 20/min)
- CORS: explicit origins only, no wildcard with credentials
- Helmet.js for security headers
- Input validation: class-validator + DTOs

## Observability

- Structured logging (pino)
- Health endpoint: `GET /api/health`
- AI usage tracking: `ai_usage` table (endpoint, latency, tokens)
- Swagger UI at `/docs`

## Deployment

### Docker (Production)

```dockerfile
# Multi-stage build
FROM node:22-alpine AS backend-builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM python:3.11-slim AS ai-builder
WORKDIR /app
COPY ai-service/pyproject.toml ./
RUN pip install -e .

FROM node:22-alpine
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=ai-builder /app ./ai-service
EXPOSE 3002
CMD ["node", "dist/main.js"]
```

### Environment Variables

```env
# Backend
DATABASE_URL=postgresql://user:pass@db:5432/smartwardrobe
JWT_SECRET=your-secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
AI_ANALYZER=auto
PYTHON_AI_URL=http://localhost:8000
GEMINI_API_KEY=optional

# Flutter
API_BASE_URL=http://10.0.2.2:3002/api
```

## Future Considerations

- [ ] Replace in-memory rate limit with Redis
- [ ] Add WebSocket for real-time stylist updates
- [ ] Migrate from SQLite to PostgreSQL in all environments
- [ ] Contract tests between Python Pydantic ↔ NestJS DTOs
- [ ] Feature flags for gradual rollout