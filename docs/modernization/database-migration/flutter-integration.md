# Flutter Integration

Target: every screen reads application data from the backend API (TypeORM →
database). Static copy, design tokens and asset paths stay in Dart constants.

## 1. Mock data removal

- `lib/data/mock_data.dart` is deleted; `grep -rn "MockData\|mock_data" lib test`
  returns **0 matches** **[verified]**.
- Screens that used to read `MockData` now read `AppState` / controllers:
  home, splash, discover, Style DNA, outfit history, perfect match, style
  avatar, stylist, composer (`create_outfit_screen`), item details, wardrobe,
  outfits, planner, travel, shopping, profile.

## 2. Controllers (all API-backed)

| Controller | Responsibility | Endpoints |
|---|---|---|
| `AccountController` | auth, token, profile, avatar | `/auth/*`, `/users/me` |
| `WardrobeController` | CRUD, upload, real-photo staging | `/wardrobe/*` |
| `OutfitsController` | saved outfits, today, weather, compatibility, remix, feedback | `/outfits/*`, `/weather`, `/ai/*` |
| `PlannerController` | weekly plan, events, travel packing | `/planner/*`, `/events`, `/travel/*` |
| `ShopController` | recommendations, wishlist | `/shop/*` |
| `StylistController` | chat, SSE stream, match, Style DNA | `/ai/*` |
| `DiscoverController` (added) | trends + community looks | `GET /content/discover` |
| `InsightsController` (added) | Style DNA breakdown | `GET /insights/style-dna` |

`AppState` remains the composition root and forwards
`loadDiscover() / discoverContent / discoverLoading` and
`loadStyleDnaInsights() / styleDna / styleDnaLoading`.

`lib/data/dto/mappers.dart` maps every payload (`clothingItemFromJson`,
`outfitFromJson`, `styleDnaFromJson`, `discoverContentFromJson`, …) with
defensive defaults so a missing field renders an empty/neutral value rather than
throwing.

## 3. Defects found and fixed

### 3.1 Base URL missing the API prefix (all app calls 404)

The NestJS API is mounted under `API_PREFIX=api`
(`app.setGlobalPrefix('api')`) while `ApiConfig.baseUrl` returned
`http://localhost:3002`, so `GET /auth/login` hit `/auth/login` → **404**.
Verified directly: `POST http://127.0.0.1:3002/auth/login` → 404,
`POST http://127.0.0.1:3002/api/auth/login` → 200.

`ApiConfig.baseUrl` now appends `/api` (and tolerates an override that already
contains it). Android emulator, desktop/web and `--dart-define=API_BASE_URL`
all resolve to `<origin>/api`.

### 3.2 Response envelope not unwrapped (every field null)

The backend wraps payloads in `{success, data, meta?, timestamp}`
(`ResponseInterceptor`), but `ApiClient._send`/`uploadPhotos` returned the raw
body, so `login['accessToken']`, `items`, `outfits`… were all `null` and the
contract test failed with `type 'Null' is not a subtype of type 'String'`.

`ApiClient` now strips the envelope once, in `_unwrap()`, for both JSON and
multipart responses.

### 3.3 Cold-model analyse budget

`ApiConfig.analyzeTimeout` was 60 s; a cold ONNX model load was measured at
~65 s on this machine, so the first photo of a session was reported as a
timeout. Raised to 90 s (still below the backend's own hard ceiling, and the
gate verdict must not be lost).

### 3.4 Test harness (not product code)

- `backend_contract_test.dart`: default base is now `http://localhost:3002/api`,
  responses are unwrapped, user-scoped calls send the bearer token, the SSE
  stream authenticates, compatibility uses real DB item ids taken from the
  generated outfit, and the admin dashboard is asserted to be **refused** for a
  non-admin user instead of returning data.
- `non_clothing_gate_test.dart`: pins `TargetPlatform.linux` (widget tests
  default to `android`, which resolved `10.0.2.2` and timed out), seeds
  `SharedPreferences` mock values, and signs in as the demo user before driving
  `stagePhoto`; timeouts raised to cover cold-model analysis.

## 4. State handling

- **Loading**: each controller exposes `loading`; screens render a skeleton.
- **Empty**: empty payloads produce `X.empty` models and empty states (no demo
  values).
- **Offline**: `BackendStatus` flips `online=false` **only** for transport
  failures (`ApiException.status == null`).
- **Unauthorized**: 401/403 clear the session (`AccountController`) instead of
  being reported as "offline".
- **Validation errors**: 400/422 keep their status and message; the Add Clothes
  gate turns a 422 into `notClothingMessage`, never into heuristic tags.
- **No silent fallback**: `stagePhoto` rethrows a status-bearing
  `ApiException`; it no longer invents "heuristic" data when the server
  answered.

## 5. Verified

**[verified — live backend + Flutter tests]**

- `flutter analyze` → `No issues found!`
- `flutter test` → **69/69 passing**, including the two live-API suites:
  auth → wardrobe (12 items, categories contain `Tops`) → AI analyse/generate/
  compatibility/chat/conversations/remix/match/Style DNA/capabilities →
  outfits → planner (7 days) → travel packing → shop → admin refused for a
  regular user, plus the SSE stream (deltas reconstruct the reply, exclusion of
  a stored `avoid` garment respected), and the non-clothing gate (bottle/chair
  rejected with 422 + "clothing" in the message; a real garment staged as
  `clothing-vision`).

## 6. Not verified

- A device/simulator UI walkthrough of every screen was **not** performed
  (no screenshots, no interactive click-through); coverage is the widget tests
  plus API-level checks.
- Web/Chrome build against CORS was not exercised.
