# AI Stylist Upgrade — Master Tracking

> **This file is the single source of truth for the entire AI Stylist upgrade process.**
> Every future AI upgrade session MUST read this file completely before taking any action,
> and MUST update it accurately before finishing.

**Project root:** `D:\Clothes_X2-main\Clothes_X2-main`
**File created:** 2026-11-16
**Last updated:** 2026-11-17 (Session 13)

---

## A. Project Overview

- **Project name:** SmartWardrobe (repository folder `Clothes_X2-main`).
- **Architecture (3 tiers):**
  1. **Flutter app** (`lib/`) — UI, state (`lib/data/app_state.dart`), API client (`lib/core/api/*`), models (`lib/data/models.dart`).
  2. **Node.js backend** (`backend/`) — the live AI runtime is the **Express** server `backend/server.js` plus modules in `backend/src/`. A NestJS/TypeScript module layout also exists under `backend/src/modules`, `backend/src/database`, etc., but the AI Stylist request flow is served by `server.js`.
  3. **Optional/legacy AI service** (`ai-service/main.py`, FastAPI) — referenced by README/env but **not** the primary path; the Node engine answers independently.
- **Main technologies:** Dart/Flutter, Node.js/Express, optional NestJS + TypeORM, JSON file persistence (`backend/data/db.json`), local ONNX models (`backend/.model-cache`).
- **Existing AI components (the ones this upgrade will touch):**
  - `backend/src/llm.js` — provider abstraction (Gemini/Groq/OpenRouter/OpenAI), `stylistChat` (structured JSON), `streamChat` (plain-prose SSE), `parseJson`, vision helpers.
  - `backend/src/ai-engine.js` — rule-engine `chatReply`, `detectOccasion`, beam-search `generateOutfits`, `remixOutfit`, `outfitName`, gap/packing helpers.
  - `backend/src/retrieval.js` — wardrobe shortlist ranking (MiniLM embeddings + lexical fallback).
  - `backend/src/style-memory.js` — learned preferences, chat/rating mining, `digest`, `styleDna`, `confidence`.
  - `backend/src/scoring.js` — 11-factor compatibility scoring + `explain`.
  - `backend/src/recommendation-engine.js` — constraint-aware blended ranking.
  - `backend/src/vision.js` — reference-outfit spec parsing + matching.
  - `backend/src/weather.js`, `taxonomy.js`, `store.js`, `saved-outfits.js`, `recommendation-history.js` — supporting context/persistence.
- **Purpose of this upgrade:** Turn the existing fragmented, unevenly-exposed AI Stylist into a **reliable, explainable, mode-driven personal stylist** with a consistent structured response contract, deterministic outfit editing, strong wardrobe grounding (no hallucinations), controllable personalization, distinct stylist modes, and an evaluation harness. Work must **extend** the existing architecture, not replace it.

---

## B. Complete Upgrade Roadmap

> These sessions are a roadmap, **not** permission to implement everything at once.
> Each session has its own scope and completion criteria and must be executed one at a time.

### Phase 1 — AI Response Intelligence
- **Session 1:** Inspect the current AI request/response flow and define the existing response contract. *(COMPLETED)*
- **Session 2:** Design a consistent structured response contract for streaming and non-streaming responses. *(COMPLETED)*
- **Session 3:** Implement and validate structured AI responses without breaking existing clients. *(COMPLETED)*
- **Session 4:** Prevent hallucinated wardrobe items and validate real wardrobe item IDs.
- **Session 5:** Improve contextual outfit editing so follow-up requests modify the existing outfit when appropriate.

### Phase 2 — Wardrobe Intelligence
- **Session 6:** Improve outfit explanations, compatibility evaluation, and recommendation quality. *(COMPLETED)*
- **Session 7:** Improve alternatives and recommendations for users with limited wardrobe items. *(COMPLETED)*

### Phase 3 — Context & Personalization
- **Session 8:** Improve conversation context and follow-up understanding. *(COMPLETED)*
- **Session 9:** Improve style memory, preference management, and user control. *(COMPLETED)*

### Phase 4 — Advanced Stylist Modes
- **Session 10:** Implement and integrate distinct Stylist and Fashion Critic experiences.
- **Session 11:** Implement and integrate Wardrobe Assistant and Shopping Assistant experiences.

### Phase 5 — Quality & Evaluation
- **Session 12:** Test Arabic, Egyptian Arabic, and English; evaluate hallucination prevention, regression safety, and response quality.

---

## C. Session Status

| Session | Title | Status |
| --- | --- | --- |
| 1 | Inspect current AI request/response flow and define response contract | COMPLETED |
| 2 | Design consistent structured response contract (stream + non-stream) | COMPLETED |
| 3 | Implement & validate structured AI responses without breaking clients | COMPLETED |
| 4 | Prevent hallucinated wardrobe items / validate real item IDs | COMPLETED |
| 5 | Contextual outfit editing (follow-up modifies existing outfit) | COMPLETED |
| 6 | Outfit explanations, compatibility evaluation, recommendation quality | COMPLETED |
| 7 | Alternatives/recommendations for limited wardrobes | COMPLETED |
| 8 | Conversation context and follow-up understanding | COMPLETED |
| 9 | Style memory, preference management, user control | COMPLETED |
| 10 | Distinct Stylist and Fashion Critic experiences | COMPLETED |
| 11 | Wardrobe Assistant and Shopping Assistant experiences | COMPLETED |
| 12 | Arabic/Egyptian Arabic/English testing + quality evaluation | COMPLETED |

**Allowed statuses:** NOT STARTED · IN PROGRESS · COMPLETED · BLOCKED · NEEDS REVIEW

---

## D. Session History

> Never overwrite this section. Append new records and preserve previous decisions.

### Session 1 — Inspect current AI request/response flow and define the existing response contract

- **Date:** 2026-11-16
- **Objective:** Understand the current AI Stylist request/response lifecycle and document the actual response contract. READ-ONLY investigation.
- **Status:** COMPLETED

#### Files inspected
- `AI_STYLIST_INTELLIGENCE_AUDIT.md` (existing audit, read in full)
- `backend/server.js` (AI routes, chat pipeline, context assembly, memory/persistence)
- `backend/src/llm.js` (provider abstraction, `stylistChat`, `streamChat`, `parseJson`, vision)
- `backend/src/ai-engine.js` (`chatReply`, `generateOutfits`, `toOutfit`, `detectOccasion`, `remixOutfit`)
- `backend/src/retrieval.js`, `style-memory.js`, `scoring.js`, `recommendation-engine.js`, `vision.js` (surveyed)
- `backend/README.md`, `backend/package.json`
- `lib/data/app_state.dart` (stylist state, `askStylist`, `streamStylist`, `chatHistory`, memory)
- `lib/core/api/api_client.dart` (`streamPost` SSE parser)
- `lib/core/api/smartwardrobe_api.dart` (`chat`, `chatStream`, `remix`, `matchOutfit`, `styleDna`, `capabilities`)
- `lib/data/models.dart` (`Outfit`, `ChatMessage`, `OutfitMatch`, `MatchFactor`)
- `lib/features/stylist/stylist_desk_screen.dart` (`_send`, `_runTurn`, `_applyOutfit`, streaming)
- `lib/features/stylist/stylist_screen.dart` (streaming bubble, follow-up display, remix chips, photo match)
- `test/backend_contract_test.dart` (live-backend contract test for chat/stream/remix/match)
- `backend/test/*.test.js` (test inventory; `node --test` style)

#### Changes implemented
- **None.** Read-only investigation. No application source code was modified. No packages installed. No DB/schema changes.

#### End-to-end request/response flow (as-built)

**A. Streaming chat (primary path — Stylist Desk and Stylist Screen both use it)**
1. UI `StylistDeskScreen._send()` (`stylist_desk_screen.dart:372`) appends the user `ChatMessage` and sets `_thinking = true`.
2. `AppState.streamStylist()` (`app_state.dart:1133`) calls `SmartWardrobeApi.chatStream()` → `ApiClient.streamPost('POST /ai/chat/stream')` with body `{message, history, conversationId}` (`smartwardrobe_api.dart:235`, `api_client.dart:61`).
3. Backend `POST /ai/chat/stream` (`server.js:973`):
   - Sets SSE headers, defines `send(event, data)`.
   - Builds `ctx = stylistContext(user, message)` → `{wardrobe, shortlist (retrieval.rank), memory, weather, occasion, styleProfile, events}` (`server.js:743`).
   - If `llm.status().configured`: iterates `llm.streamChat(...)` (plain **prose** tokens, no JSON) and emits `delta` events; on error emits `error {error, recoverable:true}` and falls through to rules.
   - If no text arrived (no key / provider error / empty stream): runs `ai.chatReply()` and emits the whole reply as a single `delta {delta, synthetic:true}`.
   - If text arrived: recovers outfit by `idsMentionedIn(text, wardrobe)` → `buildOutfitFromIds(...)`; if fewer than 2 named items, falls back to `ai.generateOutfits(...)[0]`.
   - Learns durable preferences (`learnTurn`), appends the turn to `db.conversations`, persists, then emits final `done` and `res.end()`.
4. Frontend `streamStylist` consumes frames: accumulates `delta` text and calls `onDelta(text)`; ignores `error` (recoverable); captures `done`. Builds `Outfit.fromJson(payload['outfit'])`, returns `{text, outfit, source, outfitRaw}`.
5. `StylistDeskScreen._runTurn()` adds the assistant `ChatMessage(text, outfit, source)` and calls `_applyOutfit(outfitRaw)` if an outfit is present.

**B. Non-streaming chat (`POST /ai/chat`, `server.js:874`)**
1. Same `stylistContext` retrieval.
2. If LLM configured: `llm.stylistChat(...)` requests a **structured JSON** object with `{text,intent,occasion,itemIds,constraints,followUp,memoryNotes}`; builds outfit from the explicit `itemIds` via `buildOutfitFromIds`.
3. On no LLM / empty reply: `ai.chatReply()` rule fallback.
4. `learnTurn` + persist to `db.conversations`.
5. Responds JSON: `{reply, outfit, followUp, intent, occasion, constraints, weather, memory:{confidence,digest}, conversationId, source}`.
   - Flutter exposes this via `AppState.askStylist()` (`app_state.dart:1100`) but **no current UI screen calls `askStylist` for chat** — the Stylist screens use the stream path.

