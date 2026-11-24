# Phase 0 — API Contract Baseline

## Flutter API Configuration

**File:** `lib/core/api/api_config.dart`

| Setting | Value |
|---------|-------|
| Base URL (Android) | `http://10.0.2.2:3001` (Express) |
| Base URL (iOS/Desktop/Web) | `http://localhost:3002` (Express) |
| Override | `--dart-define=API_BASE_URL=http://<lan-ip>:3001` |
| Ordinary request timeout | 8 seconds |
| AI request timeout | 45 seconds |
| Analyze timeout | 60 seconds |
| Upload timeout | 60 seconds |

**Key finding:** The Flutter app **only** talks to the Express backend. The NestJS server on port 3000 is not reachable from the Flutter client.

**File:** `lib/core/api/api_client.dart`

The `ApiClient` class:
- Uses `package:http` (works on all Flutter targets)
- Holds JWT token in memory (`_token` field)
- Auto-attaches `Authorization: Bearer <token>` header when token present
- Throws `ApiException` on HTTP errors (status >= 400) or network failures
- Falls back to bundled mock data when backend is unreachable
- Supports SSE streaming via `streamPost()` for `/ai/chat/stream`
- Supports multipart uploads via `uploadPhotos()`

**File:** `lib/core/api/smartwardrobe_api.dart`

Typed wrapper with methods grouped by section (8.1 Auth through 8.7 Shopping + misc weather/ping).

## Complete API Contract Map

### 8.1 — Auth

| Method | Path | Auth | Request Body | Response | Served By |
|--------|------|------|--------------|----------|-----------|
| POST | `/auth/register` | No | `{name, email, password}` | `{accessToken, ...}` | Express |
| POST | `/auth/login` | No | `{email, password}` | `{accessToken, ...}` | Express |
| POST | `/auth/refresh` | No | (none documented) | — | Express |
| POST | `/auth/logout` | Yes (Bearer) | — | — | Express |

NestJS: `AuthModule` is registered but only `/auth` routes from Express serve Flutter.

### 8.2 — Users

| Method | Path | Auth | Request Body | Response | Served By |
|--------|------|------|--------------|----------|-----------|
| GET | `/users/me` | Yes | — | `{user: {...}}` | Express |
| PATCH | `/users/me` | Yes | `{name?, avatarUrl?}` | `{user: {...}}` | Express |
| POST | `/users/me/avatar` | Yes | multipart `photo` | `{user: {...}}` | Express |
| GET | `/users/me/style-profile` | Yes | — | `{styleProfile: {...}}` | Express |
| PATCH | `/users/me/style-profile` | Yes | `{favoriteColors?, preferredStyles?, ...}` | `{styleProfile: {...}, user: {...}}` | Express |

NestJS: `UsersModule` exists but is NOT registered in `AppModule`.

### 8.3 — Wardrobe

| Method | Path | Auth | Request Body | Response | Served By |
|--------|------|------|--------------|----------|-----------|
| GET | `/wardrobe/items` | Optional | query: `{search, category, sort}` | `{items, total}` | Express |
| POST | `/wardrobe/items` | Optional | `{name, category, color, ...}` | `{item}` | Express |
| GET | `/wardrobe/items/:id` | Optional | — | `{item}` | Express |
| PATCH | `/wardrobe/items/:id` | Optional | `{...}` | `{item}` | Express |
| DELETE | `/wardrobe/items/:id` | Optional | — | `{ok: true}` | Express |
| POST | `/wardrobe/items/batch-upload` | Optional | multipart files | `{files: [...]}` | Express |
| POST | `/wardrobe/upload` | Optional | multipart `photos` | `{files: [...]}` | Express |
| GET | `/wardrobe/collections` | Optional | — | `{collections}` | Express |

NestJS: `WardrobeModule` exists but is NOT registered in `AppModule`.

### 8.4 — AI

