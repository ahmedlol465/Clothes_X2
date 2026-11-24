# Source Inventory — Database Migration

Phase: **Database Migration Verification & Completion**
Repository: `clothes_x` (Flutter client + NestJS backend)
Date: 2026-11-24

## 1. Baseline inspected before any change

### Git state (working tree, uncommitted)

- Branch `main`, HEAD `f833fc9`.
- 74 tracked files modified, 14 tracked files deleted, ~90 untracked paths
  (new backend modules, entities, migration, seed files, docs, scripts).
- Nothing was reset, cleaned, checked out or committed during this phase.
- Deleted tracked files of interest: `lib/data/mock_data.dart`,
  `backend/server.js`, `backend/src/{store,llm,retrieval,scoring,style-memory,taxonomy,vision,weather}.js`,
  `backend/src/clothing-vision/*.js`.

### Backup

`/tmp/opencode/clothes_x_backup` exists and was **read only**, never modified:

| File | Size | Contents |
|---|---|---|
| `status.txt` | 8 782 B | Full `git status --porcelain` snapshot |
| `worktree.patch` | 3 429 382 B | Patch of every tracked modification |
| `untracked.tgz` | 199 939 B | All untracked files, incl. `common/legacy/legacy-db.service.ts`, `legacy.module.ts`, `store.ts`, docs |

Recovery path for any deleted source is the backup plus `git show HEAD:<path>`
(the original `mock_data.dart` was recovered this way into `/tmp` for
comparison; no working-tree file was restored over).

### Runtime

| Item | Value |
|---|---|
| System Node | v20.19.2 — **cannot** load `node:sqlite` (added in 22.5) |
| Node used for all verification | v22.20.0 (portable tarball unpacked in `/tmp`, project untouched) |
| `.nvmrc` / `engines` | `22` / `>=22.5` (already correct) |
| PostgreSQL / MySQL server | none installed locally |
| Docker | installed but the socket is not accessible to this user, no sudo used |
| SQLite CLI | absent; integrity checks run through Python's `sqlite3` module |
| Flutter | 3.41.3 stable at `/home/h/flutter-sdk` |

Decision: **use Node 22.5+ with the existing embedded SQLite database**. No
architecture change and no database server were required.

## 2. Data sources found

| Source | Location | Data types | Records (original) | Status |
|---|---|---|---|---|
| Flutter `MockData` | `lib/data/mock_data.dart` @ HEAD (deleted in tree) | wardrobe, outfits, planner week, shopping picks, trends, community looks, style DNA/insights, stylist copy, avatar pieces, packing list | 12 items, 6 outfits (4 saved + today + favourite), 7 plan days, 3 picks, 2 trends, 4 looks, 4 segments, 4 colours, 3 categories, 6 evolution points | **Removed from app flows** (file deleted, no imports left) |
| Volunteer demo content | `backend/src/database/demo-data.ts` | users/profile/style profile/style memory, wardrobe, outfits + items, feedback, events, weekly plan, products, trends, looks | 1 user, 1 profile, 1 style profile, 1 memory, 12 items, 6 outfits, 18 outfit items, 1 feedback, 2 events, 7 plan days, 3 products, 2 trends, 4 looks | **Migrated into the DB via seed** |
| Legacy JSON store | `backend/data/db.json` (deleted; seed code in `backend/src/store.js` @ HEAD) | users, sessions, wardrobe, outfits, wearEvents, feedback, styleMemory, conversations, events, weeklyPlan, wishlist, products | 1 user, 12 items, 4 outfits, 2 events, 7 plan days, 3 products, 1 memory row, 0 sessions/wear events/feedback/conversations/wishlist | **Migrated** (0-record collections have nothing to move) |
| Legacy DB service | `common/legacy/legacy-db.service.ts`, `legacy.module.ts` (deleted in tree, preserved in backup) | MySQL document blob | unknown provenance, no reachable MySQL | **Removed**; no consumer remained |
| Uploaded binaries | `backend/storage/*.jpg|png` | images | 6 pre-existing files | **Intentionally kept** as binary storage |
| Static UI copy | theme tokens, `assets.dart`, screen strings, icon paths | presentation | — | **Intentionally kept** in constants |

