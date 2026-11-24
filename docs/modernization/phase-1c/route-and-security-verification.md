# Phase 1C — Route and Security Verification

## Registered Controllers and Routes

All routes are under the global NestJS prefix (configured in `main.ts`). Each controller has `@ApiBearerAuth()` and uses `@CurrentUser('id')` for user-scoped access.

| Controller | Prefix | Auth | Routes |
|------------|--------|------|--------|
| HealthController | `/` | None | GET /health |
| AuthController | `/auth` | Optional (Public on register/login/refresh) | POST /register, /login, /refresh, POST /logout, GET /me |
| AiController | `/ai` | Optional | POST /analyze-clothing, /generate-outfit, /calculate-compatibility, /style-profile, /wardrobe-gap, /packing-list, /chat, /chat/stream, /match-outfit, /remix, GET /style-dna, /conversations, /capabilities, DELETE /conversations |
| WeatherController | `/weather` | None | GET /current |
| WardrobeController | `/wardrobe` | Bearer + CurrentUser | POST /upload, GET /items, POST /items, POST /items/batch-upload, GET /collections, GET /items/:id, PATCH /items/:id, DELETE /items/:id |
| UsersController | `/users` | Bearer + CurrentUser | GET /me, PATCH /me, POST /me/avatar, GET /me/style-profile, PATCH /me/style-profile |
| OutfitsController | `/outfits` | Bearer + CurrentUser | GET /recommended, GET, POST, GET /:id, PATCH /:id, DELETE /:id, POST /:id/favorite, POST /:id/feedback |
| ShopController | `/shop` | Bearer + CurrentUser | GET /recommended, POST /before-you-buy, GET /wishlist, POST /wishlist |
| AdminController | `/admin` | Bearer + Roles(ADMIN) | GET /dashboard, /users, /ai-performance, /reports, /system-health |

## Route Conflicts

**No conflicts among registered modules.** All controller prefixes are unique:
- `/auth`, `/ai`, `/weather`, `/wardrobe`, `/users`, `/outfits`, `/shop`, `/admin`

**Blocked conflict:** StylistController also uses `@Controller('ai')` — identical to AiController. StylistModule cannot be registered until this is resolved.

## Security Verification

### Authentication (JWT Auth Guard — Global)
- `JwtAuthGuard` is registered as `APP_GUARD` — applies to all controllers
- `@Public()` decorator exempts specific routes (AuthController register/login/refresh)
- All registered wardrobe/users/outfits/shop/admin controllers use `@ApiBearerAuth()`
- All methods use `@CurrentUser('id')` to extract the authenticated user ID

### Authorization (Roles Guard — Global)
- `RolesGuard` is registered as `APP_GUARD`
- AdminController has `@Roles(UserRole.ADMIN)` on all 5 methods
- Non-admin users receive 403 on `/admin/*` endpoints (verified in Phase 1A)
- Other controllers have no role restrictions (any authenticated user can access their own data)

### User Data Isolation
- All user-scoped endpoints use `@CurrentUser('id')` which comes from the JWT payload
- Services filter queries by `userId` (e.g., `where: { userId }`, `where: { id, userId }`)
- OutfitsService `userItems()` validates that requested item IDs belong to the user's wardrobe
- No controller accepts a userId from the request body — all come from the authenticated token

### Admin Security
- AdminController has `@UseGuards(RolesGuard)` at class level
- All 5 methods have `@Roles(UserRole.ADMIN)`
- `RolesGuard.canActivate()` returns `true` only when user has all required roles
- Non-admin authenticated users receive 403

### CORS
- NestJS: Restricted origins (localhost dev ports by default, `CORS_ORIGINS` env var for production)
- Never combines wildcard origins with credentials
- Express: Same restriction applied in Phase 1A

### Rate Limiting
- NestJS: In-memory per-IP + per-endpoint rate limiter (applied in Phase 1A)
- Stricter limits on `/auth/login` (5/min), `/auth/register` (3/min), `/ai/` (20/min)

## Unverified Endpoints

The following endpoints exist in registered modules but were NOT functionally tested (no database with test data, no authenticated client):

| Controller | Endpoint | Unverified Reason |
|------------|----------|-------------------|
| WardrobeController | All | Requires authenticated user + wardrobe data |
| UsersController | All | Requires authenticated user + user data |
| OutfitsController | All | Requires authenticated user + wardrobe items |
| ShopController | All | Requires authenticated user + wardrobe data |
| AdminController | All | Requires admin role user |

## Blocked Modules — Route Impact

### StylistModule (Blocked)
If registered with current `@Controller('ai')`, would create duplicate routes with AiController:
- `/ai/analyze-clothing`, `/ai/generate-outfit`, `/ai/calculate-compatibility`
- `/ai/style-profile`, `/ai/wardrobe-gap`, `/ai/packing-list`
- `/ai/chat`, `/ai/chat/stream`, `/ai/match-outfit`
- `/ai/remix`, `/ai/style-dna`, `/ai/conversations`, `/ai/capabilities`

### PlannerModule (Blocked)
If registered (after StylistModule is unblocked), would add routes at root level:
- `/events`, `/planner/weekly`, `/travel/packing-list`
- No prefix conflicts with registered modules

## Express Backend

- `backend/server.js` — NOT modified
- Express continues to serve on port 3001/3002
- Flutter client continues to connect to Express
- No route or behavior changes
