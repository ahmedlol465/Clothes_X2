# Phase 0 — Security Baseline

## Authentication Review

### JWT Implementation

**Location:** `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/jwt.strategy.ts`

| Aspect | Implementation | Status |
|--------|---------------|--------|
| Access token | JWT signed with `jwt.accessSecret` | ✅ Present |
| Refresh token | JWT signed with `jwt.refreshSecret` | ✅ Present |
| Token expiration | `JWT_ACCESS_TTL` (15m default), `JWT_REFRESH_TTL` (30d default) | ✅ Configured |
| Token versioning | `user.tokenVersion` bumped on refresh rotation | ✅ Present |
| Secret source | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` from env | ⚠️ Defaults hardcoded in `.env.example` |
| Secret in `.env` | `GEMINI_API_KEY` is visible in `.env` | ❌ Secret committed to working tree |

**Default secrets (`.env.example`):**
- `JWT_ACCESS_SECRET=smartwardrobe-dev-access-secret`
- `JWT_REFRESH_SECRET=smartwardrobe-dev-refresh-secret`

**Risk:** If `.env.example` is deployed to production without overriding, all JWT tokens can be forged.

### Password Handling

**Location:** `backend/src/modules/auth/auth.service.ts`

- Passwords hashed with bcrypt (`BCRYPT_ROUNDS=10` default)
- Legacy SHA-256 hashes detected and re-hashed with bcrypt on login (`/^[a-f0-9]{64}$/i` pattern)
- Demo user in `db.json` has a SHA-256 hash: `d82a1e9c7cd3f7aaeb971fe070d2b7d3c4bb2b377bc9b3e9d11756d21ebb055a`

**Risk:** SHA-256 is fast and vulnerable to brute-force. The migration path exists (re-hash on login) but users who don't log in keep weak hashes.

### Session Management

**Location:** `backend/src/database/entities/session.entity.ts`

- `Session` entity exists with `token`, `userId`, `createdAt`
- No expiration column — sessions never expire
- No `tokenVersion` or `refreshToken` column on Session entity
- `tokenVersion` is on the `User` entity instead

**Risk:** Stolen session tokens remain valid indefinitely.

## Authorization Review

### Role-Based Access Control

**Location:** `backend/src/common/guards/roles.guard.ts`, `backend/src/modules/admin/admin.controller.ts`

| Endpoint | `@Roles()` Decorator | Guards Apply | Risk |
|----------|---------------------|--------------|------|
| `/admin/dashboard` | None | RolesGuard (but `required` is empty → returns true) | 🔴 Any authenticated user is admin |
| `/admin/users` | None | Same as above | 🔴 User enumeration |
| `/admin/ai-performance` | None | Same as above | 🔴 AI usage data exposure |
| `/admin/reports` | None | Same as above | 🔴 Feedback data exposure |
| `/admin/system-health` | None | Same as above | 🔴 System info exposure |

**`RolesGuard.canActivate()` logic (roles.guard.ts:13-21):**
```typescript
if (!required || required.length === 0) return true;
```
When no `@Roles()` decorator is present, `required` is undefined, and the guard returns `true` — allowing any authenticated user.

**Confirmed:** Admin endpoints have no role enforcement. Any authenticated user can access `/admin/*`.

## CORS Review

**Location:** `backend/src/main.ts:40-45`

```typescript
const origins = config.get<string[]>('app.corsOrigins') ?? ['*'];
app.enableCors({
  origin: origins.includes('*') ? true : origins,
  credentials: true,
  exposedHeaders: ['X-Total-Count'],
});
```

**Default:** `CORS_ORIGINS=*` (from `.env.example`)

**Risk:** Combined with `credentials: true`, any origin can make authenticated requests. A malicious site could trick a logged-in user's browser into calling the backend with their JWT.

**Express runtime:** `server.js` uses `app.use(cors())` — also allows all origins by default.

## Rate Limiting

**Location:** None found.

**Evidence:** No rate limiter middleware in `backend/src/main.ts`, `backend/src/app.module.ts`, or `backend/server.js`. `@nestjs/throttler` is not in `package.json`.

**Endpoints without rate limiting:**
- `/auth/login` — brute-force vulnerable
- `/auth/register` — account enumeration / spam
- `/ai/chat`, `/ai/generate-outfit` — AI cost exhaustion
- `/ai/analyze-clothing` — compute abuse
- `/shop/wishlist` — write spam

**Confirmed:** No rate limiting exists on any endpoint.

## Input Validation

### NestJS DTOs (Partial Coverage)

| File | DTO | Validation |
|------|-----|------------|
| `outfits/dto/create-outfit.dto.ts` | CreateOutfitDto | `@IsString()`, `@IsArray()`, `@MinLength()` ✅ |
| `wardrobe/dto/create-wardrobe-item.dto.ts` | CreateWardrobeItemDto | `@IsString()`, `@IsOptional()`, `@IsIn()` ✅ |
| `wardrobe/dto/create-wardrobe-item.dto.ts` | QueryWardrobeDto | `@IsIn()` for category/sort ✅ |
| `auth/dto/auth.dto.ts` | (not reviewed in detail) | Unknown |

### Express Routes (No Validation)

**Location:** `backend/server.js`

All Express route handlers accept `req.body` directly with no schema validation. Example patterns:
- `body.itemIds?.length` — no check that `itemIds` is an array
- `body.name` — no length or content validation
- AI endpoint bodies: `Record<string, any>` — no validation at all

**Risk:** Malformed or malicious payloads can cause unexpected behavior, crashes, or injection attacks.

### NestJS ValidationPipe

**Location:** `backend/src/main.ts:29-36`

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  }),
);
```

**Gap:** Only applies to NestJS controllers with DTOs. Express routes bypass this entirely. NestJS modules for wardrobe, outfits, etc. are not registered, so their DTOs are not enforced.

## File Upload Validation

**Location:** `backend/src/common/storage/storage.ts`

```typescript
fileFilter: (_req, file, cb) => {
  if (/^image\//.test(file.mimetype || '')) return cb(null, true);
  cb(new Error('Only image files are allowed.'));
},
limits: { fileSize: 10 * 1024 * 1024, files: 10 },
```

**Gaps:**
1. Only checks mimetype — can be spoofed by client
2. No magic byte verification on upload (only on read via `sniffImageMime()`)
3. No virus/malware scanning
4. No image dimension validation
5. Filename is randomized with `crypto.randomBytes(6)` — good

**Express upload:** `server.js` uses `multer` with similar options (line 296: `/wardrobe/upload`).

**Confirmed:** File upload validation is weak — mimetype-only check, no content scanning.

## Secrets Management

| Secret | Location | Status |
|--------|----------|--------|
| `GEMINI_API_KEY` | `backend/.env` line 3 | ❌ Visible in working tree |
| `JWT_ACCESS_SECRET` | `backend/.env.example` line 34 | ⚠️ Default value committed |
| `JWT_REFRESH_SECRET` | `backend/.env.example` line 35 | ⚠️ Default value committed |
| `WEATHER_KEY` | `backend/.env` line 26 | Empty |
| `OPENWEATHERMAP_API_KEY` | `backend/.env.example` line 50 | Empty |
| `DB_PASSWORD` | `backend/.env` line 15 | Empty |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `backend/.env.example` | Not set |

**Confirmed:** `GEMINI_API_KEY` is visible in `.env` (working tree, not committed but present). Default JWT secrets are in `.env.example` (committed).

## Token Handling

**Flutter:** `lib/core/api/api_client.dart`
- Token held in memory (`_token` field)
- Not persisted to disk (no `shared_preferences` usage for token)
- Cleared on `logout()`
- Auto-attached as `Authorization: Bearer <token>`

**Backend (Express):** `server.js` — JWT verification inline, sessions stored in JSON
**Backend (NestJS):** `JwtStrategy.validate()` — checks `user.tokenVersion` against `payload.ver`

**Risk:** Token in memory only — lost on app restart. User must re-login. This is acceptable for a mobile app.

## SQL Injection

**TypeORM:** Uses parameterized queries — safe from SQL injection when using repository methods.

**LegacyDbService:** `writeSnapshot()` uses `queryRunner.query()` with `DELETE FROM ${tableName}` — table names are hardcoded, not user input. Safe.

**Express raw queries:** None found — all data access goes through `store.js`/`LegacyDbService`.

## Cross-Site Scripting (XSS)

**Risk:** User-generated content (outfit names, comments, profile names) is stored and returned in JSON responses. The Flutter app renders this content. No output encoding is applied at the API level.

**Mitigation:** Flutter widgets typically escape text by default. Risk is low but not zero.

## SSRF (Server-Side Request Forgery)

**Location:** `backend/src/modules/weather/weather.service.ts`

- `geocode()` calls `https://geocoding-api.open-meteo.com/v1/search` with user-provided city name
- `reverseGeocode()` calls `https://api.bigdatacloud.net/data/reverse-geocode-client` with coordinates
- `openWeatherMap()` calls OpenWeatherMap with user-provided city name

**Risk:** Low — URLs are constructed with hardcoded domains and query parameters. User input is URL-encoded. No arbitrary URL fetching.

## Path Traversal

**Location:** `backend/src/common/storage/storage.ts:42-58`

- `readStoredImage()` and `storagePathOf()` validate that resolved paths start with `STORAGE_DIR`
- `isOwnStorageUrl()` checks basename matches

**Evidence:** Path traversal protection exists (`file.startsWith(STORAGE_DIR)` checks).

## Command Injection

**Evidence:** No `exec()`, `spawn()`, or `eval()` calls found in backend source. Safe.

## Webhook Verification

**Evidence:** No webhooks implemented. No webhook signature verification needed.

## OAuth/Social Login

**Evidence:** `User.passwordHash` is nullable "so Google/Apple sign-in works" (identity.entity.ts:28 comment). No OAuth provider implementation found in backend or Flutter.

## Security Findings Summary

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| S-1 | Critical | No rate limiting on any endpoint | All routes |
| S-2 | Critical | Admin endpoints have no `@Roles()` enforcement | `admin.controller.ts` |
| S-3 | High | CORS `*` with `credentials: true` | `main.ts:40-45`, `server.js` |
| S-4 | High | Default JWT secrets in `.env.example` | `.env.example:34-35` |
| S-5 | High | `GEMINI_API_KEY` visible in `.env` | `.env:3` |
| S-6 | Medium | No input validation on Express routes | `server.js` |
| S-7 | Medium | File upload: mimetype-only check, no virus scan | `storage.ts:26-33` |
| S-8 | Medium | Sessions never expire (no expiration column) | `session.entity.ts` |
| S-9 | Low | Legacy SHA-256 password hashes in db.json | `db.json` |
| S-10 | Low | No output encoding for user-generated content | API responses |

## Unresolved Questions

1. Does the Flutter app store the JWT token persistently (shared_preferences)? — `api_client.dart` shows in-memory only, but `app_state.dart` may differ.
2. Are refresh tokens actually implemented in Express `server.js`? — Route exists at line 372 but implementation not fully reviewed.
3. Is there any IP-based blocking or brute-force detection? — No evidence found.
4. Are audit logs maintained for admin actions? — No evidence found.
