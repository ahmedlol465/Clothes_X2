# Phase 0 — Performance Baseline

## Measurement Context

Performance measurements were limited in Phase 0 because:
- No database server is running (MySQL/PostgreSQL unavailable)
- Express server was not started (would require network access for weather/LLM)
- Flutter SDK is not available for client-side measurements
- No APM or profiling tools are configured

All findings below are based on **code inspection** and **test execution observations**, not production benchmarks.

## Known Bottlenecks (Code-Level Evidence)

### PB-1: LegacyDbService Full-Snapshot Write (Critical)

**Location:** `backend/src/common/legacy/legacy-db.service.ts`, lines 497-796 (`writeSnapshot()`)

**Behavior:** Every write operation (user registration, login, wardrobe item creation, outfit feedback, chat message, etc.) triggers:
1. `DELETE` all rows from ALL 26 tables
2. Re-INSERT all data from the in-memory `LegacyDb` document
3. All inside a single TypeORM transaction

**Impact:** O(n) write amplification where n = total data size across all tables. As the database grows, every single mutation becomes progressively slower. Write latency grows linearly with total stored data.

**Measurement:** Cannot be measured without a running database. Marked as **unknown** but structurally severe.

**Write path confirmation:** `legacy-db.service.ts` implements `OnModuleInit` and hydrates from MySQL at boot. All controllers that inject `LegacyDbService` write through `persist()` which calls `writeSnapshot()`.

### PB-2: No Database Indexes on Frequently Queried Columns

**Location:** `backend/src/database/entities/*.ts`

**Evidence:** Entity files define `@Index()` on some columns (e.g., `WardrobeItem` has `@Index(['wardrobeId', 'status'])`), but many foreign keys and query columns lack indexes:
- `User.email` has `@Index({unique: true})` ✅
- `WardrobeItem.wardrobeId` has `@Index()` ✅
- `WardrobeItem.wardrobeId + status` composite index ✅
- `Outfit.userId` has `@Index()` ✅
- `Outfit.userId + status` composite index ✅
- `AIConversation.userId` has `@Index()` ✅
- `AIInteraction.conversationId` has `@Index()` ✅
- `WishlistItem.userId + productUrl` unique index ✅

However, the LegacyDbService bypasses TypeORM queries entirely for reads — it reads from the in-memory document. Indexes only matter if NestJS repository queries are used directly (which `OutfitsService`, `PlannerService`, `ShopService`, `UsersService`, `AdminService` do).

**Impact:** As NestJS services increasingly use TypeORM repositories directly, missing indexes will cause full table scans on user-scoped queries.

### PB-3: Synchronous File I/O in Hot Paths

**Location:** `backend/src/common/storage/storage.ts`

| Method | Line | Operation |
|--------|------|-----------|
| `readStoredImage()` | 42-48 | `fs.readFileSync()` — blocks event loop |
| `storagePathOf()` | 51-59 | `fs.existsSync()` — blocks event loop |
| Module load | 15 | `fs.mkdirSync()` — blocks at startup |

**Impact:** `readStoredImage()` is called when serving wardrobe photos. Under concurrent load, synchronous file reads block the Node.js event loop, causing request queuing.

### PB-4: Image Loading Into Memory

**Location:** `backend/src/modules/stylist/stylist.service.ts` (image analysis path)

**Evidence:** `Buffer.from(base64, 'base64')` decodes entire image into memory. `aiEngine.analyzeClothing()` receives full `bytes` buffer.

**Impact:** Large images (5MB+) consume significant RAM. Multiple concurrent uploads could cause OOM.

### PB-5: No AI Response Caching

**Location:** `backend/src/modules/stylist/stylist.service.ts`, `outfits.service.ts`

**Evidence:** `aiEngine.generateOutfits()`, `aiEngine.calculateCompatibility()`, `aiEngine.chatReply()` are called on every request with no cache layer check.

**Impact:** Repeated identical requests (same wardrobe, same occasion) recompute from scratch. Wastes LLM tokens and CPU.

### PB-6: No Request Deduplication

**Location:** `lib/core/api/api_client.dart`

**Evidence:** Every API call makes a fresh HTTP request. No caching of wardrobe lists, weather, or outfit recommendations.

**Impact:** Repeated API calls for the same data. Slow initial load on poor connections.

## Measured Results (From Test Execution)

### Weather Service Tests

| Test Observation | Value |
|-----------------|-------|
| Test suite execution time | ~17.5s |
| Open-Meteo fetch failures (expected in sandbox) | All external calls failed gracefully |
| Fallback to seasonal estimate | Works correctly |

### AI Service Tests

| Test Observation | Value |
|-----------------|-------|
| Test suite execution time | ~18.0s |
| ECONNREFUSED (no Python AI service running) | Handled gracefully |
| Timeout after 20000ms | Handled gracefully |
| Malformed payload handling | Handled gracefully |

### Overall Test Suite

| Metric | Value |
|--------|-------|
| Total time | 21.149s |
| Tests | 40 passed |
| Suites | 2 passed |

## Performance Baselines (Marked Unknown)

| Metric | Status | Reason |
|--------|--------|--------|
| API response time (CRUD) | Unknown | Express server not started |
| API response time (AI) | Unknown | No LLM key configured, no Python service |
| Database query time | Unknown | No database server running |
| LegacyDbSnapshot write time | Unknown | No MySQL running |
| Image upload processing time | Unknown | Not measured |
| Memory usage under load | Unknown | Not measured |
| Concurrent request handling | Unknown | Not measured |

## Performance Monitoring

**Existing:** None. No APM, no request timing middleware, no slow query logging.

**Available:** `DB_LOGGING=false` in `.env` — TypeORM SQL logging is disabled. Could be enabled for query analysis.

## Recommended Next Steps for Performance Measurement

1. Start Express server and measure representative endpoint response times
2. Enable `DB_LOGGING=true` temporarily to observe query patterns
3. Measure `writeSnapshot()` duration with increasing data volumes
4. Profile image upload and analysis pipeline
5. Measure Flutter app cold start and API call latency