## 3. Source → database migration matrix

| Source | Data type | Target entity / table | Expected | DB actual | Status |
|---|---|---|---|---|---|
| `MockData.wardrobe` (12) | garments | `WardrobeItem` / `wardrobe_items` | 12 | 12 | ✅ verified in DB |
| `MockData.savedOutfits` (4) + `todaySelection` + `favoriteOutfit` | looks | `Outfit` / `outfits` | 6 | 6 | ✅ verified in DB |
| outfit↔garment links | relations | `OutfitItem` / `outfit_items` | 18 | 18 | ✅ verified in DB |
| `MockData.planWeek` (7) | planner days | `WeeklyPlan` / `weekly_plans` | 7 | 7 | ✅ verified in DB |
| `MockData.shoppingPicks` (3) | products | `ShoppingItem` / `shopping_items` | 3 | 3 | ✅ verified in DB |
| `MockData.trendingStyles` (2) | editorial | `TrendStyle` / `trend_styles` | 2 | 2 | ✅ verified in DB |
| `MockData.communityLooks` (4) | editorial | `CommunityLook` / `community_looks` | 4 | 4 | ✅ verified in DB |
| demo events (2) | calendar | `CalendarEvent` / `calendar_events` | 2 | 2 | ✅ verified in DB |
| demo user + credentials | account | `User` / `users` | 1 | 1 | ✅ login verified |
| user profile | profile | `UserProfile` / `user_profiles` | 1 | 1 | ✅ verified in DB |
| Style DNA dimensions/palette/category mix/evolution | personalisation | `StyleProfile` / `style_profiles` | 1 | 1 | ✅ verified in DB |
| legacy style memory (`avoid`, facts, ratios) | personalisation | `StyleProfile.dimensions.legacyStyleMemories` + `StyleMemory` row | 1 (nested) + 1 | 1 + 1 | ✅ verified in DB + read back by the stylist |
| demo feedback | feedback | `OutfitFeedback` / `outfit_feedback` | 1 | 1 | ✅ verified in DB |
| subscription row | billing | `Subscription` / `subscriptions` | 1 | 1 | ✅ verified in DB |

### Elements deliberately not turned into rows

| Element | Why | Where it lives now |
|---|---|---|
| `MockData.recentlyAdded`, `mostWorn`, `perfectMatchPieces`, `avatarTops/Bottoms` | presentation subsets/duplicates of the same 12 garments | derived by the API and mappers |
| `todaySelection` / `favoriteOutfit` as distinct rows | duplicate looks of seeded outfits; favourites are represented by `isFavorite` on the seeded rows | `outfits.isFavorite` |
| `packingGroups` | a generated artefact, not stored user data | `POST /travel/packing-list` |
| `wardrobeFilters`, `preferredStyles`, `profileColors`, `styleEvolution` labels | static UI vocabulary/labels | Dart constants and `common/vocabularies.ts` |
| `stylistIntro`, `stylistReplies`, `stylistFallback`, `matchBreakdown` labels | static copy / computed scores | Dart copy + AI engine |

No record from any source is left unaccounted for, and no source row was
replaced by a smaller dataset: the DB set (12/6/18/7/3/2/4/2 + profile data) is
a superset of the legacy JSON store and covers every record `MockData` held as
application data.

## 4. Remaining references (classified)

| Pattern | Matches | Classification |
|---|---|---|
| `MockData`, `mock_data` (application code) | 0 in `lib/`, `test/`, `backend/src` outside comments | not applicable — removed |
| `backend/src/database/demo-data.ts`, `seed.service.ts` comments | 2 | documentation of provenance, intentional |
| `README.md` / `backend/README.md` legacy runtime text | 0 | updated in this phase |
| `docs/adr/001` historical `server.js` text | 1 | historical decision record, marked superseded |
| `docs/modernization/phase-0…1d*` | many | historical phase reports, intentionally untouched |
| `backend/src/{store,retrieval,scoring,style-memory,taxonomy,vision,weather}.ts` | present | **active** AI engine modules imported by `common/legacy/legacy-modules.ts`, not mock data |
| `backend/storage/*` | 6 files | binary uploads, allowed by the target architecture |
| `assets/images/*` | ~65 | static binary design assets |
