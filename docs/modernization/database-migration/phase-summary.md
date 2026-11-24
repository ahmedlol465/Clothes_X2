# Database Migration — Phase Summary

Date: 2026-11-24
Status: **complete**, with the open items listed at the end.

## Objective achieved

- NestJS + TypeORM is the only backend runtime (`server.js` and the JSON store
  are gone from the working tree).
- The database is the single source of truth for application data; only binary
  uploads remain on disk (`backend/storage/`) and static UI copy stays in Dart.
- Flutter loads every screen's data from the API. `MockData` and
  `lib/data/mock_data.dart` are gone; there is no mock fallback anywhere.
- The demo dataset (12 garments, 6 outfits, 18 links, 7 planner days, 3
  products, 2 events, 2 trends, 4 looks, profile + Style DNA + style memory) is
  present in the database and reseeding is proven idempotent.

## Files created

Application code

- `backend/src/database/demo-data.ts` *(pre-existing, reviewed and used as the
  single demo dataset)*
- `lib/data/controllers/discover_controller.dart` *(completed)*
- `lib/data/controllers/insights_controller.dart` *(completed)*

Documentation (this phase)

- `docs/modernization/database-migration/source-inventory.md`
- `docs/modernization/database-migration/seed-implementation.md`
- `docs/modernization/database-migration/data-integrity-report.md`
- `docs/modernization/database-migration/flutter-integration.md`
- `docs/modernization/database-migration/final-verification.md`
- `docs/modernization/database-migration/phase-summary.md`

## Files modified

Backend

- `backend/src/database/seed.cli.ts` — duplicate `resolveMode()` removed
  (typecheck fix), created/skipped summary, demo login reminder
- `backend/src/modules/wardrobe/wardrobe.service.ts` — `brand` relation no
  longer receives free text (fixes FK 500 on create/import)
- `backend/src/modules/stylist/services/conversation.service.ts` — rewritten:
  real columns, thread continuity, real turns, cascade-safe clearing
- `backend/src/modules/stylist/services/context.service.ts` — `learnTurn`
  normalises/persists style memory correctly
- `backend/src/modules/stylist/services/streaming.service.ts`,
  `backend/src/modules/stylist/stylist.service.ts` — new `learnTurn` signature;
  422 payload gains a human message
- `backend/src/ai-engine.ts` — excluded garments can no longer become the
  outfit anchor
- `backend/src/common/filters/all-exceptions.filter.ts` — object error payloads
  fall back to their `error` string
- `backend/.env.example` — storage public base URL typo fixed

Flutter

- `lib/core/api/api_config.dart` — base URL includes `/api`; analyse budget 90 s
- `lib/core/api/api_client.dart` — response envelope unwrapped once
- `lib/features/{outfits/perfect_match_screen.dart, stylist/widgets/outfit_suggestion.dart, wardrobe/analyzing_screen.dart}` — unused `super.key` on private constructors removed
- `lib/features/wardrobe/widgets/{preview_grid,status_line,tag_grid}.dart` —
  unused imports removed

Tests

- `test/backend_contract_test.dart` — `/api` base, envelope unwrap, auth on
  user-scoped calls, authenticated SSE, real item ids, admin-refused assertion
- `test/non_clothing_gate_test.dart` — desktop platform pin, prefs mock, demo
  sign-in, cold-model timeouts

Docs

- `README.md`, `backend/README.md` — legacy Express/mock-fallback text replaced
  with the database-backed reality and the seeded demo login
- `docs/adr/001-nestjs-canonical-backend.md` — marked superseded in part

## Deleted / removed

No files were deleted in this phase. The legacy deletions present in the
working tree before this phase (`backend/server.js`, `backend/src/*.js`,
`backend/src/common/legacy/legacy.module.ts`, `legacy-db.service.ts`,
`lib/data/mock_data.dart`) were verified to have no remaining consumers; their
content is preserved in `/tmp/opencode/clothes_x_backup/untracked.tgz` and in
Git history.

`LegacyDbService` / `LegacyModule` were confirmed unused: no import remains in
`backend/src`. The **active** AI engine modules (`ai-engine.ts`, `scoring.ts`,
`retrieval.ts`, `style-memory.ts`, `taxonomy.ts`, `vision.ts`, `weather.ts`,
`llm.ts`, `clothing-vision/*.ts`) are still imported by
`common/legacy/legacy-modules.ts` and were intentionally kept.

## Recovered files

None were needed. The original `lib/data/mock_data.dart` was read from
`git show HEAD:lib/data/mock_data.dart` (into `/tmp`, never over the working
tree) purely to build the source inventory and compare record counts.

## Database verification evidence

- Tables: 34, including `users`, `wardrobe_items`, `outfits`, `outfit_items`,
  `weekly_plans`, `shopping_items`, `trend_styles`, `community_looks`,
  `calendar_events`, `style_profiles`, `style_memories`.
- Counts stable across two seed runs: 1 / 12 / 6 / 18 / 7 / 3 / 2 / 4 / 2 / 1 / 1.
- `PRAGMA integrity_check` → `ok`; `PRAGMA foreign_key_check` → `[]`.
- Zero orphan outfit items, outfits, wardrobe items or weekly-plan references.
- Demo login `karim@fashiontech.com` / `wardrobe2024` works; JWT-protected
  endpoints answer with data and 401 without a token.
- Style DNA and the legacy style memories are stored and read back by the
  stylist (the exclusion "never wears sneakers" is honoured in generated
  outfits).

## Commands executed (representative)

```bash
git status --short ; git log --oneline -5 ; git show HEAD:lib/data/mock_data.dart
git show HEAD:backend/src/store.js
node --version ; npm --version ; docker info ; which flutter
curl -fsSL -o node22.tar.xz https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz
cd backend && npm run typecheck && npm test && npm run test:e2e && npm run build
DB_TYPE=sqlite npm run seed        # run twice
DB_TYPE=sqlite PORT=3002 node dist/main.js
curl ... /api/health /api/auth/login /api/content/discover /api/insights/style-dna
curl ... /api/wardrobe/items /api/outfits /api/events /api/planner/weekly /api/shop/recommended
curl ... POST /api/wardrobe/items /api/ai/chat /api/ai/chat/stream /api/ai/analyze-clothing
python3 -m sqlite3 checks (integrity_check, foreign_key_check, orphan probes)
cd .. && flutter analyze && flutter test
```

## Remaining risks

1. All database evidence is SQLite; **PostgreSQL/MySQL was not executed** (no
   server reachable, no sudo). Production should set `DB_SYNCHRONIZE=false` and
   use a real migration instead of the current no-op `1-initial-schema.ts`.
2. User isolation is enforced in repository queries but was **not** proven with
   a second live account.
3. Upload mimetypes outside the image allow-list produce a 500 instead of a
   400/415 (`fileFilter` throws a plain `Error`).
4. The weekly plan is a global, non-user-scoped table (mirrors the legacy
   design); multi-user plans would need a `userId`.
5. The Flutter contract test leaves one archived item and one conversation per
   live run unless cleaned up.
6. No visual/device walkthrough was done; UI confidence comes from 69 passing
   Flutter tests and API-level assertions.

## Safety compliance

- No commit, reset, clean, checkout or stash was performed.
- The backup at `/tmp/opencode/clothes_x_backup` was read only.
- No line-ending or repository-wide formatting was run.
- Seeding never truncates, updates or deletes rows; it only inserts missing
  deterministic ids, and boot seeding is skipped whenever users exist.
- Demo credentials and relationships are unchanged.
- The database was left with exactly its original demo dataset (12 items, 6
  outfits, 0 stray conversations) after smoke-test clean-up.