| Method | Path | Auth | Request Body | Response | Served By |
|--------|------|------|--------------|----------|-----------|
| POST | `/ai/analyze-clothing` | Optional | `{filename, name, category, color, ...}` or multipart image | `{category, color, style, pattern, material, season, formality, confidence}` | Express |
| POST | `/ai/generate-outfit` | Optional | `{occasion, weather, count, anchorItemId?}` | `{outfits: [...]}` | Express |
| POST | `/ai/calculate-compatibility` | Optional | `{itemIds, occasion, weather}` | `{match, breakdown}` | Express |
| POST | `/ai/style-profile` | Optional | `{...}` | `{styleProfile}` | Express |
| POST | `/ai/wardrobe-gap` | Optional | — | `{gaps: [...]}` | Express |
| POST | `/ai/packing-list` | Optional | `{destination, days}` | `{packingList}` | Express |
| POST | `/ai/chat` | Optional | `{message, history?, conversationId?}` | `{reply, outfit, weather, memory, source}` | Express |
| POST | `/ai/chat/stream` | Optional | `{message, history?, conversationId?}` | SSE events (delta/notice/error/done) | Express |
| POST | `/ai/match-outfit` | Optional | `{filename, dataUrl?, note?}` | `{matches, itemIds, gaps}` | Express |
| POST | `/ai/remix` | Optional | `{itemIds, variant, weather?}` | `{outfit}` | Express |
| GET | `/ai/style-dna` | Optional | — | `{styleDna}` | Express |
| GET | `/ai/conversations` | Optional | query: `{limit}` | `{turns: [...]}` | Express |
| DELETE | `/ai/conversations` | Optional | — | `{ok: true}` | Express |
| GET | `/ai/capabilities` | Optional | — | `{capabilities}` | Express |

NestJS: `AiModule` IS registered but only serves `/ai-analysis/*` routes (renamed from `/ai` to avoid conflict). Flutter does NOT call NestJS AI routes.

### 8.5 — Outfits

| Method | Path | Auth | Request Body | Response | Served By |
|--------|------|------|--------------|----------|-----------|
| GET | `/outfits/recommended` | Optional | query: `{occasion, tempC, count}` | `{outfits: [], weather, occasion}` | Express |
| GET | `/outfits` | Optional | query: `{favorite?}` | `{outfits: [], total}` | Express |
| POST | `/outfits` | Optional | `{name, itemIds, occasion?}` | `{outfit: {...}}` | Express |
| GET | `/outfits/:id` | Optional | — | `{outfit}` | Express |
| PATCH | `/outfits/:id` | Optional | `{...}` | `{outfit}` | Express |
| DELETE | `/outfits/:id` | Optional | — | `{ok: true}` | Express |
| POST | `/outfits/:id/favorite` | Optional | — | `{outfit}` | Express |
| POST | `/outfits/:id/feedback` | Optional | `{rating, comment}` | `{ok, learned: {...}}` | Express |

NestJS: `OutfitsModule` exists but is NOT registered in `AppModule`.

### 8.6 — Planner

| Method | Path | Auth | Request Body | Response | Served By |
|--------|------|------|--------------|----------|-----------|
| GET | `/events` | Optional | — | `{events: [...]}` | Express |
| POST | `/events` | Optional | `{outfitId, ...eventData}` | `{event}` | Express |
| PATCH | `/events/:id` | Optional | `{...}` | `{event}` | Express |
| DELETE | `/events/:id` | Optional | — | `{ok: true}` | Express |
| GET | `/planner/weekly` | Optional | — | `{week: [...]}` | Express |
| POST | `/planner/weekly` | Optional | `{occasion}` | `{week: [...]}` | Express |
| POST | `/travel/packing-list` | Optional | `{destination, days}` | `{packingList}` | Express |

NestJS: `PlannerModule` exists but is NOT registered in `AppModule`.

### 8.7 — Shopping

| Method | Path | Auth | Request Body | Response | Served By |
|--------|------|------|--------------|----------|-----------|
| GET | `/shop/recommended` | Optional | — | `{picks, gaps}` | Express |
| POST | `/shop/before-you-buy` | Optional | `{productName, color, category}` | `{verdict, bestMatch}` | Express |
| GET | `/shop/wishlist` | Optional | — | `{wishlist: [...]}` | Express |
| POST | `/shop/wishlist` | Optional | `{...}` | `{entry}` | Express |