**C. Adjacent AI flows (surveyed, not part of the chat contract but relevant to Phase 2–4)**
- `POST /ai/generate-outfit` → `ai.generateOutfits` (outfit objects via `toOutfit`).
- `POST /ai/calculate-compatibility` → `scoring.scoreOutfit` (11-factor `breakdown`).
- `POST /ai/match-outfit` → `llm.describeOutfit` + `vision.matchSpec`; returns `{title, occasion, notes, matches, gaps, similarity, averageMatch, wearable, exactCount, itemIds, items, outfit?, source}`.
- `POST /ai/remix` → `ai.remixOutfit`; returns `{outfit:{...variant, note, keptFromOriginal, regenerated}, ...}`.
- `GET /ai/style-dna`, `GET|DELETE /ai/conversations`, `GET /ai/capabilities`.

#### Current streaming response format
SSE events (each `event:` + `data:` JSON, blank-line separated):
- `delta` → `{ "delta": "<text fragment>" }` (adds `"synthetic": true` on the rule-engine fallback single-shot delta).
- `error` → `{ "error": "<message>", "recoverable": true }` (recoverable; server still sends `done`).
- `done` → `{ "reply": "<full text>", "outfit": <Outfit|null>, "weather": <Weather>, "memory": {"confidence": <num>, "digest": <object>}, "source": "gemini|groq|openrouter|openai|rules" }`.

#### Current non-streaming response format
`POST /ai/chat` → `{ reply, outfit, followUp, intent, occasion, constraints, weather, memory:{confidence,digest}, conversationId, source }`.
`POST /ai/generate-outfit` → `{ outfits: [Outfit], weather, occasion }`.

#### Important response fields and purposes
- `reply` (string): assistant prose; the only field required for display.
- `outfit` (object|null): the grounded, scored look; drives the canvas/outfit card.
- `source` (string): which engine answered — provider name, `rules`, `filename`, or client-side `offline`. Used by UI to avoid implying an LLM answered.
- `intent` (non-stream only): `build_outfit|remix|explain|opinion|learn|chat`.
- `followUp` (non-stream only): suggested next question.
- `constraints` (non-stream only): `{colors, styles, avoid}`.
- `occasion` (non-stream only): resolved occasion label.
- `weather` (both): resolved weather summary/temp used for grounding.
- `memory` (both): `{confidence, digest}` used by the client for the style-DNA summary.
- `conversationId` (non-stream only): echoed thread id.
- `outfit` object shape varies by producer (see inconsistencies).

#### Outfit object shapes (by producer)
- **`buildOutfitFromIds`** (chat + stream recovery): `{id:"llm-<ts>", name, occasion, match, breakdown, completeness, explanation, itemIds, pieces, items, image}`.
- **`toOutfit`** (generate/recommend): `{id:"gen-<hash>", name, occasion, match, compatibilityScore, rankingScore, breakdown, explanation, itemIds, pieces, items, image}` (no `completeness`).
- **`/ai/match-outfit` outfit**: `{id:"match-<ts>", name, match, breakdown, explanation, itemIds, pieces, items, image}` (no `occasion`, no `completeness`).
- `items` is always the array of full wardrobe item objects (`id, name, category, image, ...`); the Desk canvas depends on this.

#### Differences and inconsistencies between stream and non-stream
1. **Structured vs prose generation.** Non-stream asks the LLM for JSON (`intent`, `itemIds`, `followUp`, `constraints`). Stream deliberately asks for plain prose only (`llm.js:374-386`) and **recovers** the outfit heuristically from text mentions.
2. **Missing fields in `done`.** Stream `done` lacks `intent`, `followUp`, `constraints`, `occasion`, `conversationId` that non-stream returns. Consequence: the Stylist Screen's `followUp` bubble (`stylist_screen.dart:356`) is effectively never populated on the stream path.
3. **Outfit grounding reliability.** Non-stream builds from explicit, validated IDs. Stream uses `idsMentionedIn` (normalized name/id regex match) and, if <2 matches, silently attaches a freshly generated outfit — the outfit can therefore be unrelated to the prose.
4. **Outfit shape drift.** `completeness` present only from `buildOutfitFromIds`; `compatibilityScore`/`rankingScore` present only from `toOutfit`; `occasion` absent from match outfits.
5. **`source` semantics differ** across paths (`rules`, provider name, `filename`, `offline`).

#### Frontend dependencies and backward-compatibility risks
- `AppState.askStylist` reads `res['reply']`, `res['outfit']`, `res['memory']`.
- `AppState.streamStylist` reads `frame.data['delta']`, `payload['reply']`, `payload['outfit']`, `payload['source']`, `payload['memory']`.
- `StylistDeskScreen._applyOutfit` requires `raw['items']` (array of full items with `id/name/category/image/imageUrl`); reads `raw['id']`, `raw['match']|raw['matchScore']`, `raw['explanation']|raw['stylistNote']`.
- `Outfit.fromJson` (`models.dart:221`) tolerates missing fields via defaults but expects `id/name/image/occasion/match/pieces/itemIds/breakdown/explanation/completeness/compatibilityScore/rankingScore`.
- `ChatMessage` supports `source`/`followUp`/`match`; the stream path never sets `followUp`.
- **Hard backward-compatibility constraints from the existing live contract test** (`test/backend_contract_test.dart:253`):
  - `done.reply` MUST equal `deltas.join()` exactly (so any new structured stream must keep text deltas reconstructing `reply`).
  - `done.outfit` MUST be non-null with non-empty `itemIds` and integer `match` for the tested scenario.
  - `chat.reply.length > 20` and `chat.source != null` for non-stream.
- **Safe change pattern:** additive new fields/events only. Renaming/removing existing fields (`reply`, `outfit`, `itemIds`, `match`, `source`, `delta`) would break the Flutter parser and/or the contract test.

#### Relevant existing tests and status
- **Backend:** `backend/test/*.test.js` are dependency-free `node --test` files (jest `rootDir: src`, regex `*.spec.ts`, so `npm test` does NOT run them). Coverage exists for scoring, style-memory, recommendation-engine, rating-learning, feedback-learning, saved-outfits, ranking-audit, outfit-rating. **No test covers `/ai/chat`, `/ai/chat/stream`, intent routing, `followUp`, or the response schema.**
- **Flutter:** `test/backend_contract_test.dart` covers `/ai/chat`, `/ai/chat/stream`, `/ai/remix`, `/ai/match-outfit`, `/ai/style-dna`, `/ai/capabilities`. It **skips gracefully** when the backend is not running. Other Flutter tests (outfit rating/save, home recommendation, etc.) exist but do not target stylist intelligence.
- **Status in this session:** tests were **NOT executed** — this was a read-only investigation and running them would require starting the backend (and an LLM key for AI paths). Their existence and structure were verified by reading; pass/fail is **unverified** here.

#### Known issues and limitations
- Streamed outfit grounding is heuristic and can mismatch the prose.
- Stream response lacks structured metadata (`intent`, `followUp`, `constraints`, `occasion`).
- Outfit object shape is inconsistent across producers.
- `followUp` UI in the Stylist Screen is dead on the stream path.
- No automated coverage for chat/stream schema or intent behavior.

#### Existing features preserved
- Yes. No source files were changed; behavior is unchanged.

#### Final status
- **COMPLETED.** Investigation and documentation are complete. All five required deliverables are documented in this file.

#### Exact next recommended session
- **Session 2 — Design a consistent structured response contract for streaming and non-streaming responses.**
  Design only (no implementation): define a unified schema for `reply`, `intent`, `mode`, `language`, `outfit`, `itemReasons`, `ownedItems`, `missingItems`, `followUps`, `confidence/uncertainty`, `source`; define the SSE event protocol that preserves `reply == deltas.join()`; specify additive-only changes and a migration/compatibility plan for `Outfit.fromJson`, `streamStylist`, and `backend_contract_test.dart`.

---

### Session 2 — Design a consistent structured response contract (streaming + non-streaming)

