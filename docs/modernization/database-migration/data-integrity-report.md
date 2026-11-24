# Data Integrity Report

Database: `backend/data/smartwardrobe.sqlite` (embedded SQLite via the
`node:sqlite` shim, driver reported as `better-sqlite3`).
Runtime: Node v22.20.0. Date: 2026-11-24.

Legend for every claim below:

- **[DB]** verified against the real database with SQL/API calls
- **[STATIC]** verified by reading code only
- **[NOT VERIFIED]** not exercised here, with the reason

## 1. Record counts

Counts before any seed run in this phase, after seed run #1, and after seed run
#2 — all identical **[DB]**:

| Table | Before | After run 1 | After run 2 | Expected |
|---|---|---|---|---|
| `users` | 1 | 1 | 1 | 1 |
| `user_profiles` | 1 | 1 | 1 | 1 |
| `style_profiles` | 1 | 1 | 1 | 1 |
| `style_memories` | 1 | 1 | 1 | 1 |
| `subscriptions` | 1 | 1 | 1 | 1 |
| `wardrobes` | 1 | 1 | 1 | 1 |
| `wardrobe_items` | 12 | 12 | 12 | 12 |
| `outfits` | 6 | 6 | 6 | 6 |
| `outfit_items` | 18 | 18 | 18 | 18 |
| `outfit_feedback` | 1 | 1 | 1 | 1 |
| `calendar_events` | 2 | 2 | 2 | 2 |
| `weekly_plans` | 7 | 7 | 7 | 7 |
| `shopping_items` | 3 | 3 | 3 | 3 |
| `trend_styles` | 2 | 2 | 2 | 2 |
| `community_looks` | 4 | 4 | 4 | 4 |

Seed output for both runs: `Seeded 0 new row(s), skipped 55 existing row(s)` —
**idempotency proven on the real DB** **[DB]**.

## 2. Structural integrity

```
PRAGMA integrity_check   -> ok                        [DB]
PRAGMA foreign_key_check -> []  (no violations)       [DB]
```

Relationship probes, all zero rows **[DB]**:

| Probe | Result |
|---|---|
| `outfit_items` whose `itemId` has no `wardrobe_items` row | 0 |
| `outfits` whose `userId` has no `users` row | 0 |
| `wardrobe_items` whose `wardrobeId` has no `wardrobes` row | 0 |
| `outfits` with no `outfit_items` | 0 |
| `weekly_plans.outfitId` pointing at a missing outfit | 0 |

Every seeded outfit therefore references valid wardrobe items, and every
weekly-plan day that names an outfit references a seeded one.

## 3. Ownership isolation

- All six seeded outfits carry `userId = 00000000-0000-4000-8000-000000000001`
  (the demo user) **[DB]**.
- All 12 wardrobe items hang off the demo user's single wardrobe row **[DB]**.
- `GET /insights/style-dna`, `/wardrobe/items`, `/outfits`, `/planner/weekly`,
  `/shop/recommended` all answered with data for the authenticated demo user,
  and an unauthenticated request to `/insights/style-dna` returned **401**
  **[DB]** — user-scoped reads are guarded and filtered by `userId` in the
  repositories (`[STATIC]`: each service queries `where: { userId }` or by
  `wardrobeId` owned by that user).
- Two-account isolation was **not** exercised with a freshly registered account
  **[NOT VERIFIED]** — the repository queries filter by `userId`, but a second
  live account was not created to prove it end to end.

## 4. Important field values

| Check | Evidence |
|---|---|
| Demo credentials work | `POST /api/auth/login` → 200, token issued, user `karim@fashiontech.com` **[DB]** |
| Wardrobe field fidelity | `101 Oxford Cotton Shirt / Tops / White / timesWorn 19`, `102 Raw Denim Jeans / Bottoms / Indigo / 12`, `103 Beige Knit Sweater / Tops / Beige / 14` — identical to `DEMO_WARDROBE` and to the original mock/JSON rows **[DB]** |
| Outfit scores | `201 University Casual 92`, `202 Formal Dinner 89`, `203 Weekend Chillout 95`, `204 Date Night Elite 88`, `205 Weekend Brunch 90`, `206 Smart Meeting 93` **[DB]** |
| Planner week | `Mon 25 University Lectures / Classic Oxford Style`, …, `Wed 27 … isToday=1`, `Sun 1 Rest Day / Lounge Comfort` **[DB]** |
| Style DNA | `archetype = Classic Minimalist`, `minimalism 0.82`, `streetwear 0.24`, `formalityBias 0.61`, `overallConfidence 0.88` **[DB]** |
| Style DNA palette | `Black #1E1C1A 38`, `White #FFFFFF 31`, `Blue #3D5A80 22`, `Beige #E0CDAF 19` **[DB]** |
| Style DNA segments (API) | 4 segments returned by `GET /api/insights/style-dna` **[DB]** |
| Style DNA evolution | 6 points + 6 months returned by the API **[DB]** |
| Legacy style memories | stored under `style_profiles.dimensions.legacyStyleMemories`; the stylist reads them back (`digest` = "Never wears: sneakers …", `confidence` computed from stored ratings/chats) **[DB]** |
| Discover content | `GET /api/content/discover` → trends `Minimal Summer`, `Smart Casual`; looks `Urban Explorer 1200`, `Classic Minimal 920`, `Earth Tone Layers 1840`, `Soft Neutrals 760` **[DB]** |
| Shopping picks | `GET /api/shop/recommended` → 3 picks, 1 gap **[DB]** |
| Events | `GET /api/events` → 2 **[DB]** |

## 5. Dates and timestamps

- `createdAt` / `updatedAt` are populated by `@CreateDateColumn` /
  `@UpdateDateColumn` on insert; the 12 seeded items share the seed timestamp
  (2026-11-24T14:40:02Z) and `outfit_items` rows carry their own insert time
  **[DB]**.
- `lastWornLabel` strings ("Worn 4 days ago", "Unworn for 60+ days") are copied
  verbatim; `lastWornAt` is intentionally null because the legacy sources only
  had relative labels **[DB] + [STATIC]**.
- `weekly_plans.createdAt` orders the seven days correctly (Mon→Sun) **[DB]**.

## 6. Test-artefact hygiene

The Flutter contract test creates a `Contract Test Tee` and archives it via
`DELETE /wardrobe/items/:id` (the API archives, it does not hard-delete). Rows
created by this phase's smoke tests were removed afterwards, and the database
was re-checked: 12 items, 6 outfits, 18 links, 0 conversations, FK check empty
**[DB]**. No pre-existing row was deleted.

## 7. Summary of verification class

| Area | Class |
|---|---|
| Table existence, counts, FK/orphan checks | DB |
| Seed idempotency (twice) | DB |
| Demo login + JWT-protected endpoints | DB |
| Content/Insights endpoints | DB |
| Style DNA + legacy memory round-trip | DB |
| Field-level values in wardrobe/outfits/planner | DB |
| Repository-level user scoping | STATIC |
| Second-account isolation | NOT VERIFIED |
| PostgreSQL/MySQL execution | NOT VERIFIED (no server available) |
| Migration runner (`1-initial-schema.ts`) | NOT VERIFIED (synchronize=true used) |