NestJS: `ShopModule` exists but is NOT registered in `AppModule`.

### 8.8 — Admin

| Method | Path | Auth | Request Body | Response | Served By |
|--------|------|------|--------------|----------|-----------|
| GET | `/admin/dashboard` | No role check | — | `{users, wardrobeItems, outfits, events, feedbackCount, aiCalls}` | Express |
| GET | `/admin/users` | No role check | — | `{users: [...]}` | Express |
| GET | `/admin/ai-performance` | No role check | — | `{totalCalls, avgLatencyMs, byEndpoint, tokens, llm}` | Express |
| GET | `/admin/reports` | No role check | — | `{feedback: [...]}` | Express |
| GET | `/admin/system-health` | No role check | — | `{status, uptimeSec, database, llm, embeddings, weather, modules, runtime}` | Express |

NestJS: `AdminModule` exists but is NOT registered in `AppModule`. No `@Roles(UserRole.ADMIN)` guard on any admin endpoint.

### Misc

| Method | Path | Auth | Response | Served By |
|--------|------|------|----------|-----------|
| GET | `/weather/current` | No | `{weather: {...}}` | Express (NestJS WeatherModule also registered) |
| GET | `/health` | No | `{status: 'ok', service: 'smartwardrobe-backend'}` | Express (NestJS HealthController also registered) |
| GET | `/docs` | No | Endpoint index JSON | Express |

## Response Envelope Patterns

### Express (current, what Flutter receives)

Success responses vary by endpoint — no consistent envelope:
- `{ user: {...} }` — users
- `{ items: [...], total: N }` — wardrobe lists
- `{ outfits: [...], total: N }` — outfit lists
- `{ outfit: {...} }` — single outfit
- `{ events: [...] }` — planner events
- `{ week: [...] }` — weekly plan
- `{ picks: [...], gaps: [...] }` — shop recommendations
- `{ status: 'ok' }` — health

Error responses:
- `{ error: "message" }` with HTTP status >= 400
- `ApiException` thrown on client side

### NestJS (target, not yet used by Flutter)

All responses wrapped by `ResponseInterceptor`:
```json
{
  "success": true,
  "data": { ... },
  "meta": { ... },
  "timestamp": "ISO string"
}
```
Errors wrapped by `AllExceptionsFilter`:
```json
{
  "statusCode": 400,
  "error": "human readable message",
  "message": "human readable message",
  "path": "/url",
  "timestamp": "ISO string"
}
```

## Authentication Contract

- Token stored in Flutter `ApiClient._token` (in memory only, not persisted)
- Token set on `register()` and `login()` responses via `res['accessToken']`
- Token cleared on `logout()`
- All protected endpoints expect `Authorization: Bearer <token>`
- Express `optionalAuth` middleware allows unauthenticated access to most endpoints
- NestJS `JwtAuthGuard` is global APP_GUARD; `@Public()` decorator exempts routes
- No refresh token rotation visible in Flutter contract — `logout()` just clears local token

## Data Isolation

All user-owned endpoints in Express filter by `userId` derived from the session/token:
- Wardrobe items: filtered by `wardrobe.userId`
- Outfits: filtered by `outfit.userId`
- Events: filtered by `event.userId`
- Wishlist: filtered by `wishlist.userId`

No cross-user data access guard visible in NestJS controllers (modules not registered).

## Backward Compatibility Requirements

Any NestJS replacement must:
1. Serve the same 58 Express routes at the same paths (no `/api` prefix for Flutter — Express routes are at root)
2. Return the same JSON shapes (Express envelope patterns, not NestJS `success/data/meta` envelope)
3. Accept the same request body shapes
4. Support optional auth on the same endpoints
5. Support multipart file uploads with the same field names (`photo`, `photos`)
6. Support SSE streaming on `/ai/chat/stream`
7. Return `ApiException`-compatible error shapes (`{error: "message"}`)