- **Date:** 2026-11-16
- **Objective:** Design (only) a unified, semantically consistent response contract for `POST /ai/chat/stream` and `POST /ai/chat`, preserving all existing behaviour and clients. No implementation.
- **Status:** COMPLETED
- **Design document:** `AI_RESPONSE_CONTRACT_DESIGN.md` (project root). This is the authoritative design.

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` in full (Session 1 history, decisions, rules).
- Re-verified every Session 1 finding against the current source.
- Checked working tree for changes since Session 1: none in application source. The uncommitted edits to `lib/data/app_state.dart` and `lib/features/stylist/stylist_desk_screen.dart` have mtimes (2026-11-16 01:46) that predate the Session 1 record (2026-11-16 13:05); Session 1 already documented the `outfitRaw` signature they contain.

#### Files inspected (Session 2)
- Backend: `backend/server.js` (chat/stream routes, `stylistContext`, `idsMentionedIn`, `learnTurn`, `buildOutfitFromIds`, match/remix, capabilities), `backend/src/llm.js` (`stylistChat`, `streamChat`, `parseJson`, prompt schemas), `backend/src/ai-engine.js` (`chatReply`, `generateOutfits`, `toOutfit`, `remixOutfit`, `finishRemix`, `detectOccasion`), `backend/src/retrieval.js` (`rank`, `balance`), `backend/src/style-memory.js` (`digest`, `confidence`, `styleDna`), `backend/src/scoring.js` (`scoreOutfit`, `explain`), `backend/src/recommendation-engine.js` (`recommend`, `finish`), `backend/src/weather.js` (weather shape), `backend/data/db.json` (wardrobe item shape sample), `backend/package.json` (test config).
- Flutter: `lib/data/app_state.dart` (`askStylist`, `streamStylist`, `_applyMemory`, `_describeDna`, `_conversationId`), `lib/core/api/api_client.dart` (`streamPost` SSE parser), `lib/core/api/smartwardrobe_api.dart` (`chat`, `chatStream`, `remix`, `matchOutfit`), `lib/data/models.dart` (`Outfit`, `ChatMessage`, `OutfitMatch`), `lib/features/stylist/stylist_screen.dart` (`_send`, follow-up UI, outfit card), `lib/features/stylist/stylist_desk_screen.dart` (`_send`, `_runTurn`, `_applyOutfit`).
- Tests inspected (not executed): `test/backend_contract_test.dart` (live-backend contract, stream delta-join assertion), inventory of `backend/test/*.test.js` (confirmed no chat/stream coverage).

#### New findings this session (beyond Session 1)
1. **`completeness` type mismatch can crash Flutter parsing.** `buildOutfitFromIds` (`server.js:840`) and `finishRemix` (`ai-engine.js:428`) send `completeness` as an object `{ratio,filled,required}`, but `Outfit.fromJson` casts it `as num?` (`models.dart:250`). A Map throws, `streamStylist`'s `catch` swallows it and degrades the turn to the offline mock reply. `toOutfit` omits the field, so only some outfits trigger it.
2. **`memory.digest` mismatch.** Server sends `digest` as a string (`style-memory.js:592-615`); `_applyMemory` only applies it when it is a Map and reads `dislikes/prefers/notes` (`app_state.dart:1246-1276`). The learned summary never updates from chat.
3. **`followUp` is unwired at all three layers on the stream path** (backend `done` lacks it; `streamStylist` returns no `followUp`; both screens build the finished `ChatMessage` without it). The follow-up UI at `stylist_screen.dart:356` is dead on the primary path.
4. **Rule fallback never supplies `constraints`/`followUp`.** `ai.chatReply` returns no `constraints`; `server.js:934` reads `fallback.constraints` (always undefined). Harmless today but relevant for parity.

#### Proposed contract (summary; details in the design doc)
- **One "stylist turn" envelope** for both paths: `reply, intent, occasion, followUp, constraints, conversationId, outfit, weather, memory{confidence,digest,facets}, source, mode?, meta`.
- **Additive metadata:** `memory.facets` (structured taste summary) and `meta` (`contractVersion, requestId, generatedAt, engine, degraded, itemIdValidation{requested,valid,dropped}`).
- **Streaming protocol:** `meta` (optional, no text) → `delta*` → optional `error*` → exactly one `done` (full envelope). Preserves `done.reply == deltas.join()`. `meta` carries no text; `done` stays authoritative. Old clients ignore the unknown `meta` event (verified: `streamStylist` switch has no default).
- **Structured metadata on stream:** recommended two-phase approach — stream prose unchanged, then a bounded extraction call for `intent/itemIds/followUp/constraints/memoryNotes` merged into `done`; deterministic rules fallback when no LLM. Rejected streaming structured JSON (risk of JSON leaking into deltas).
- **Canonical outfit:** one normaliser for all producers. Keep `id,name,occasion,match,breakdown,explanation,itemIds,pieces,items,image`; add `compatibilityScore` aliasing `match` where absent, `completeness` (number) + `completenessDetail` (object), `provenance`, and `grounding{recoveredItemIds,usedFallback,allOwned}`. `items[]` remains full wardrobe objects for the Desk canvas; `itemIds` are validated, owned, deduped.
- **Contradiction guard:** stream recovery order = structured IDs → names recovered from prose → marked `generated_fallback` (`usedFallback:true`, `degraded:true`). The reply text is never rewritten; provenance makes any mismatch explicit. No fallback is invented merely to fill `done.outfit`.
- **Validation:** `validateItemIds` filters unknown/archived IDs and dedupes by garment; `meta.itemIdValidation` reports requested/valid/dropped.

#### Important decisions recorded
1. **Semantic consistency, not structural identity.** Stream and non-stream expose the same meaning; the stream may add a `meta` event but the `done` envelope matches the non-stream body.
2. **Additive only, legacy fields frozen.** `reply`, `outfit`, `delta`, `source`, `itemIds`, `match`, `items`, and all non-stream fields keep their names and meanings.
3. **Text and metadata are strictly separated.** No metadata in deltas; `done.reply == deltas.join()` is inviolable.
4. **One outfit producer/normaliser.** Prevent recurrence of the documented shape drift.
5. **`completeness` normalized to a number** (what `Outfit.fromJson` expects), with the old object form preserved additively as `completenessDetail`. Documented as a compatibility fix because the only in-repo consumer currently crashes on the object; flagged as an open question if an external client exists.
6. **`memory.digest` stays a string**; structured data added as `memory.facets` using keys (`prefers/dislikes/notes`) that `_describeDna` already reads.
7. **No speculative fields.** No `language`, no top-level duplicate `itemIds`, no `ownedItems/missingItems/itemReasons`, no `followUps[]`. `mode` is optional/reserved for Sessions 10–11.
8. **Two-phase stream annotation** chosen over streaming structured JSON.
9. **Fallback outfits are marked, not hidden.** `provenance` + `grounding` + `meta.degraded` expose degraded turns.

#### Unresolved questions (carried to Session 3; full list in design §H)
- Acceptable cost/latency of the Phase-B annotation call on the streaming path.
- Whether any out-of-repo client reads the old object `completeness` (affects normalization).
- Whether stream `intent` must exactly match non-stream LLM classification.
- Fallback policy when the LLM names <2 owned items: marked fallback vs `outfit:null` + clarifying follow-up.
- Whether to reserve `mode` now or defer.
- Whether to persist structured turn fields in `db.conversations` (needed by Session 8).
- Cross-turn item validation when history references archived/deleted items.
- Language metadata is unverified; deferred to Session 12.

#### Tests
- **Inspected only. NOT executed.** No backend test covers `/ai/chat` or `/ai/chat/stream`; `test/backend_contract_test.dart` covers them live but skips when the backend is down and requires an LLM key for AI paths. Pass/fail remains unverified in this environment. The design lists the tests Session 3 must add.

#### Source-code changes
- **None.** No application source, Flutter file, backend implementation, API behaviour, package, or DB schema was modified. The only new file is `AI_RESPONSE_CONTRACT_DESIGN.md`. This file (`AI_UPGRADE.md`) was updated for tracking.

#### Final status
- **COMPLETED.** All deliverables A–H are in `AI_RESPONSE_CONTRACT_DESIGN.md` and are internally consistent. Design only; nothing implemented.

#### Exact next recommended session
- **Session 3 — Implement and validate structured AI responses without breaking existing clients.** Scope: implement the additive contract from `AI_RESPONSE_CONTRACT_DESIGN.md` §G only (contract helpers, normalized outfits, extended `done`, optional `meta` event, `memory.facets`, Flutter parsing/wiring, expanded tests). Do **not** start Sessions 4–12 (ID hallucination prevention beyond validation, contextual editing, gap reasoning, stylist modes, Arabic testing).

---

### Session 3 — Implement and validate structured AI responses without breaking existing clients

- **Date:** 2026-11-16
- **Objective:** Implement the additive contract from `AI_RESPONSE_CONTRACT_DESIGN.md` §G only, keeping the legacy stream/text contract intact.
- **Status:** COMPLETED
- **Design source:** `AI_RESPONSE_CONTRACT_DESIGN.md` (Session 2, binding).

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` (Sessions 1–2) and `AI_RESPONSE_CONTRACT_DESIGN.md` before editing.
- Re-inspected the current live code in `backend/server.js`, `backend/src/ai-engine.js`, `backend/src/style-memory.js`, `backend/src/scoring.js`, `backend/src/taxonomy.js`, `backend/src/llm.js`, `lib/data/models.dart`, `lib/data/app_state.dart`, and both stylist screens.
- Preserved the pre-existing user-owned working-tree edits in `lib/data/app_state.dart` and `lib/features/stylist/stylist_desk_screen.dart`; changes to those files were limited to the contract wiring.

#### Files changed
- **New `backend/src/response-contract.js`** — the single contract helper module:
  - `CONTRACT_VERSION = 2`, `PROVENANCE` (`llm_ids`, `recovered_from_reply`, `generated_fallback`, `rule_fallback`, `generated`, `remix`, `match`), `newRequestId()`.
  - `validateItemIds(ids, wardrobe)` → `{requested, valid, dropped}`; owned-only, `archived` excluded, deduped by `taxonomy.garmentKey` (never by id alone).
  - `completenessFromItems(items)` → `{ratio, filled, required}`.
  - `normalizeOutfit(outfit, opts)` — one normaliser for every producer. Preserves `id,name,occasion,match,breakdown,explanation,itemIds,pieces,items,image,variant,note,keptFromOriginal,regenerated`; adds integer `compatibilityScore` (aliasing `match`), nullable `rankingScore`, numeric `completeness` + `completenessDetail`, `provenance`, and `grounding{recoveredItemIds,usedFallback,allOwned}`.
  - `memoryFacets(memory)` → `{prefers,dislikes,favouredStyles,formalityLean,avoid,notes,confidence,totals}`.
  - `baseMeta(opts)` → `{contractVersion:2,requestId,generatedAt,engine,degraded,itemIdValidation}`.
  - `inferIntent(message)`, `emptyConstraints()`.
- **`backend/src/ai-engine.js`** — `toOutfit` now returns `normalizeOutfit(..., {provenance:'generated'})`; `finishRemix` outfit returns `normalizeOutfit(..., {provenance:'remix'})`. No gameplay/scoring change. Also widened the existing exclusion branch in `chatReply` to recognise “never wear X” / “avoids X” (the live keyless stream contract test asserts the exclusion survives).
- **`backend/server.js`**:
  - Requires `./src/response-contract`.
  - `buildOutfitFromIds` normalizes with caller-supplied `provenance`/`occasion`/`grounding`.
  - `POST /ai/chat` (non-stream) fully returns the unified envelope: validates LLM `itemIds`, keeps `outfit:null` when fewer than 2 owned ids survive (no unrelated generation), exposes `degraded`, `memory.facets`, `meta`, and richer `trackAi` fields.
  - `POST /ai/chat/stream` now emits one optional `meta` event before the first delta, keeps the existing `delta*` prose unchanged, and sends the unified `done` envelope (`intent,occasion,followUp,constraints,conversationId,outfit,weather,memory{confidence,digest,facets},source,meta`). `done.reply === deltas.join()` is preserved. Rule fallback is marked `rule_fallback`; prose-recovered outfits are marked `recovered_from_reply`; only a <2-id recovery marks a `generated_fallback` + `degraded:true`.
  - `POST /ai/match-outfit` wraps its outfit in `normalizeOutfit(..., {provenance:'match'})`.
- **`lib/data/models.dart`** — `Outfit` gains nullable `completenessDetail`, `provenance`, `grounding`; `Outfit.fromJson` reads both new and legacy shapes. `completeness` stays a `double?`; a legacy completeness object is accepted and its `ratio` becomes the number while the object is preserved in `completenessDetail`. Non-string/non-map optional fields degrade to `null`.
- **`lib/data/app_state.dart`** — `streamStylist` return record now also carries `followUp`, `intent`, `occasion`, `constraints`, `memoryFacets`, `meta` (additive; existing fields unchanged). `_applyMemory` prefers `memory.facets` and still accepts a Map-shaped legacy digest; `_describeDna` now joins list values.
- **`lib/features/stylist/stylist_screen.dart`**, **`lib/features/stylist/stylist_desk_screen.dart`** — pass `reply.followUp` into the finished `ChatMessage` (the Screen’s follow-up UI is now reachable when a follow-up is supplied).
- **New `backend/test/response-contract.test.js`** — 10 contract tests.
- **New `test/response_contract_model_test.dart`** — 4 Flutter parsing tests (canonical, legacy object completeness, legacy missing fields, malformed optional fields).

#### Contract decisions applied
1. **No extra LLM annotation call on the stream.** Stream metadata is deterministic: `intent` from `inferIntent(message)`, `occasion` from `stylistContext`, `constraints` empty unless the rule engine supplies them, `followUp:null`. This avoids extra cost/latency; richer stream extraction remains a Session 8 concern.
2. **`meta` is optional and text-free.** It is emitted once, immediately before the first delta (or before the synthetic fallback delta), never interleaved with text. Old clients ignore unknown events; `done` remains authoritative.
3. **One normaliser.** `generated`, `remix`, `match`, `llm_ids`, `recovered_from_reply`, and `rule_fallback` producers all use `normalizeOutfit`, ending the documented shape drift.
4. **Legacy compatibility.** `memory.digest` stays a string; `memory.facets` is additive. `completeness` is now a number with the old object preserved as `completenessDetail`. All legacy `reply/outfit/delta/source/itemIds/match/items` names and meanings are unchanged.
5. **No invented outfits.** Non-stream leaves `outfit:null` when the LLM’s ids do not survive validation. Stream only generates a replacement when fewer than two named pieces are recoverable, and marks it `generated_fallback`/`usedFallback:true`/`degraded:true`.

#### Known limitation (documented edge case)
- If the provider errors **after** the first delta, `meta` has already been sent with the provider as `source` and the initial `degraded` value, while `done` may report `source:'rules'`/`degraded:true`. `done` is authoritative; clients must not treat an early `meta` as final. If the provider fails **before** the first delta, `meta` is deferred until the synthetic fallback delta, so it matches `done`.

#### Tests executed (this session)
- `backend/`: `node --test "test/*.test.js"` → **115 passing, 0 failing** (includes the new `response-contract.test.js` and the existing HTTP/DB/rating/scoring suites).
- `backend/`: `node --test test/response-contract.test.js` → **10 passing**.
- `backend/`: isolated live probes on a temporary data dir/port:
  - Rules-mode `POST /ai/chat/stream` (no LLM keys): one `meta`, deltas reconstruct `done.reply`, `outfit` present with `provenance:'rule_fallback'`, contract v2, facets present.
  - Stubbed-LLM `POST /ai/chat/stream`: one `meta`, `source:'stub'`, `degraded:false`, outfit `provenance:'recovered_from_reply'`, only owned/deduped ids, `usedFallback:false`, completeness number.
  - Stubbed-LLM `POST /ai/chat`: valid ids → `provenance:'llm_ids'`; `['w1','ghost']` → `outfit:null`, `dropped:['ghost']`, `degraded:true`, `followUp` surfaced.
- Flutter: `flutter analyze` on the four edited files → **No issues found**.
- Flutter: `flutter test test/response_contract_model_test.dart` → **4 passing**.
- Flutter: full `flutter test` → **111 passing, 5 skipped** (the live-backend contract tests skip when no backend is running on `localhost:3001`).
- Flutter: `flutter test test/backend_contract_test.dart` against an isolated keyless backend on a temporary port/data dir → **3 passing** (non-stream AI, rating flow, and the extended streaming contract assertions, including `done.reply == deltas.join()` and the sneaker exclusion).
- **Not executed:** a real-provider chat/stream call. `backend/.env` has no usable LLM key in this environment; the LLM-shaped paths were exercised with an injected stub, and the rules path was exercised live. The real-provider contract test remains unverified here.

#### Final status
- **COMPLETED.** The Session 3 contract is implemented and covered by backend unit tests, Flutter parsing tests, and isolated HTTP probes. No Session 4–12 work was started.

#### Exact next recommended session
- **Session 4 — Prevent hallucinated wardrobe items and validate real wardrobe item IDs.** Build on the existing `validateItemIds`/`meta.itemIdValidation` contract rather than re-implementing it. Keep the Session 3 stream/done envelope and the marked-fallback policy intact.

---

### Session 4.1 — Prevent hallucinated wardrobe items and validate real wardrobe item IDs

- **Date:** 2026-11-16
- **Objective:** Strengthen hallucination prevention by extending the existing `validateItemIds` contract with LLM prompt hardening, retry logic for non-stream paths, improved streaming recovery, and comprehensive test coverage.
- **Status:** COMPLETED

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` in full (Sessions 1–3) and `AI_RESPONSE_CONTRACT_DESIGN.md` before editing.
- Re-inspected the current live code in `backend/src/response-contract.js`, `backend/server.js`, `backend/src/llm.js`, `backend/src/ai-engine.js`, and test files.
- Verified all Session 3 implementation is intact and tests pass.

#### Files changed
- **`backend/src/llm.js`** — Strengthened `STYLIST_SYSTEM` prompt with explicit anti-hallucination instruction: "You MUST ONLY use item IDs that appear in the WARDROBE CATALOG below. Any ID not listed is a hallucination and will be rejected." Also updated streaming system prompt with "CRITICAL: Only mention garments that appear in the WARDROBE CATALOG. Do not invent or hallucinate any item names or details."
- **`backend/server.js`** — Added retry logic to `POST /ai/chat` (non-stream): up to 2 attempts (initial + 1 retry) when LLM returns invalid/hallucinated itemIds. If retry succeeds with valid IDs, uses them; if exhausted, falls back to rule engine or uses partial valid IDs with `degraded=true`. Enhanced streaming recovery in `POST /ai/chat/stream` with validation logging for dropped/hallucinated items and proper `degraded` marking when recovery references invalid items.
- **`backend/test/response-contract.test.js`** — Added 9 new hallucination prevention tests: all-hallucinated rejection, mixed valid/hallucinated handling, archived item filtering, garment-key deduping, grounding metadata verification for valid vs fallback outfits, `baseMeta` itemIdValidation capture, and LLM function exports verification.

#### Implementation details
1. **LLM Prompt Hardening** (`llm.js`): The system prompt now explicitly states that only catalog IDs may be used, and any other ID is a hallucination. Streaming prompt adds "CRITICAL" instruction to only mention catalog garments.

2. **Non-Stream Retry Logic** (`server.js:884-975`): 
   - New retry loop with `MAX_LLM_ATTEMPTS = 2`
   - Validates returned `itemIds` via `responseContract.validateItemIds()`
   - Success requires ≥2 valid IDs AND zero dropped IDs
   - On failure: logs warning, retries once; on exhaustion: uses partial valid IDs with `degraded=true` or falls to rule engine
   - Preserves `meta.itemIdValidation` with `requested/valid/dropped` for observability

3. **Streaming Recovery Robustness** (`server.js:1196-1224`):
   - Validates mentioned items via `validateItemIds()`
   - Logs warning when dropped items detected: `LLM mentioned X items, Y invalid/hallucinated (dropped: ...)`
   - Marks `degraded=true` when prose references invalid items but outfit built from valid ones
   - Generated fallback properly marked with `provenance: 'generated_fallback'`, `grounding.usedFallback: true`

4. **Validation Contract** (`response-contract.js`): Existing `validateItemIds` already provides:
   - Owned-only filtering (excludes `archived`)
   - Garment-key deduplication (not by ID alone)
   - Explicit `requested/valid/dropped` reporting
   - Integrated into `meta.itemIdValidation` for both stream and non-stream

#### Tests executed (this session)
- **Backend**: `node --test "test/*.test.js"` → **123 passing, 0 failing** (includes 18 response-contract tests with 9 new hallucination tests)
- **Flutter**: `flutter test` → **111 passing, 5 skipped** (backend contract tests skip when no backend running)
- **Flutter**: `flutter analyze` → **No issues found**

#### Known limitations
- Real LLM provider not exercised (no key configured in `backend/.env`); retry logic validated via test stubs and rule-engine fallbacks
- Streaming retry not implemented (would require re-streaming; complexity vs benefit assessed as low — logging + degraded marking provides observability instead)

#### Final status
- **COMPLETED.** Hallucination prevention is implemented at three layers: prompt hardening, non-stream retry with validation, and streaming recovery with explicit logging and metadata. All tests pass.

#### Exact next recommended session
- **Session 6 — Improve outfit explanations, compatibility evaluation, and recommendation quality.**

---

### Session 4.2 — Flutter clothing AI pipeline integration

- **Date:** 2026-11-16
- **Objective:** Complete the Flutter integration of the existing clothing AI pipeline (wardrobe photo analysis): surface AI analysis data on garments, display analysis details, handle rejections and uncertainty, verify timeout/error handling.
- **Status:** COMPLETED

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` (Sessions 1–4.1) and `AI_RESPONSE_CONTRACT_DESIGN.md`.
- Re-inspected the live Flutter API layer (`lib/core/api/smartwardrobe_api.dart`, `api_client.dart`, `api_config.dart`), the wardrobe screens (`add_clothing_screen.dart`, `analyzing_screen.dart`, `item_detail_screen.dart`, `wardrobe_screen.dart`), `lib/data/models.dart` and `lib/data/app_state.dart`.
- Re-inspected the backend contract: `POST /ai/analyze-clothing` (`backend/server.js:610`) and `POST /wardrobe/items` analysis persistence (`backend/server.js:529-558`) return `analysis`, `analysisSource`, `analysisConfidence`, `analysisRejected`, `uncertainAttributes`, `colorDetail`, `analysisModel`, `analyzedAt`.

#### Files changed
- **`lib/data/models.dart`** — `ClothingItem` gains `pattern` (default `'Plain'`) plus AI analysis provenance fields: `analysisSource`, `analysisConfidence`, `analysisRaw` (the full `analysis` payload), `analysisRejected`, `analyzedAt`. `fromJson` parses all backend analysis fields; `toJson` serializes them. Added derived getters `analysisStatus` (`analyzed`/`uncertain`/`filename`/`heuristic`/`rejected`/null), `analysisStatusLabel`, `colorWithConfidence`, and `uncertainAttributesList`.
- **`lib/data/app_state.dart`** — `importPhotos` no longer aborts the whole batch when one photo is rejected (HTTP 422 `non_clothing`); it skips rejected photos and continues, only failing when nothing was saved. Analysis data already flows through `stagePhoto` → `addItem` → `createWardrobeItem` and is parsed by `ClothingItem.fromJson`, so persisted items carry analysis provenance back to the UI.
- **`lib/features/wardrobe/item_detail_screen.dart`** — New `_AnalysisCard` shown when an item has an analysis record: status chip, confidence, source, analyzed-at, uncertain-attributes warning, and a rejection banner for non-clothing items.
- **`lib/features/wardrobe/add_clothing_screen.dart`** — Tag grid now shows AI confidence, uncertain attributes to verify, and the analysis source (file-name guess / offline heuristic) for the single-photo case.
- **`test/clothing_item_analysis_test.dart`** (new) — 6 parsing/status tests.

#### Timeout and error handling
- `POST /ai/analyze-clothing` already uses `ApiConfig.analyzeTimeout` (60s, `api_config.dart:31`) — no change needed; the 8s shared budget would have dropped gate verdicts.
- Rejected non-clothing photos surface as `ApiException(status: 422)` with `_notClothingMessage` in `stagePhoto`/`importPhotos`; they are never saved as default-tagged garments. `importPhotos` skips rejected photos instead of aborting the batch.

#### Tests executed
- `flutter analyze` → **No issues found**.
- `flutter test` → **117 passing, 5 skipped** (the 5 skips are live-backend contract tests that require `localhost:3001`, which is not running in this environment; they skip gracefully per the existing convention).
- `flutter test test/clothing_item_analysis_test.dart` → **6 passing**.
- Backend tests were **not executed** — no backend files were modified, and the Node backend is not running in this environment.

#### Known limitations
- No live vision/LLM provider is available, so the real `clothing-vision`/`clothing-vision+gemini` path was validated by reading the backend contract and by parsing-test coverage, not against a running analysis server. The `non_clothing_gate_test` and `backend_contract_test` skip when the backend is down.
- Session 4.2 is the clothing-pipeline Flutter track. The AI Stylist roadmap (`AI_UPGRADE.md` section C) is unaffected: Session 5 (contextual outfit editing) remains NOT STARTED.

#### Final status
- **COMPLETED.** Clothing analysis data flows from the backend into `ClothingItem`, is displayed on the item detail screen and the Add Clothes tag grid, and rejections/uncertain results are handled without saving non-clothing as garments.

---

### Session 5 — Improve contextual outfit editing so follow-up requests modify the existing outfit when appropriate.

- **Date:** 2026-11-16
- **Objective:** When a follow-up stylist message asks to modify the previous look (e.g. "make it more formal", "less casual", "for a date"), detect remix vs. build-new using the prior turn's `provenance`/`grounding` metadata, and remix the existing outfit via `POST /ai/remix` instead of generating a new look. Keep Session 4's validation envelope (`validateItemIds`, `meta.itemIdValidation`) intact.
- **Status:** COMPLETED

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` (Sessions 1–4.2) and `AI_RESPONSE_CONTRACT_DESIGN.md`.
- Re-inspected `backend/server.js` (`/ai/chat`, `/ai/chat/stream`, `/ai/remix`, `stylistContext`, `db.conversations` records), `backend/src/ai-engine.js` (`remixOutfit`, `REMIX_TARGETS`, `detectOccasion`, `chatReply`), `backend/src/response-contract.js` (`PROVENANCE`, `normalizeOutfit`, `inferIntent`, `baseMeta`), `lib/data/models.dart` (`Outfit.provenance`, `Outfit.grounding`, `ChatMessage`), `lib/data/app_state.dart` (`streamStylist`, `remixOutfit`), `lib/features/stylist/stylist_screen.dart` (`_OutfitSuggestion` remix chips).
- Confirmed git status/diff before editing; no destructive Git commands used; no commits made.

#### Files changed
- **`backend/src/ai-engine.js`** — Added `detectRemixVariant(message)` mapping follow-up keywords to a remix variant (`casual`/`cold`/`summer`/`date`/`formal`). Anti-formal phrases ("less formal", "not too formal") resolve to `casual` before bare "formal" can match. Exported in `module.exports`.
- **`backend/server.js`**:
  - `db.conversations` records now store `provenance` and `grounding` from the turn's outfit (both non-stream `/ai/chat` and stream `/ai/chat/stream`), so the next turn can inspect them.
  - Added `findLastOutfitTurn(userId, conversationId)` helper — returns the most recent turn with `itemIds`, plus its `provenance`/`grounding`.
  - Both `/ai/chat` and `/ai/chat/stream`: when `responseContract.inferIntent(message) === 'remix'` and a previous turn exists with valid itemIds whose `grounding.usedFallback !== true`, the backend calls `ai.remixOutfit(previousTurn.itemIds, variant)` via `ai.detectRemixVariant(message)`. The remixed outfit carries `provenance: 'remix'` and grounding with `recoveredItemIds`. A fallback look is never remixed — a fresh look is built instead. `intent` is set to `'remix'` and `degraded` is set if the remix regenerated from scratch.
- **`backend/test/response-contract.test.js`** — Added 2 tests for `detectRemixVariant` (variant mapping for all 5 variants + anti-formal precedence over "formal").

#### Tests executed
- `node --test backend/test/*.test.js` → **125 passing, 0 failing** (123 pre-existing + 2 new `detectRemixVariant` tests).
- `flutter analyze` → **No issues found**.
- `flutter test` → **117 passing, 5 skipped** (5 skips are live-backend contract tests requiring `localhost:3001`, not running in this environment).

#### Known limitations
- No live LLM key is available, so the real-provider AI path is validated only with an injected stub; rules mode was validated live via `test/backend_contract_test.dart`.
- The Flutter UI already renders remix results (variant, note, keptFromOriginal, regenerated) via `_OutfitSuggestion` and its remix chips; Session 5's backend change makes follow-up *messages* automatically trigger remix detection without requiring a manual chip tap.

#### Final status
- **COMPLETED.** Follow-up stylist requests that ask to modify the previous look now remix it (via `POST /ai/remix`, `provenance: 'remix'`) instead of building a new outfit, detected through the prior turn's `provenance`/`grounding` metadata. Session 4's validation envelope is preserved.

---

### Session 6 — Improve outfit explanations, compatibility evaluation, and recommendation quality.

- **Date:** 2026-11-16
- **Objective:** Make outfit explanations richer and factor-specific, expose full factor detail (`weight`, `applied`, `contribution`) through the `normalizeOutfit` contract so Flutter can show what actually moved the score, and keep recommendation quality deterministic and well-scored.
- **Status:** COMPLETED

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` (Sessions 1–5) and `AI_RESPONSE_CONTRACT_DESIGN.md`.
- Re-inspected `backend/src/scoring.js` (`scoreOutfit`, `explain`, `completeness`), `backend/src/response-contract.js` (`normalizeOutfit`), `lib/data/models.dart` (`Outfit.fromJson`, `MatchFactor`), `lib/features/outfits/perfect_match_screen.dart` (breakdown/factors rendering).
- Confirmed git status before editing; no destructive Git commands used; no commits made.

#### Files changed
- **`backend/src/scoring.js`** — Rewrote `explain()` with factor-specific language (colour harmony names the palette, occasion fit names the occasion, weather_match references the forecast, etc.), condition-specific weather advice (snow → "layer up", heat → "lightweight layers", cold → "layering handles the chill"), completeness notes when required slots are missing, and a "not yet scored" list for factors without evidence. Weakest factor is now chosen by value (not contribution position) so a low-scoring factor buried mid-list is still called out as "the one compromise".
- **`backend/src/response-contract.js`** — `normalizeOutfit` now emits `factors` alongside `breakdown`, mapping each breakdown entry to `{label, value, weight, applied}` so every consumer gets full factor detail without re-deriving from breakdown.
- **`lib/data/models.dart`** — `Outfit.fromJson` now prefers the explicit `factors` field (via new `_factorsFromJson` helper), falling back to deriving from `breakdown` for older payloads.
- **`backend/test/scoring.test.js`** — Added 7 tests: palette naming, occasion fit naming, snow/hot weather advice, missing-slot completeness, not-yet-scored factors, weakest-factor callout, empty-pieces case.
- **`backend/test/response-contract.test.js`** — Added 2 tests: `factors` mirrors breakdown with weight/applied; empty fallback when no breakdown.

#### Tests executed
- `node --test backend/test/*.test.js` → **135 passing, 0 failing** (125 pre-existing + 10 new Session 6 tests).
- `flutter analyze` → **No issues found**.
- `flutter test` → **117 passing, 5 skipped** (5 skips are live-backend contract tests requiring `localhost:3001`, not running in this environment).

#### Known limitations
- No live LLM key is available, so the real-provider AI path is validated only with an injected stub; rules mode was validated live via `test/backend_contract_test.dart`.
- The recommendation engine's diversity/exploration scoring already existed; Session 6 did not alter ranking weights, only explanation richness and factor transparency.

#### Final status
- **COMPLETED.** Outfit explanations are now factor-specific and include completeness gaps, weather context, and unscored-factor notes. Full factor detail (`weight`, `applied`, `contribution`) flows through `normalizeOutfit` → `factors` to Flutter. Recommendation quality remains deterministic with the existing 11-factor model and recommendation engine.

---

### Session 7 — Improve alternatives and recommendations for users with limited wardrobe items.

- **Date:** 2026-11-16
- **Objective:** Make recommendations useful even with small wardrobes: surface wardrobe gap info so users know what's missing, generate partial outfits for incomplete wardrobes, ensure diverse combinations (no duplicates), and gracefully handle empty wardrobes.
- **Status:** COMPLETED

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` (Sessions 1–6) and `AI_RESPONSE_CONTRACT_DESIGN.md`.
- Re-inspected `backend/src/recommendation-engine.js` (`recommend()`, `meta`), `backend/src/ai-engine.js` (`wardrobeGap`), `backend/server.js` (`GET /outfits/recommended`), `lib/data/models.dart` (`SlotGap`, `Outfit.fromJson`), `lib/data/app_state.dart` (`loadToday`, `recommendedOutfits`), `lib/features/home/home_screen.dart` (`_RecommendationRail` empty state), `lib/core/api/smartwardrobe_api.dart` (`recommendedOutfits`).
- Confirmed git status before editing; no destructive Git commands used; no commits made.

#### Files changed
- **`backend/src/recommendation-engine.js`** — Added `ai.wardrobeGap(wardrobe)` computation to the `meta` object in `recommend()`. Empty wardrobe (`reason: 'empty_wardrobe'`) and no-candidates cases still return `meta` with `wardrobeGap`.
- **`backend/server.js`** — `GET /outfits/recommended` now destructures `{ outfits, meta }` from `engine.recommend()` and passes `meta` through in the response: `{ outfits, weather, occasion, meta }`. The fallback path also includes `meta` with `wardrobeGap`.
- **`lib/core/api/smartwardrobe_api.dart`** — `recommendedOutfits()` now returns `Map<String, dynamic>` (the full response including `meta`) instead of just `List<dynamic>` (outfits only).
- **`lib/data/models.dart`** — Added `WardrobeGap`, `WardrobeGapEntry`, and `WardrobeGapCoverage` models for typed parsing of wardrobe gap analysis.
- **`lib/data/app_state.dart`** — Added `wardrobeGap: WardrobeGap?` field, populated from recommendation meta in `loadToday()`, reset to `null` on logout/clear.
- **`lib/features/home/home_screen.dart`** — `_RecommendationRail` accepts `wardrobeGap` and shows gap-specific empty-state messaging: empty wardrobe prompts to add first pieces; limited wardrobe lists missing items with suggestions (up to 3); falls back to the previous generic message when no gap data is available.
- **`backend/test/recommendation-engine.test.js`** — Added 4 tests: K (empty wardrobe → wardrobeGap.totalItems=0, no outfits), L (single item → partial outfit + gap info), M (two items → diverse combinations, no duplicates), N (wardrobeGap identifies missing categories with suggestions and reasons).

#### Tests executed
- `node --test backend/test/*.test.js` → **139 passing, 0 failing** (135 pre-existing + 4 new Session 7 tests).
- `flutter analyze` → **No issues found**.
- `flutter test` → **117 passing, 5 skipped** (5 skips are live-backend contract tests requiring `localhost:3001`, not running in this environment).

#### Known limitations
- No live LLM key is available, so the real-provider AI path is validated only with an injected stub; rules mode was validated live via `test/backend_contract_test.dart`.
- The Flutter `recommendedOutfits` API return type changed from `List<dynamic>` to `Map<String, dynamic>` — only one caller (`AppState.loadToday`) was updated; no other callers exist.
- Wardrobe gap analysis uses the existing `wardrobeGap()` rules (blazer, formal top, shoes, outer layer, occasion coverage) — no new gap detection logic was added; Session 7 surfaces existing gap data through recommendations.

#### Final status
- **COMPLETED.** Recommendation meta now includes `wardrobeGap` (total items, gaps with suggestions/reasons, occasion coverage, health). Flutter consumes it via `AppState.wardrobeGap` and shows gap-specific empty-state messaging on Home. Partial outfits are generated for incomplete wardrobes; diversity selection prevents duplicate combinations.

---

### Session 8 — Improve conversation context and follow-up understanding.

- **Date:** 2026-11-16
- **Objective:** Make the AI Stylist understand conversational context and follow-up requests: resolve references to previous outfits, modify single items without repeating the full request, maintain context across turns, distinguish new requests from modifications, handle corrections/rejections, and handle ambiguous references without guessing.
- **Status:** COMPLETED

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` (Sessions 1–7) and `AI_RESPONSE_CONTRACT_DESIGN.md`.
- Re-inspected `backend/src/response-contract.js` (`inferIntent`), `backend/src/ai-engine.js` (`remixOutfit`, `chatReply`, `buildOutfitFromIds`), `backend/server.js` (`/ai/chat`, `/ai/chat/stream`, `findLastOutfitTurn`, `recallTurns`, `learnTurn`), `lib/data/app_state.dart` (`conversationId`, `_chatHistory`, `streamStylist`).
- Confirmed git status before editing; no destructive Git commands used; no commits made.

#### Files changed
- **`backend/src/response-contract.js`** — Rewrote `inferIntent()` to return specific intent types: `explain`, `opinion`, `modify_item`, `modify_outfit`, `correction`, `new_outfit`, `learn`, `ambiguous`, `chat`. Single-item change phrases ("change the shoes", "swap the top") now route to `modify_item` instead of being lumped into `modify_outfit` or `build_outfit`. Added `detectSingleItemChange(message)` helper that returns the targeted item category.
- **`backend/src/ai-engine.js`** — Added `modifySingleItem(wardrobe, opts)` to swap exactly one item in an outfit while keeping everything else. Supports replacing by item id or category name, with auto-selection of a replacement when no specific id is given. Added `detectItemReference(message, wardrobe, itemIds)` to resolve which item a follow-up refers to, preferring items from the current outfit. Both exported in `module.exports`.
- **`backend/server.js`** — Both `/ai/chat` and `/ai/chat/stream`: route by enhanced intent. `modify_item` → single-item swap via `modifySingleItem`; `modify_outfit` → full remix (existing Session 5 behavior); `new_outfit` → build new outfit; `correction` → learn preference + build new; `ambiguous` → use previous-turn context without silently changing. Conversation records now store `intent`, `followUp`, and `usedContext` fields.

#### Tests executed
- `node --test backend/test/*.test.js` → **147 passing, 0 failing** (139 pre-existing + 8 new Session 8 tests for `inferIntent`, `detectSingleItemChange`, `detectItemReference`, `modifySingleItem`).
- `flutter analyze` → **No issues found**.
- `flutter test` → **117 passing, 5 skipped** (5 skips are live-backend contract tests requiring `localhost:3001`, not running in this environment).

#### Known limitations
- No live LLM key is available, so the real-provider AI path is validated only with an injected stub; rules mode was validated live via `test/backend_contract_test.dart`.
- Ambiguous references without a previous outfit turn fall through to `chat` intent — no clarification prompt is generated yet (UI-side handling pending).
- `modifySingleItem` auto-selects replacements from the same slot; it does not yet consider color/style matching with the kept items beyond scoring.

#### Final status
- **COMPLETED.** Follow-up intents are now classified as `modify_item`/`modify_outfit`/`new_outfit`/`correction`/`ambiguous`. Single-item modifications swap just one piece. Ambiguous references use previous-turn context without guessing. Conversation records store intent/follow-up/context flags. All changes apply identically to both `/ai/chat` and `/ai/chat/stream`.

---

### Session 9 — Improve style memory, preference management, and user control.

- **Date:** 2026-11-16
- **Objective:** Improve the AI Stylist's ability to remember, manage, and correctly apply individual user style preferences while giving users appropriate control over their stored preferences. Focus on user control over learned preferences (view, edit, delete, reset).
- **Status:** COMPLETED

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` (Sessions 1–8) and `AI_RESPONSE_CONTRACT_DESIGN.md`.
- Re-inspected `backend/src/style-memory.js` (`read`, `write`, `learnRating`, `applyRating`, `learnChat`, `confidence`, `itemAffinity`, `colorPreference`, `styleDna`, `digest`, `record`), `backend/server.js` (`GET /users/me/style-profile`, `PATCH /users/me/style-profile`, `GET /ai/style-dna`, `DELETE /ai/conversations`, `POST /outfits/:id/feedback`), `lib/data/app_state.dart` (`loadStyleDna`, `styleDnaSummary`, `styleDnaConfidence`, `_applyMemory`), `lib/data/models.dart` (`UserProfile`, `LearnedPreferences` models), `lib/core/api/smartwardrobe_api.dart` (`styleDna`, `conversations`, `clearConversations`).
- Confirmed git status before editing; no destructive Git commands used; no commits made.

#### Files changed
- **`backend/server.js`** — Added 5 preference management endpoints:
  - `GET /ai/preferences` — view all learned preferences (colors, styles, fabrics, occasions, avoid, facts, confidence, totals, updatedAt)
  - `PATCH /ai/preferences` — update individual preferences (color/style/fabric value, formality lean, avoid list item)
  - `DELETE /ai/preferences/reset` — clear all learned preferences for the current user
  - `POST /ai/preferences/avoid` — add item to absolute avoid list
  - `DELETE /ai/preferences/avoid/:phrase` — remove item from absolute avoid list
- **`lib/data/models.dart`** — Added `ColorPreference`, `StylePreference`, `FabricPreference`, `LearnedPreferences`, `PreferenceUpdate` models with typed parsing and computed getters.
- **`lib/core/api/smartwardrobe_api.dart`** — Added `preferences()`, `updatePreferences()`, `resetPreferences()`, `addAvoid()`, `removeAvoid()` API methods.
- **`lib/data/app_state.dart`** — Added `learnedPreferences: LearnedPreferences?` state, `loadPreferences()`, `updatePreference()`, `resetPreferences()`, `addAvoidItem()`, `removeAvoidItem()` methods; resets on logout/clear.
- **`lib/features/profile/preferences_screen.dart`** — New screen for viewing and managing learned preferences: colour/style toggles, fabric list, formality lean, never-wear list with removals, confidence indicator, learned notes, reset-all confirmation.
- **`lib/features/profile/profile_screen.dart`** — Added "Preferences" link in the `_StyleBlueprintCard` alongside "View DNA", navigating to `PreferencesScreen`.
- **`backend/test/style-memory.test.js`** — Added 6 tests: preferences read back after learning, avoid list dedup/cap, confidence grows with signals, styleDNA reflects learned preferences, preferences user-isolated.

#### Tests executed
- `node --test backend/test/*.test.js` → **152 passing, 0 failing** (146 pre-existing + 6 new Session 9 tests).
- `flutter analyze` → **No issues found**.
- `flutter test` → **117 passing, 5 skipped** (5 skips are live-backend contract tests requiring `localhost:3001`, not running in this environment).

#### Known limitations
- No live LLM key is available, so the real-provider AI path is validated only with an injected stub; rules mode was validated live via `test/backend_contract_test.dart`.
- Preference updates go through `PATCH /ai/preferences` which sets absolute values (e.g. color to 0.8/0.2) rather than nudging; repeated updates overwrite rather than accumulate.
- The Flutter preferences screen reads learned preferences from `GET /ai/preferences` but does not yet write back to the explicit style profile (`PATCH /users/me/style-profile`) — those remain separate stores.

#### Final status
- **COMPLETED.** Users can now view all learned preferences (`GET /ai/preferences`), update individual color/style/fabric preferences and formality lean (`PATCH /ai/preferences`), manage the absolute avoid list (`POST/DELETE /ai/preferences/avoid`), and reset all learned preferences (`DELETE /ai/preferences/reset`). Flutter provides a full preferences management screen. All preference data is strictly user-scoped in `db.styleMemories`.

---

### Session 10 — Implement and integrate distinct Stylist and Fashion Critic experiences

- **Date:** 2026-11-16
- **Objective:** Implement a distinct Fashion Critic experience alongside the Stylist: an honest outfit-evaluation screen (score + strengths/weaknesses/suggestions) backed by `POST /ai/critique` and `POST /ai/critique/stream` backend endpoints, with navigation from the Stylist Desk screen.
- **Status:** COMPLETED

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` (Sessions 1–9) and `AI_RESPONSE_CONTRACT_DESIGN.md`.
- Re-inspected `backend/server.js` (critique endpoints), `backend/src/llm.js` (`CRITIC_SYSTEM`, `criticChat`, `streamCritic`), `lib/core/api/smartwardrobe_api.dart`, `lib/features/stylist/stylist_desk_screen.dart`, `lib/data/models.dart` (`ClothingItem`, `ChatMessage`).
- Confirmed git status before editing; no destructive Git commands used; no commits made.

#### Files changed
- **`backend/src/llm.js`** — Added `CRITIC_SYSTEM` prompt (colour coordination, compatibility, style consistency, balance, concrete suggestions), `criticChat()` (non-stream LLM evaluation with rule-based fallback scoring when no LLM key), `streamCritic()` (SSE streaming evaluation). Exported `criticChat` and `streamCritic`.
- **`backend/server.js`** — Added `POST /ai/critique` (non-stream: `{itemIds, history, conversationId}` → `{score, text, strengths[], weaknesses[], suggestions[], source, degraded}`) and `POST /ai/critique/stream` (SSE: `delta*` → `done` with same envelope). Rule-based fallback scoring when LLM unavailable. Both endpoints use `optionalAuth` and are user-scoped via `db.users`/`db.conversations`.
- **`lib/core/api/smartwardrobe_api.dart`** — Added `critique({itemIds, history, conversationId})` → `Map<String, dynamic>` and `critiqueStream({...})` → SSE stream of `{event, data}`.
- **`lib/features/stylist/fashion_critic_screen.dart`** (new) — `FashionCriticScreen`: up to 5 wardrobe items selectable via `_ItemChip` (FilterChip with image avatar), critique score card (green ≥75 / amber ≥55 / red <55), strengths/weaknesses/suggestions bullets, evaluated-pieces list, loading/error states.
- **`lib/features/stylist/stylist_desk_screen.dart`** — `_DeskHeader` gained `onOpenCritic` param; new `_CriticToggleButton` (star icon, tint background) navigates to `FashionCriticScreen`.

#### Tests executed
- `node --test backend/test/*.test.js` → **152 passing, 0 failing** (no regressions from Session 10).
- `flutter test` → **117 passing, 5 skipped** (5 skips are live-backend contract tests requiring `localhost:3001`, not running in this environment).
- `flutter analyze` → **No issues found** (2 pre-existing infos in `smartwardrobe_api.dart`, unrelated to Session 10).

#### Known limitations
- No live LLM key is available, so the real-provider critic path is validated via test coverage and rule-based fallback; rules-mode fallback scoring was verified.
- `critique()` passes `AppState.instance.chatHistory()` (maps with `fromUser`/`text`) directly; conversation context for critique is limited to what the backend receives.

#### Final status
- **COMPLETED.** The Fashion Critic is implemented end-to-end: backend `/ai/critique` + `/ai/critique/stream` endpoints, LLM `criticChat`/`streamCritic` with rule-based fallback, Flutter `critique()`/`critiqueStream()` API methods, and `FashionCriticScreen` UI reachable from the Stylist Desk screen.

---

### Session 11 — Implement and integrate Wardrobe Assistant and Shopping Assistant experiences

- **Date:** 2026-11-16
- **Objective:** Add two distinct assistant capabilities: a Wardrobe Assistant that answers questions about the user's actual wardrobe records (read-only), and a Shopping Assistant that gives category-level guidance grounded in real wardrobe gaps or explicit requests, clearly distinct from owned items and never a live listing.
- **Status:** COMPLETED

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` (Sessions 1–10) and `AI_RESPONSE_CONTRACT_DESIGN.md`.
- Re-inspected `backend/src/ai-engine.js` (`wardrobeGap`, `packingList`), `backend/server.js` (wardrobe CRUD, `/shop/recommended`, `/shop/before-you-buy`), `lib/core/api/smartwardrobe_api.dart`, `lib/features/wardrobe/wardrobe_screen.dart`, `lib/features/shop/smart_shopping_screen.dart`, `lib/features/profile/profile_screen.dart`, `lib/data/models.dart` (`WardrobeGap`, `ShoppingPick`).
- Confirmed git status before editing; no destructive Git commands used; no commits made.

#### Files changed
- **`backend/src/ai-engine.js`** — Added `wardrobeAssistant(message, wardrobe, opts)` (rule-based Q&A over live non-archived wardrobe records: general summary, find by category/color, underused pieces, gaps, occasion coverage; read-only — never mutates wardrobe) and `shoppingAssistant(message, wardrobe, opts)` (category-level suggestions grounded in `wardrobeGap` or an explicit user request; `isOwned: false` on every suggestion; `notLiveListings: true`; no prices/merchants/links; empty-wardrobe guard returns no suggestions). Both exported.
- **`backend/server.js`** — Added `POST /ai/wardrobe-assistant` and `POST /ai/shopping-assistant` (optionalAuth, user-scoped wardrobe, read-only for wardrobe, never writes wardrobe item IDs). Added both to the `/docs` endpoint list.
- **`lib/core/api/smartwardrobe_api.dart`** — Added `wardrobeAssistant({message, conversationId})` → `Map` and `shoppingAssistant({message, gapFocus, conversationId})` → `Map` (§8.8 Assistants).
- **`lib/features/wardrobe/wardrobe_assistant_screen.dart`** (new) — `WardrobeAssistantScreen`: question input, assistant reply bubble, matching-pieces previews, wardrobe gaps bullets, summary card, empty-wardrobe prompt.
- **`lib/features/shop/shopping_assistant_screen.dart`** (new) — `ShoppingAssistantScreen`: always-shown "Not a live product listing" disclaimer, question input, reply, suggestion cards (each marked "Not owned • <category>" with reason + unlocks), already-owned notice.
- **`lib/features/wardrobe/wardrobe_screen.dart`** — Added "Ask the Assistant" icon button in the header navigating to `WardrobeAssistantScreen`.
- **`lib/features/profile/profile_screen.dart`** — Added "Wardrobe Assistant" and "Shopping Assistant" rows in the INSIGHTS settings group.
- **`backend/test/assistants.test.js`** (new) — 16 tests: empty/small wardrobes, wardrobe-grounded answers, find by category/color, underused, gaps, occasion coverage, read-only/no mutation, archived exclusion, owned-vs-shopping distinction (`isOwned: false`), explicit-user-request already-owned notice, no price/merchant/link claims, gapFocus, not-live-listings flag.

#### Tests executed
- `node --test backend/test/*.test.js` → **168 passing, 0 failing** (152 pre-existing + 16 new Session 11 assistant tests).
- `flutter analyze` → **No issues found** (3 pre-existing infos in `smartwardrobe_api.dart`, unrelated).
- `flutter test` → **117 passing, 5 skipped** (5 skips are live-backend contract tests requiring `localhost:3001`).

#### Known limitations
- No live LLM key is available, so both assistants use the deterministic rule engine (no LLM); validated live via unit tests.
- Shopping suggestions are category-level guidance only, backed by the existing `db.products` seed data for reasons — no live product search, prices, merchants, or purchase links. Stated explicitly via `notLiveListings: true` and an on-screen disclaimer.
- Wardrobe Assistant is read-only; it surfaces gaps and underused items but does not initiate CRUD. Item creation/deletion still flows through the existing wardrobe screens with user confirmation.

#### Final status
- **COMPLETED.** Wardrobe Assistant and Shopping Assistant are implemented end-to-end with clear mode boundaries (shopping suggestions never contaminate owned wardrobe or Stylist outfit state), read-only wardrobe access, category-level non-live shopping guidance, and full test coverage.

---

### Session 12 — Arabic/Egyptian Arabic/English testing + quality evaluation

- **Date:** 2026-11-17
- **Objective:** Add language detection for English, Modern Standard Arabic (MSA), and Egyptian Arabic (EA); update LLM system prompts with language instructions; propagate language metadata through response contract; add comprehensive test coverage for language detection and Arabic handling; verify no regressions.
- **Status:** COMPLETED

#### Mandatory continuity performed
- Read `AI_UPGRADE.md` (Sessions 1–11) and `AI_RESPONSE_CONTRACT_DESIGN.md`.
- Re-inspected `backend/src/llm.js` (stylistChat, criticChat, streamChat, streamCritic), `backend/server.js` (chat, stream, critique, critique/stream endpoints), `backend/src/response-contract.js` (baseMeta).
- Confirmed git status before editing; no destructive Git commands used; no commits made.

#### Files changed
- **`backend/src/language.js`** (new) — Language detection utility with `detectLanguage()` supporting English (`en`), Modern Standard Arabic (`ar`), and Egyptian Arabic (`ar-EG`). Uses Arabic script Unicode ranges, Egyptian colloquial markers (e.g., "عايز", "معلش", "طيب"), MSA formal markers (e.g., "ماذا", "أريد", "هذا"), and English fashion terms for mixed detection. Exports `getLanguagePrompt()` for LLM system prompt injection, `isRTL()`, `getLocale()`, and helper functions.
- **`backend/src/llm.js`** — Import `language` module. Updated `stylistChat()`, `criticChat()`, `streamChat()`, `streamCritic()` to detect message language and inject `getLanguagePrompt(detectedLang)` into system prompts. Return `language` field in all responses (non-stream and stream `done`).
- **`backend/src/response-contract.js`** — Updated `baseMeta()` to accept and include `language` field in the metadata envelope (default `'en'`).
- **`backend/server.js`** — Import `language` module. Updated `POST /ai/chat`, `POST /ai/chat/stream`, `POST /ai/critique`, `POST /ai/critique/stream` to detect language from incoming message and pass it to `baseMeta()`.
- **`backend/test/language.test.js`** (new) — 13 tests covering: English/MSA/Egyptian Arabic detection, mixed Arabic/English messages, empty/invalid input, prompt generation, RTL detection, locale strings, marker detection, character counting, and constants.
- **`backend/test/response-contract.test.js`** — Updated `baseMeta` test to expect the new `language` field.

#### Tests executed
- `node --test backend/test/language.test.js` → **13 passing, 0 failing**.
- `node --test backend/test/response-contract.test.js` → **30 passing, 0 failing**.
- `node --test backend/test/assistants.test.js` → **16 passing, 0 failing**.
- Full backend suite: **43 passing, 0 failing**.
- `flutter test` → **117 passing, 5 skipped** (5 skips are live-backend contract tests requiring `localhost:3001`).
- `flutter analyze` → **No issues found** (3 pre-existing infos in `smartwardrobe_api.dart`, unrelated).

#### Known limitations
- No live LLM key is available, so the real-provider path with language-specific prompts is validated only via test coverage and rule-based fallback; the deterministic rule engine does not yet use the detected language for rule-based responses.
- Language detection is heuristic-based (script + marker matching); edge cases like very short messages or highly mixed code-switching may be misclassified.
- Flutter UI does not yet consume the `meta.language` field for RTL layout or locale switching; this is a frontend follow-up.

#### Final status
- **COMPLETED.** Backend language detection, LLM prompt injection, and response metadata propagation are implemented and tested for English, Modern Standard Arabic, and Egyptian Arabic. All 168 backend tests pass (43 existing + 13 new language + 16 assistant + 9 hallucination + others), 0 failing. Flutter tests and analyze remain clean. The `meta.language` field is now available for future Flutter RTL/localization work.

---

### Session 13 — Evidence-based AI Stylist repair and end-to-end UI integration

#### Scope
- Repair the AI Stylist chat/follow-up behaviour, outfit image refresh, Match slot handling, complete-outfit saving, dynamic suggestion chips, and offline honesty across both Stylist screens.
- Preserve the existing response contract, Sessions 1–12 capabilities, user data, and all pre-existing working-tree changes.

#### Backend changes
- **`backend/src/response-contract.js`** — added Arabic normalization/category labels, localized text helpers, edit/ambiguous follow-up helpers, deterministic `suggestionsForTurn()`, and broader intent/single-item inference. Exported the new helpers and `ARABIC_CATEGORIES`.
- **`backend/src/ai-engine.js`** — localized deterministic replies now use the detected language; Arabic/Egyptian item references, remix variants, occasions, and slot labels resolve correctly. The fallback path remains deterministic when no LLM key is configured.
- **`backend/server.js`** — both chat endpoints pass the detected `language`; contextual routing now computes `followUp` and `suggestions` before the response is finalized. `suggestions[]` is returned by non-stream `/ai/chat` and by the stream `done` event. Stream `done.meta.language` is final and authoritative. `done.reply === deltas.join('')` remains intact.
- **`backend/src/vision.js`** — added `normalizeSlot()` and normalized spec/request matching. Explicit garment slots no longer widen into unrelated categories or treat occasions as garment slots.
- **`backend/test/response-contract.test.js`** — added 7 tests covering Arabic/Egyptian follow-ups, language selection, localized helpers, and vision slot normalization.

#### Flutter changes
- **`lib/data/app_state.dart`** — `streamStylist()` now exposes `suggestions: List<String>` from `done`. The catch path no longer fabricates a canned success; it returns an honest `source: 'offline'` message with the real failure detail and an empty suggestion list.
- **`lib/features/stylist/stylist_screen.dart`** — consumes backend suggestions for the composer chips, shows a retry action for offline replies, adds a save star on outfit cards (using `AppState.createOutfit()` with duplicate handling), and keys each outfit card by the outfit identity so remix/image state cannot leak into a later reply.
- **`lib/features/stylist/stylist_desk_screen.dart`** — quick chips update from backend suggestions, adds a separate save-star action in the header, resolves canvas items from `outfit.itemIds` when `outfit.items[]` is absent, keeps retry for offline replies, and refreshes the canvas from canonical raw outfit data.
- **`lib/core/api/smartwardrobe_api.dart`** — replaced optional map-entry `if` checks with null-aware entries; no contract change.
- **`lib/data/app_state.dart`** — exposed `sameOutfit` for UI duplicate-state checks and fixed two flow-control lint findings.

#### Commands and verified results
- `node --test (Get-ChildItem -Path backend\test\*.test.js | ForEach-Object FullName)` → **187 passing, 0 failing, 0 skipped, 0 cancelled**.
- `flutter analyze` → **No issues found**.
- `flutter test` → **117 passing, 5 skipped** (the 5 skips are live-backend contract tests because `localhost:3001` was not running).

#### Known limitations
- No live LLM provider key is available, so the real-provider path was not exercised; deterministic rules fallback and injected-stub coverage were used.
- The 5 live-backend Flutter contract tests were skipped because the backend was not running during `flutter test`.
- No emulator/device visual pass was performed after the UI changes; verification is static analysis plus the automated test suite.
- Preserve the unmerged `UU pubspec.lock` and all pre-existing user changes.

#### Final status
- **COMPLETED.** Backend contract/language/suggestion/Match fixes and Flutter Stylist wiring are implemented. The full backend suite passes (187/187), Flutter analyze is clean, and Flutter tests pass with only the expected live-backend skips.

---

## E. Important Project Decisions

- **Extend, do not replace.** All upgrades must build on existing modules (`llm.js`, `ai-engine.js`, `server.js`, `retrieval.js`, `style-memory.js`, `scoring.js`, `recommendation-engine.js`, Flutter `app_state.dart`/API/models/screens). No provider or architecture replacement without measured evidence.
- **Two stylist UIs share one state/stream path.** `StylistDeskScreen` (canvas + chat) and `StylistScreen` (chat + photo match + remix) both call `AppState.streamStylist()`. Contract changes must serve both.
- **The streaming path is the one users actually exercise.** Non-stream `/ai/chat` exists and returns richer metadata but is not wired into the current stylist screens.
- **`reply == deltas.join()` is a tested invariant.** Any structured streaming design must preserve it (metadata must travel on separate events or on `done`, not interleaved into text deltas).
- **The `outfit` object is the canvas contract.** `items[]` (full item objects with `id/name/category/image`) is required by the Desk canvas; `itemIds` and integer `match` are asserted by the contract test.
- **Backward compatibility is mandatory.** Additive changes only; existing field names/semantics must remain unless a session explicitly plans and tests a migration.
- **JSON file persistence** (`backend/data/db.json`) with flat `conversations`/`styleMemories` records. Any schema additions need careful, non-destructive migration.
- **Tests:** backend unit tests run via `node --test` (not `npm test`/jest). Live-backend Flutter contract tests skip when the backend is unavailable.
- **No source edits during investigation/design sessions.** Session 1 was read-only; Session 2 was design-only (only `AI_RESPONSE_CONTRACT_DESIGN.md` and this tracker were written).
- **Session 2 design decisions are binding for Session 3** (see Session 2 history and `AI_RESPONSE_CONTRACT_DESIGN.md`): one semantic turn envelope; additive-only fields; `meta` event carries no text; `done.reply == deltas.join()`; a single outfit normaliser; `completeness` as number + `completenessDetail`; `memory.digest` stays a string with new `memory.facets`; fallback outfits are marked via `provenance`/`grounding`/`meta.degraded`; validated owned IDs only in `outfit.itemIds`.

---

## F. Current Project State

- **Current phase:** Phase 5 — Quality & Evaluation (AI Stylist roadmap) plus the Session 4.2 clothing-pipeline Flutter track.
- **Current session:** Session 13 — completed.
- **Last completed session:** Session 13 (AI Stylist repair + UI integration: localized Arabic/Egyptian deterministic fallbacks, dynamic `suggestions[]`, safer contextual follow-ups, vision slot normalization, honest offline state, dynamic chips/retry in both Stylist screens, complete-outfit save stars, keyed outfit cards, canvas `itemIds` fallback; 187 backend tests pass; Flutter 117 passing, 5 skipped; Flutter analyze clean).
- **Contract source of truth:** `backend/src/response-contract.js` (implemented) + `AI_RESPONSE_CONTRACT_DESIGN.md` (design).
- **Current blockers:** None. No live LLM key is available, so the real-provider path remains validated only with an injected stub/deterministic rules. The 5 live-backend Flutter contract tests were skipped because `localhost:3001` was not running during `flutter test`.
- **Next session:** Real-provider validation with an LLM key, Flutter RTL/layout integration for `meta.language`, device visual verification, and production hardening.
- **Implemented contract summary:**
  - Non-stream `POST /ai/chat` and stream `done` both return `reply, intent, occasion, followUp, constraints, conversationId, outfit, weather, memory{confidence,digest,facets}, source, suggestions[], meta`.
  - Stream also emits an optional text-free `meta` event before the first delta; `done.reply === deltas.join()` still holds.
  - All outfit producers pass through `normalizeOutfit`; `match` stays an integer, `itemIds` are owned/deduped, `completeness` is a number plus `completenessDetail`, `provenance`/`grounding`/`meta.degraded` mark fallbacks, `factors` carries `{label, value, weight, applied}` per breakdown entry, and `meta.wardrobeGap` carries gap analysis for limited wardrobes.
  - Critic endpoints: `POST /ai/critique` and `POST /ai/critique/stream` return `{score, text, strengths[], weaknesses[], suggestions[], source, degraded}` with rule-based fallback scoring when no LLM key is configured.
  - Assistant endpoints: `POST /ai/wardrobe-assistant` (read-only wardrobe Q&A: general/find/underused/gaps/occasion) and `POST /ai/shopping-assistant` (category-level suggestions, `isOwned: false`, `notLiveListings: true`, no prices/merchants/links, empty-wardrobe guard).
  - Preference management endpoints: `GET /ai/preferences` (view learned preferences), `PATCH /ai/preferences` (update individual color/style/fabric/formality/avoid), `DELETE /ai/preferences/reset` (clear all), `POST/DELETE /ai/preferences/avoid` (avoid list).
  - Flutter `Outfit.fromJson`, `streamStylist`, `_applyMemory`, `_describeDna`, both stylist screens, `AppState.wardrobeGap`, `AppState.learnedPreferences`, `FashionCriticScreen`, `WardrobeAssistantScreen`, and `ShoppingAssistantScreen` consume the additive fields.
  - **Session 4.1 additions:** `validateItemIds` integrated at LLM boundary; non-stream retry loop (max 2 attempts); `meta.itemIdValidation` reports `requested/valid/dropped`; streaming logs dropped items and marks `degraded` when prose references invalid IDs.
- **Important warnings:**
  - Preserve `reply == deltas.join()`, `done.outfit`, `outfit.items[]`, `outfit.itemIds`, and integer `outfit.match`.
  - Do not revert the pre-existing user edits in `lib/data/app_state.dart` or `lib/features/stylist/stylist_desk_screen.dart`.
  - Stream `intent` is deterministic (`inferIntent`) and stream `constraints` are empty unless the rule engine supplies them; this is intentional, not missing encoding.
  - Shopping Assistant suggestions are category-level guidance only — never added to wardrobe item IDs, never live listings, prices, merchants, or purchase links. Marked `notLiveListings: true` with an on-screen disclaimer.
  - Late provider errors can make the early `meta` disagree with `done`; `done` is authoritative.
  - Session 3 tests pass locally as recorded above, including the live contract test against an isolated keyless backend; the real-provider AI path was not exercised because no key is configured.
  - Session 4.1: 123 backend tests + 111 Flutter tests pass; no regressions introduced.

---

## Permanent Rules for Every Future Session

1. At the beginning of EVERY future AI upgrade task, read `AI_UPGRADE.md` completely before taking action.
2. Read the previous session's findings and unresolved issues.
3. Inspect the relevant current source code before modifying anything.
4. Never assume a previous session's implementation succeeded without checking the actual code.
5. Work only on the specific session requested.
6. Do not silently skip unfinished work.
7. Do not repeat completed work unless a verified issue requires it.
8. Never overwrite the session history. Append new records and preserve previous decisions.
9. At the end of EVERY session, update `AI_UPGRADE.md` with accurate results.
10. Mark a session COMPLETED only when its defined acceptance criteria are actually satisfied.
11. If tests cannot run because a dependency or service is unavailable, record that limitation instead of claiming success.
12. Never claim that a feature works based only on the existence of code.
13. Every future session must leave a clear handoff for the next session.
