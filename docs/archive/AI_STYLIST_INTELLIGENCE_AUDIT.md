# AI Stylist Intelligence Audit

**Date:** 2026-11-16  
**Scope:** READ-ONLY audit of existing AI Stylist intelligence, response quality, architecture, and integration in `D:\Clothes_X2-main\Clothes_X2-main`  
**Report file:** `AI_STYLIST_INTELLIGENCE_AUDIT.md` (created for this audit)

---

## 1. Executive Summary

The project already contains a substantial AI Stylist foundation across Flutter (`lib/features/stylist/*`, `lib/data/app_state.dart`, `lib/core/api/*`) and the Express backend (`backend/server.js`, `backend/src/llm.js`, `backend/src/ai-engine.js`, `backend/src/retrieval.js`, `backend/src/style-memory.js`, `backend/src/scoring.js`, `backend/src/recommendation-engine.js`, `backend/src/vision.js`). Core building blocks for wardrobe-grounded chat, streaming, outfit generation/scoring, learned style memory, outfit remixing, and photo-to-wardrobe matching exist in code.

However, the implemented intelligence is **fragmented and unevenly exposed**: `StylistDeskScreen` provides the most modern chat/canvas UX but relies mainly on plain streamed text plus `outfit` payloads for canvas updates; `StylistScreen` exposes richer actions (photo match, remix chips, follow-up/source display) but has a simpler conversation UX. Several "advanced" capabilities are backend-implemented but not consistently structured for reliable frontend rendering or for clear user-facing modes (Stylist/Critic/Wardrobe/Shopping). Persistent, user-editable fashion preferences are not clearly separated from learned/inferred memory and conversation history. Critical product-quality concerns remain around structured outputs, explicit intent handling, explainability consistency, Arabic/Egyptian Arabic support evidence, robust context isolation/validation, and automated evaluation of prompt/response behavior.

**Overall assessment:** strong prototype/early-product AI architecture with real scoring/retrieval/memory primitives, but **not yet a fully reliable, explainable, mode-driven "AI Personal Stylist"**. Most improvements should extend existing modules (`llm.js`, `ai-engine.js`, `server.js`, `stylist_desk_screen.dart`, `app_state.dart`) rather than replace providers or rebuild systems.

---

## 2. Existing AI Architecture

### 2.1 Frontend (Flutter)
- **State & orchestration:** `lib/data/app_state.dart`
  - Auth/session/profile, wardrobe/outfits/planner/shopping/weather loading, backend-online/offline tracking.
  - Stylist conversation state: `_conversationId`, `_chatHistory` (in-memory, capped to 60 turns), `resetConversation()`, `chatHistory({limit})`.
  - AI calls: `askStylist()` (`POST /ai/chat`), `streamStylist()` (`POST /ai/chat/stream` SSE), `matchOutfitPhoto()` (`POST /ai/match-outfit`), `remixOutfit()` (`POST /ai/remix`), `loadStyleDna()` (`GET /ai/style-dna`), `compatibility()`.
  - Offline fallback: `_offlineReply()` from `MockData.stylistReplies` / `stylistFallback`.
- **API client:** `lib/core/api/api_client.dart`, `lib/core/api/smartwardrobe_api.dart`, `lib/core/api/api_config.dart`
  - JSON HTTP methods, multipart uploads, SSE stream parsing for `chatStream()`.
  - Typed methods for analyze/generate/compatibility/chat/chatStream/match/remix/styleDna/conversations/capabilities/recommended outfits/etc.
- **Data models:** `lib/data/models.dart`
  - `ClothingItem`, `Outfit`, `MatchFactor`, `ChatMessage`, `OutfitMatch`, `SlotMatch`, `SlotGap`, `UserProfile`, etc.
- **UI surfaces:**
  - `lib/features/stylist/stylist_desk_screen.dart`: split canvas+chat experience, local canvas drag/replace, welcome suggestions, streaming bubble, markdown rendering, quick chips, canvas sync from `outfitRaw`.
  - `lib/features/stylist/stylist_screen.dart`: conversational screen with photo-match flow (`ImagePicker` + `matchOutfitPhoto`), outfit suggestion cards with remix chips, follow-up/source/typing indicators.
  - Canvas/wardrobe integration also exists in other outfit/planner flows (not fully audited here), while Stylist Desk uses `AppState.instance.api.generateOutfit` and `AppState.instance.api.wardrobeItems(category:...)`.

### 2.2 Backend (Node/Express runtime + AI modules)
- **HTTP server/routes:** `backend/server.js`
  - Auth/users/wardrobe/uploads/events/planner/shopping/admin/misc plus AI routes: `/ai/analyze-clothing`, `/ai/generate-outfit`, `/ai/calculate-compatibility`, `/ai/style-profile`, `/ai/wardrobe-gap`, `/ai/packing-list`, `/ai/chat`, `/ai/chat/stream`, `/ai/match-outfit`, `/ai/remix`, `/ai/style-dna`, `/ai/conversations`, `/ai/capabilities`.
  - Context assembly `stylistContext()`: wardrobe, memory, weather, detected occasion, retrieval shortlist.
  - Chat pipeline: retrieve → LLM/rule fallback → validate ids/build outfit → learn from message/memoryNotes → persist turn → respond.
  - Streaming: SSE deltas + final `done`; fallback synthesis and mentioned-id recovery.
  - Conversation persistence in `db.conversations` (flat turns); style memory in `db.styleMemories`; outfits/feedback/rating endpoints also present.
- **LLM/provider abstraction:** `backend/src/llm.js`
  - Providers: Gemini/Groq/OpenRouter/OpenAI via OpenAI-compatible chat completions; model rotation/fallback chain; optional vision.
  - `stylistChat()` requests structured JSON (`text,intent,occasion,itemIds,constraints,followUp,memoryNotes`) with history, weather, style profile, memory digest, events, catalog lines.
  - `streamChat()` streams plain prose (not JSON) with history/memory/catalog context.
  - `parseJson()` tolerant extraction; `analyzeImage`, `describeOutfit` present later in file (partially inspected).
- **Core reasoning/engines:** `backend/src/ai-engine.js`
  - Rule-based chat fallback, occasion detection, beam-search outfit generation, stable generated IDs, outfit naming, compatibility/explanation delegation, remix targets/logic, wardrobe gap/packing helpers.
- **Retrieval:** `backend/src/retrieval.js`
  - Two-stage category-balanced shortlist over wardrobe; lexical fallback and optional local embeddings (`@huggingface/transformers`, MiniLM) with vector cache and warmup/status.
- **Learned memory:** `backend/src/style-memory.js`
  - Per-user preference store (colors/styles/fabrics/adjustments/avoid/facts/itemRatings/totals), rating/chat learning, hard exclusions, replace-semantics rating application, digest/style-DNA/confidence/factor weighting helpers.
- **Scoring:** `backend/src/scoring.js`
  - 11-factor compatibility model with signal-aware renormalization, completeness gate/cap, calibration, explanation generation.
- **Recommendation engine:** `backend/src/recommendation-engine.js`
  - Hard constraints, generator+retrieval+profile+freshness+learned-affinity scoring blend, diversity/exploration, deterministic ranking, separates compatibility vs ranking scores.
- **Vision/matching:** `backend/src/vision.js` (present, not fully read in this pass) used by `/ai/match-outfit` and vision-related flows.
- **Persistence/runtime data:** `backend/data/db.json` (seeded JSON store per README); local model cache under `backend/.model-cache/`.

### 2.3 Other/adjacent AI service
- **`ai-service/main.py` + `requirements.txt` (FastAPI, Python):** present in repo and referenced by README/server env (`AI_SERVICE_URL`) as optional/legacy mirror subset. Not inspected deeply in this audit; current main flows primarily use embedded Node modules.

---

## 3. Actual AI Request and Response Flow

### 3.1 Stylist Desk chat (primary modern UI)
1. **UI:** `StylistDeskScreen._send()` appends user message + sets streaming state (`lib/features/stylist/stylist_desk_screen.dart:372-384`).
2. **State/API:** `AppState.streamStylist()` sends `POST /ai/chat/stream` via `SmartWardrobeApi.chatStream()` with `message`, `history=chatHistory()`, `conversationId` (`lib/data/app_state.dart:1134-1184`, `lib/core/api/smartwardrobe_api.dart:235-244`, `lib/core/api/api_client.dart:61-127`).
3. **Backend stream:** `server.js` `/ai/chat/stream` resolves stylist context (`stylistContext`), streams LLM prose deltas when configured, falls back to rule engine on missing key/error/empty stream, synthesizes an outfit by recovering mentioned IDs or generating one, learns durable preferences, persists conversation turn, emits final `done` with reply/outfit/weather/memory/source/intent (`backend/server.js` ~973+ inspected sections).
4. **Frontend handling:** deltas update `_streaming` notifier (live bubble), final result appended as `ChatMessage` with `source/outfit`, `outfitRaw` applied to canvas via `_applyOutfit()` (resets arrangement and rebuilds items), scroll behavior managed (`stylist_desk_screen.dart:386-425, 474-528, 552-606`).
5. **Offline:** network/API failure in `AppState.streamStylist()` returns bundled offline reply (`source: offline`, no outfitRaw) and records turn locally.

### 3.2 Stylist Screen chat (alternate UI)
- `StylistScreen._send()` uses same `AppState.streamStylist()` but keeps a placeholder assistant bubble updated with text deltas and finalizes with `outfit/source/followUp`-capable model shape (`lib/features/stylist/stylist_screen.dart:50-87`).
- Supports photo match action: gallery pick → `AppState.matchOutfitPhoto()` → `POST /ai/match-outfit` → renders `_MatchResultCard` and summary (`stylist_screen.dart:89-158, 547-671`).
- Outfit suggestion cards can call `POST /ai/remix` via `AppState.remixOutfit()` and display remixed explanation/note (`stylist_screen.dart:400-543`, `app_state.dart:1213-1226`).

### 3.3 Non-stream chat endpoint
- `POST /ai/chat` in backend performs structured LLM call (`llm.stylistChat`) when configured, validates/builds outfit from returned IDs, falls back to rule engine, learns/persists turn, returns reply/outfit/followUp/intent/occasion/constraints/weather/memory/source (`backend/server.js` ~874-965). Flutter exposes via `AppState.askStylist()`/`api.chat()` but Stylist Desk currently prefers streaming.

### 3.4 Outfit generation/recommendation/scoring
- **Generation:** `POST /ai/generate-outfit` uses `ai.generateOutfits()` (beam search in `ai-engine.js`) with memory/weather/profile context (`backend/server.js` ~682-699 area; `ai-engine.js` inspected).
- **Recommendations:** `GET /outfits/recommended` delegates to `recommendation-engine.recommend()`; Home loads via `AppState.loadToday()`/`api.recommendedOutfits()` (`app_state.dart:929-973`, `api:327-334`, `server.js` ~1263+).
- **Compatibility:** `POST /ai/calculate-compatibility` uses `scoring.scoreOutfit()` with 11-factor breakdown and context (`server.js` ~701-715, `scoring.js`).

### 3.5 Memory and persistence
- **Learned memory:** mined from chat (`learnTurn`/`memoryStore.learnChat`), and from ratings/feedback in rating/outfit flows; stored in `db.styleMemories` (`server.js`, `style-memory.js`).
- **Conversation recall:** backend recalls recent turns per user/conversation when client omits history; also stores turns in `db.conversations` (`server.js` `recallTurns`, push/cap logic).
- **Client memory:** `AppState._chatHistory` and `_conversationId` are in-memory only (reset on process/account reset); style DNA summary/confidence cached in AppState after loads/turns.

---

## 4. Existing Implemented Capabilities

| Feature name | Status | Evidence (code) | What currently happens | Priority | Complexity | Dependencies |
|---|---|---|---|---|---|---|
| AI stylist chat (rule + optional LLM providers) | IMPLEMENTED BUT NOT FULLY VERIFIED | `backend/server.js` (`/ai/chat`, `stylistContext`, fallback), `backend/src/llm.js` (`status`, `stylistChat`, `withModelRotation`), `lib/data/app_state.dart` (`askStylist`) | Returns reply grounded in shortlist/history/memory when configured; falls back to rule engine or offline mocks on failure. | High | Medium | LLM key/config for LLM path; runtime verification |
| Streaming chat responses (SSE) | IMPLEMENTED BUT NOT FULLY VERIFIED | `backend/server.js` (`/ai/chat/stream`), `lib/core/api/api_client.dart` (`streamPost`), `smartwardrobe_api.dart` (`chatStream`), `app_state.dart` (`streamStylist`), `stylist_desk_screen.dart` / `stylist_screen.dart` | Deltas streamed to UI; final `done` payload includes assembled reply/outfit/memory/source metadata; UI shows typing/streaming state. | High | Medium | Stable backend SSE behavior |
| Wardrobe-grounded outfit generation (beam search) | IMPLEMENTED BUT NOT FULLY VERIFIED | `backend/src/ai-engine.js` (`generateOutfits`, `beamSearch`, `rankSlot`, `remixOutfit`), `backend/server.js` (`/ai/generate-outfit`) | Generates outfits from live wardrobe with climate/occasion/memory/rotation/diversity logic and completeness-aware scoring. | High | High | Quality wardrobe metadata |
| Retrieval-based wardrobe shortlist for chat | IMPLEMENTED BUT NOT FULLY VERIFIED | `backend/src/retrieval.js`, `backend/server.js` (`stylistContext`, `retrieval.rank`), `backend/README.md` | Category-balanced ranked shortlist (embeddings or lexical fallback) replaces naive slicing; status/diagnostics exposed. | High | Medium | Optional embedding model availability |
| 11-factor compatibility scoring & explanation | IMPLEMENTED BUT NOT FULLY VERIFIED | `backend/src/scoring.js` (`scoreOutfit`, `explain`, `completeness`, `BASE_WEIGHTS`), `backend/server.js` (`/ai/calculate-compatibility`) | Computes weighted factors with signal-aware renormalization, completeness cap, calibrated score, and derived explanations. | High | High | Correct context inputs/profile/memory |
| Recommendation engine with constraints/diversity/exploration | IMPLEMENTED BUT NOT FULLY VERIFIED | `backend/src/recommendation-engine.js`, `backend/server.js` (`/outfits/recommended`), `lib/data/app_state.dart` (`loadToday`) | Applies hard constraints, blends compatibility/retrieval/profile/freshness/affinity, selects diverse results, preserves compatibility vs ranking score semantics. | High | High | Stable upstream generation/scoring |
| Learned style memory from chat and ratings | IMPLEMENTED BUT NOT FULLY VERIFIED | `backend/src/style-memory.js`, `backend/server.js` (`learnTurn`, rating/feedback flows, `/ai/style-dna`) | Stores per-user inferred preferences, exclusions, facts, item ratings, confidence/digest; feeds scoring/retrieval/generation context. | High | High | Consistent user identity/auth |
| Style DNA endpoint and client loading | IMPLEMENTED BUT NOT FULLY VERIFIED | `backend/server.js` (`GET /ai/style-dna`), `backend/src/style-memory.js` (`digest`, `styleDna`), `lib/data/app_state.dart` (`loadStyleDna`, `_describeDna`) | Backend returns digest/style DNA; client stores summary/confidence text for use in UI/state. | Medium | Low | Auth/session, UI surfacing |
| Outfit remix variants | IMPLEMENTED BUT NOT FULLY VERIFIED | `backend/src/ai-engine.js` (`remixOutfit`, targets), `backend/server.js` (`POST /ai/remix`), `lib/core/api/smartwardrobe_api.dart` (`remix`), `stylist_screen.dart` remix chips | Re-dresses an existing outfit for casual/cold/summer/date/formal while preserving viable pieces where possible. | Medium | Medium | Valid item IDs, wardrobe availability |
| Photo-to-wardrobe outfit matching | IMPLEMENTED BUT NOT FULLY VERIFIED | `backend/server.js` (`POST /ai/match-outfit`), `backend/src/vision.js` (module present), `lib/data/app_state.dart` (`matchOutfitPhoto`), `lib/data/models.dart` (`OutfitMatch`), `lib/features/stylist/stylist_screen.dart` (`_matchPhoto`, `_MatchResultCard`) | Accepts image/note, returns matched slots/gaps/similarity and optional outfit; UI renders summary and slot rows. | High | High | Vision model/LLM capability, runtime assets |
| Stylist Desk canvas integration (outfit apply + drag + replace) | IMPLEMENTED BUT NOT FULLY VERIFIED | `lib/features/stylist/stylist_desk_screen.dart` (`_loadInitialOutfit`, `_applyOutfit`, `_showReplacementSheet`, `_replaceItem`, drag handlers) | AI-generated outfit populates canvas; user can rearrange items and replace same-category garments from real wardrobe. | High | Medium | Correct outfit payload items/images |
| Offline/fallback behavior in client | IMPLEMENTED BUT NOT FULLY VERIFIED | `lib/data/app_state.dart` (`_offlineReply`, `_markOffline`, fallback paths), `lib/features/stylist/stylist_desk_screen.dart` error/loading states, `backend/src/llm.js` rule fallback behavior | App can continue with bundled/mock replies and cached/demo data paths when backend/LLM unavailable. | Medium | Low | Mock data coverage |

---

## 5. Partially Implemented Capabilities

| Feature name | Status | Evidence (code) | What currently happens | What is missing/problematic | Recommended improvement | Priority | Complexity | Dependencies |
|---|---|---|---|---|---|---|---|---|
| Wardrobe-grounded conversational styling (end-to-end) | PARTIALLY IMPLEMENTED | `stylistContext()` uses `db.wardrobe` + retrieval (`server.js`), `streamChat/stylistChat` include catalog (`llm.js`), Desk renders plain text + applies `outfitRaw` (`stylist_desk_screen.dart`) | Backend grounds replies in shortlist and can return outfits; Desk mainly shows text/markdown and a canvas-updated chip. | No consistent structured response contract in UI (items, reasons per item, owned vs missing, alternatives, confidence). Stream path returns prose, not structured JSON. | Define and use a stable response schema (reply + intent + outfit + item reasons + gaps + follow-ups) for both stream and non-stream; render progressively in Desk. | High | High | Backend/frontend contract alignment |
| Explainable recommendations | PARTIALLY IMPLEMENTED | `scoring.js` (`explain`, breakdown), `models.dart` (`Outfit.explanation/breakdown/factors`), `ai-engine.js`/`recommendation-engine.js` attach explanations | Explanations and factor breakdowns exist in backend/model structures. | Desk UI does not surface factor-level rationale; stream turns may only imply reasoning in prose; explanation consistency across generate/chat/recommend/remix not unified in UI. | Render per-item and per-outfit rationale cards using existing breakdown/explanation fields; ensure stream final payload carries same structure. | High | Medium | Structured stream `done` payload usage |
| Persistent user fashion preferences (user-controlled) | PARTIALLY IMPLEMENTED | `UserProfile` style fields in `lib/data/models.dart`, `saveStyleProfile/updateStyleProfile` in `app_state.dart`/`smartwardrobe_api.dart`, learned memory in `style-memory.js` and server profile normalization in `server.js` | Explicit style profile and inferred learned memory both exist. | No clear UI in audited stylist flows to inspect/edit/clear *AI-learned* preferences separately; "persistent fashion memory/preferences separate from conversation history" is split across systems without a unified user-facing control model. | Add explicit preferences management surface/API semantics (inspect/edit/reset learned memory vs explicit profile vs conversation history) reusing existing stores. | High | Medium | Product/UX decisions, backend endpoints/UI |
| Conversation history/context management | PARTIALLY IMPLEMENTED | `AppState` keeps `_conversationId/_chatHistory`, backend recalls/persists turns (`server.js`), `/ai/conversations` endpoints exist | Single active conversation thread works in-memory client-side; backend can recall/store turns. | No conversation list/reopen/rename/delete/search UI; Desk and StylistScreen share AppState history behavior implicitly; no evidence of independent thread management UX; client history not persisted across app restarts except server recall conditions. | Implement conversation thread metadata/endpoints/UI on top of existing `conversationId` and `/ai/conversations`; scope threads per surface if needed. | High | Medium | Backend metadata model, Flutter state/UI |
| Outfit modification / alternatives in chat flow | PARTIALLY IMPLEMENTED | Remix endpoint/UI in `stylist_screen.dart`; Desk supports manual item replacement on canvas (`_showReplacementSheet`) | Users can remix suggested outfits (StylistScreen) and manually swap canvas items by category (Desk). | Natural-language follow-up modifications ("remove the jacket", "try another") are not explicitly handled as structured edit operations in audited code; Desk quick chips are static and not wired to stateful outfit edits. | Add intent detection + edit operations over current outfit (remove/replace/add/lock item) using existing wardrobe retrieval and canvas state. | High | High | State model for "current outfit", prompt/schema changes |
| Weather-aware styling | PARTIALLY IMPLEMENTED | `backend/src/weather.js` (module present), `server.js` resolves weather in stylist context/generation paths, Flutter passes temp/occasion in some calls and loads weather (`app_state.dart`) | Weather can be resolved server-side and influences generation/scoring/retrieval in code paths. | Actual weather provider availability/accuracy not runtime-verified; UI rarely communicates weather assumptions; Desk generate call hardcodes `occasion: 'casual'` in initial load. | Surface weather/context used in response, allow user overrides, and verify fallback behavior (Open-Meteo/OWM/estimate). | Medium | Medium | API/network/runtime verification |
| Fashion Critic / Wardrobe Assistant / Shopping Assistant behaviors | PARTIALLY IMPLEMENTED | LLM prompt supports intents including explain/opinion/build/remix/learn/chat (`llm.js`); endpoints for wardrobe gap/packing/match/remix exist (`server.js`, `ai-engine.js`) | Backend can infer intent and perform some related tasks. | No explicit user-selectable stylist modes in UI; critic-style evaluation and shopping-assistant flows are not presented as dedicated, structured experiences in audited screens. | Introduce mode selector and mode-specific response schemas/actions while reusing existing intent/engines/endpoints. | High | Medium | UX + prompt/schema updates |

---

## 6. Missing Capabilities

| Feature name | Status | Evidence (code) | What currently happens | What is missing/problematic | Recommended improvement | Priority | Complexity | Dependencies |
|---|---|---|---|---|---|---|---|---|
| Explicit Stylist mode switching (Stylist/Fashion Critic/Wardrobe Assistant/Shopping Assistant) | NOT IMPLEMENTED | No mode toggle/state found in `lib/features/stylist/stylist_desk_screen.dart` or `stylist_screen.dart`; backend prompt has `intent` but no first-class mode contract in API client/UI | Behavior depends on implicit intent detection and screen-specific affordances. | Users cannot choose or see active mode; responses may be inconsistent. | Add mode parameter in chat API/state/UI and mode-specific prompts/templates/output cards. | High | Medium | Prompt/API contract changes |
| Dedicated Fashion Critic workflow with structured critique | NOT IMPLEMENTED | No dedicated critic endpoint/UI flow found; `stylistChat` intent includes `opinion/explain` only | General chat may critique in prose, but not as a consistent evaluative workflow. | Missing structured critique dimensions (fit, color, occasion, season, improvements, score/rationale) and UI rendering. | Implement critic mode using existing scoring/breakdown concepts and structured output schema. | High | Medium | Output schema, UI components |
| Dedicated Wardrobe Assistant workflow (organization/reuse insights) | NOT IMPLEMENTED | Wardrobe data and gap/insight primitives exist (`/ai/wardrobe-gap`, wardrobe stats elsewhere), but no stylist-mode workflow found | Chat can discuss wardrobe in general; desk does not present wardrobe insights/actions. | No guided wardrobe organization/reuse flows or actionable summaries grounded in user wardrobe. | Add wardrobe-assistant mode and targeted prompts/queries (underused items, gaps, capsule suggestions). | Medium | Medium | Wardrobe analytics hooks |
| Dedicated Shopping Assistant workflow with "owned vs missing" guarantees in UI | NOT IMPLEMENTED | `/ai/wardrobe-gap`, `/shop/*` and matching gaps exist in backend/models, but no dedicated stylist shopping mode UI found | Gap info may exist in some responses (e.g. match results), not as a consistent assistant mode. | No consistent separation/presentation of owned items vs suggested purchases in stylist chat. | Add shopping mode that labels `owned`/`missing` and links suggestions to shop flows without claiming ownership. | Medium | Medium | UI/schema + existing shop APIs |
| Outfit comparison feature | NOT IMPLEMENTED | No compare endpoint/UI found in audited stylist/API/backend AI routes | Not available. | Users cannot compare two outfits side-by-side with explained tradeoffs. | Add compare action using existing scoring/explanation outputs for two outfit payloads. | Medium | Medium | Selection UI + compare schema |
| Meaningful outfit scoring presentation standard (cross-feature) | NOT IMPLEMENTED (as unified capability) | `scoring.js` and `recommendation-engine.js` compute meaningful scores; UI shows badges in places but not a consistent scoring contract in chat | Scores exist but presentation varies and can be opaque in chat. | No unified "what this score means" UI/explanation in stylist chat. | Standardize score labels, factor breakdown rendering, and caveats (e.g. completeness cap). | Medium | Low | Frontend rendering reuse |
| Feedback learning loop visibility and controls | NOT IMPLEMENTED (as user-facing loop) | Ratings/feedback endpoints and `style-memory` learning exist; `AppState.submitRating/loadOutfitRating` present | Feedback can influence backend memory in supported flows. | No audited UI showing how feedback changed preferences/recommendations or controls to review/reset learned effects. | Expose feedback history/learned deltas summaries and reset controls; add evaluation hooks. | Medium | Medium | Backend endpoints + UI |
| Automated AI response quality evaluation / prompt regression tests | NOT IMPLEMENTED | No dedicated prompt eval datasets/tests found in audited backend tests (`backend/test/saved-outfits.test.js` only seen in listing sample); Flutter tests not covering stylist intelligence | No evidence of systematic quality regression harness. | Regressions in prompts/intents/parsing/hallucinations likely undetected. | Add fixture-based evals for intent, grounding, schema validity, Arabic/English, and provider-failure cases. | High | Medium | Test harness, fixtures, CI/runtime setup |

---

## 7. Weak or Problematic Implementations

| Feature name | Status | Evidence (code) | What currently happens | What is missing/problematic | Recommended improvement | Priority | Complexity | Dependencies |
|---|---|---|---|---|---|---|---|---|
| Streamed response structure in Stylist Desk | WEAK / PARTIALLY IMPLEMENTED | `backend/src/llm.js` `streamChat()` instructs plain prose (no JSON/IDs); `server.js` `/ai/chat/stream` recovers mentioned IDs heuristically; Desk uses markdown text + canvas chip (`stylist_desk_screen.dart`) | Streaming favors UX smoothness but loses structured semantics. | Intent, constraints, per-item reasons, gaps, and follow-ups are not streamed/rendered reliably; outfit recovery may be heuristic/inaccurate. | Use structured streaming protocol (e.g. events for text + structured metadata/patches) or hybrid: stream text, finalize with validated JSON payload rendered incrementally. | Critical | High | API/protocol + UI parser changes |
| Conversation state ownership and persistence | WEAK | `AppState` keeps single `_conversationId`/`_chatHistory` in memory (`lib/data/app_state.dart`), Desk does not reset but also lacks thread management; backend stores flat turns in `db.conversations` (`server.js`) | Works for a basic single-thread session. | Cross-screen/thread isolation unclear; restart loses client context; history can drift; "multiple conversations independently" not evidenced. | Introduce explicit thread entities (id/title/timestamps/user), persist client selection, and isolate history per thread/screen context. | High | Medium | Backend schema + client state |
| Follow-up outfit modification understanding | WEAK | No explicit edit-intent parser/state machine found; Desk quick chips static (`_quickChips` in `stylist_desk_screen.dart`), `streamStylist` only applies full `outfitRaw` when present | Modifications are limited to full regeneration/remix/manual canvas swap. | References like "remove the jacket", "change shoes", "make it warmer" may not deterministically modify current outfit. | Add current-outfit context object and structured edit actions (remove/replace/swap/add/lock) with deterministic backend operations. | High | High | Prompting + state + wardrobe ops |
| Arabic / Egyptian Arabic support (evidence gap) | NEEDS RUNTIME VERIFICATION / LIKELY PARTIAL | No explicit i18n/Arabic handling logic found in audited AI prompts/parsers/UI except generic markdown/text rendering; models/providers may handle multilingual input but not verified | System may respond in Arabic depending on LLM behavior, but not guaranteed. | No enforced language detection/preservation policy, no RTL/chat rendering checks audited, no tests for Egyptian Arabic intent/wardrobe terms. | Add language policy (preserve user language), Arabic test fixtures, and RTL/typography validation in chat UI. | High | Medium | Runtime/provider behavior, UI review |
| Prompt-injection and untrusted-input handling | WEAK / NEEDS RUNTIME VERIFICATION | `server.js` builds prompts/context from user messages, history, notes, wardrobe fields; `optionalAuth` and auth checks exist, but no explicit prompt-injection guard/sanitization layer observed in audited modules | Normal inputs likely handled; user/wardrobe text enters prompts. | Risk of instruction override/data exfiltration attempts via user text or stored item metadata; no explicit policy enforcement in responses. | Add system-level safety constraints, input/output filtering for secrets/cross-user refs, and structured tool grounding rules. | Critical | Medium | Prompt and backend validation changes |
| Error/retry semantics in UI | PARTIALLY IMPLEMENTED / WEAK | Desk `_retry()` removes trailing offline assistant message and re-runs last user text (`stylist_desk_screen.dart` comments/logic ~414-425); stream parsing catches some cases | Basic retry exists for offline replies. | Retry can duplicate history semantics (acknowledged in `updata.txt`), no granular handling for provider errors/rate limits/timeouts/partial structured failures. | Improve retry/state reconciliation, expose typed error states, and avoid duplicate persisted turns. | Medium | Medium | Client/server coordination |
| Runtime performance claims | NEEDS RUNTIME VERIFICATION | Streaming UI and SSE plumbing exist; no measured timings in repo evidence reviewed here | Implementation suggests incremental rendering is intended. | Time-to-first-token, total latency, memory/context growth, and mobile/web performance unmeasured. | Instrument client/server timings and token/context metrics; run representative scenarios. | Medium | Medium | Telemetry/runtime access |

---

## 8. AI Reasoning and Response Quality Assessment

### Intent understanding
- **Evidence:** `llm.js` `STYLIST_SYSTEM` requests `intent` classification (`build_outfit|remix|explain|opinion|learn|chat`), occasion/constraints/follow-up/memory notes; `ai-engine.js` has rule-based `detectOccasion()` and fallback `chatReply()`.  
- **Assessment:** **Partially implemented.** Structured intent exists in non-stream LLM path and rules, but Desk streaming path prioritizes prose and does not surface/consume intent reliably. Distinguishing corrections/follow-up edit intents as deterministic operations is not evidenced.

### Clarification behavior
- **Evidence:** Prompt asks for concise advice and optional `followUp`; `stylist_screen.dart` can display `followUp` if present in message model. Desk does not show follow-up field distinctly.  
- **Assessment:** **Weak/partially implemented.** Capability depends on model compliance; no policy layer to ask only essential questions or to detect missing critical info (e.g., occasion/weather/formality constraints) consistently.

### Fashion reasoning quality (color/style/proportion/season/occasion/coherence)
- **Evidence:** Strong rule/heuristic foundations in `scoring.js`, `taxonomy.js` (referenced), `ai-engine.js`, `recommendation-engine.js`, and remix targets; retrieval and memory influence ranking/generation.  
- **Assessment:** **Implemented in scoring/generation logic, but UI explanation is inconsistent.** The engines can produce coherent, constrained outfits and explanations; chat responses may still be generic prose unless structured outputs are surfaced. Proportion/fit reasoning is limited to available metadata (`body_fit_preference` uses declared prefs/cuts; true body-fit inference from images not evidenced).

### Suitability recognition and critique
- **Evidence:** Scoring/completeness caps and explanations can identify compromises; `vision.js`/match flow returns gaps/similarity (module/UI evidenced). No dedicated critic mode UI.  
- **Assessment:** **Partially implemented.** System can compute suitability signals, but a user-facing "Fashion Critic" experience with consistent critique structure is missing.

### Response usefulness and format
- **Evidence:** Desk has markdown rendering, suggestions, quick chips, streaming UX (`stylist_desk_screen.dart`). Rule fallback prompt behavior aims concise (`llm.js` system rules).  
- **Assessment:** **Mixed.** UX is improved, but response schemas are not standardized across endpoints/screens; structured outfit details/reasons/alternatives are not uniformly rendered. Risk of generic or under-specified replies remains without evaluation harness.

### Language support (Arabic/English/Egyptian Arabic)
- **Evidence:** No explicit locale/language enforcement in audited AI flows; general UTF-8 text handling likely.  
- **Assessment:** **NEEDS RUNTIME VERIFICATION.** Multilingual support cannot be confirmed from code alone; no tests/guards for Arabic or Egyptian Arabic comprehension and language preservation.

---

## 9. Wardrobe Intelligence Assessment

| Aspect | Status | Evidence | Assessment |
|---|---|---|---|
| Retrieval of actual saved clothing items | IMPLEMENTED BUT NOT FULLY VERIFIED | `server.js` uses `db.wardrobe.filter(!archived)`; `stylistContext()` builds shortlist via `retrieval.rank`; Desk replacement sheet loads via `AppState.instance.api.wardrobeItems(category:...)` with fallback to `AppState.instance.wardrobe` | Real wardrobe access is central to backend and canvas replacement; correctness depends on live data/auth context. |
| Use of real item IDs/metadata | IMPLEMENTED BUT NOT FULLY VERIFIED | LLM prompts send catalog lines with IDs/attributes (`llm.js`, `retrieval.catalogLines`), `buildOutfitFromIds` validates IDs against wardrobe (`server.js`), models carry category/color/style/material/season/formality | Grounding by ID is designed in; stream path can degrade to name/ID mention recovery heuristics. |
| Owned vs suggested shopping additions | PARTIALLY IMPLEMENTED | Match results include gaps (`models.dart` `OutfitMatch.gaps`, `SlotGap`); wardrobe-gap/packing/shop endpoints exist; no unified chat labeling observed | Can distinguish in specific flows (match/gap endpoints), but not consistently in general stylist chat responses. |
| Avoiding invented items/unsupported attributes | PARTIALLY IMPLEMENTED | Prompt states "Ground every recommendation ONLY in the catalog ids..." (`llm.js`); rule fallback generates from wardrobe; stream synthesis attempts recovery from text | Guardrails exist but are prompt/model-dependent; no strict schema validation/rejection loop evidenced for all responses. |
| Handling insufficient wardrobe data | PARTIALLY IMPLEMENTED | Prompt includes empty-wardrobe instruction; generation/recommendation return empty/no-candidates meta in engine (`recommendation-engine.js`); Desk shows empty/error canvas states | Some graceful handling exists, but user-facing explanations and next actions (what to add, why insufficient) are not standardized in chat. |

---

## 10. Conversation Context and Memory Assessment

| Aspect | Status | Evidence | Assessment |
|---|---|---|---|
| Follow-up references ("this one", "change it", "remove the jacket") | PARTIALLY IMPLEMENTED / WEAK | Chat history passed to backend (`AppState.chatHistory()`), LLM prompt includes conversation history; no explicit referent resolution/edit engine found | May work opportunistically with LLM, but deterministic handling of current outfit/item references is not evidenced. |
| Preserve current outfit and prior instructions | PARTIALLY IMPLEMENTED | Desk stores `_currentOutfit` and applies `outfitRaw` on new results; AppState retains chat history in-memory; backend persists turns | Current outfit is preserved on canvas until replaced/regenerated, but edit semantics and instruction memory are not structured/guaranteed. |
| Apply modifications to correct outfit | PARTIALLY IMPLEMENTED | Remix operates on explicit item IDs in StylistScreen; Desk manual replace targets selected canvas item/category | Correctness is good for explicit UI actions, weaker for natural-language follow-up edits. |
| Context retention during streaming/subsequent messages | IMPLEMENTED BUT NOT FULLY VERIFIED | `AppState` records turns after each streamed/asked reply; backend can recall server-side turns when history omitted | Basic continuity exists, but client/server history reconciliation and failure cases (retry, partial streams) need verification. |
| Multiple conversations independently | NOT IMPLEMENTED (UI) / PARTIALLY IMPLEMENTED (primitives) | Single `_conversationId` in AppState; backend stores `conversationId` with turns and offers `/ai/conversations` list/delete; no thread management UI found | Backend primitives exist, but independent multi-thread UX/isolation is not implemented. |
| Persistent fashion preferences vs conversation history separation | PARTIALLY IMPLEMENTED | Explicit `styleProfile` (user/profile APIs), learned `styleMemories` (`style-memory.js`), conversation turns (`db.conversations`) | Data separation exists technically, but user controls/visibility and lifecycle boundaries are incomplete. |

---

## 11. Fashion Critic and Stylist Modes Assessment

| Mode/capability | Status | Evidence | Assessment |
|---|---|---|---|
| Smart Stylist (complete outfits from real wardrobe) | IMPLEMENTED BUT NOT FULLY VERIFIED | `ai-engine.generateOutfits`, `/ai/generate-outfit`, chat outfit building, Stylist Desk canvas apply | Core capability exists; quality depends on wardrobe metadata and response structuring. |
| Fashion Critic | NOT IMPLEMENTED as dedicated mode | Intent `opinion/explain` in `llm.js`, scoring explanations in `scoring.js`, but no critic UI/workflow | Can produce critique-like text ad hoc; lacks consistent rubric/output and UI. |
| Wardrobe Assistant | PARTIALLY IMPLEMENTED | Wardrobe retrieval, `/ai/wardrobe-gap`, packing/planner/shop-adjacent features, wardrobe-aware chat context | Advisory help possible, but not a focused assistant mode with actionable wardrobe organization/reuse UX. |
| Shopping Assistant | PARTIALLY IMPLEMENTED | `/ai/wardrobe-gap`, shop endpoints, outfit-match gaps (`SlotGap`) | Missing-item reasoning exists in places; not unified into a stylist shopping mode that clearly labels owned vs to-buy. |
| Mode support in application (4 modes) | NOT IMPLEMENTED | No mode state/selector found in audited stylist screens/APIs | Users cannot explicitly switch modes; behavior is implicit. |

---

## 12. Performance, Reliability, and Security Findings

| Finding | Status | Evidence (code) | What currently happens / risk | Recommended improvement | Priority | Complexity |
|---|---|---|---|---|---|---|
| Streaming UX and incremental rendering | IMPLEMENTED BUT NOT FULLY VERIFIED | SSE client (`api_client.dart`), `ValueNotifier` streaming bubble in Desk, typing dots/placeholders in both screens | UI architecture supports progressive rendering. Runtime latency/TTFT not measured. | Add timing instrumentation and verify on device/network conditions. | Medium | Low |
| Backend/provider fallback behavior | PARTIALLY IMPLEMENTED | `llm.js` model rotation + provider selection; `server.js` falls back to rule engine; Flutter offline replies/fallback data | Resilience exists for many failures, but error classes and UI messaging are coarse. | Standardize typed error codes (timeout/rate-limit/provider unavailable/parse failure) and user-facing recovery paths. | High | Medium |
| Error handling and retry behavior | PARTIALLY IMPLEMENTED | Try/catch in AppState/server routes, Desk retry for offline, stream `error` events handled | Some recovery exists; duplicate history/turn persistence risks during retries and partial failures. | Make retries idempotent (client turn IDs/server dedupe) and improve partial-stream recovery. | High | Medium |
| Context window / token management | PARTIALLY IMPLEMENTED | `AppState.chatHistory(limit:12)` default for send, in-memory cap 60; `llm.js` trims recent turns and bounds catalog; retrieval shortlist limits | Basic bounding exists. No adaptive summarization/token accounting surfaced. | Add conversation summarization/memory compression and observability on prompt sizes/token usage. | Medium | Medium |
| Duplicate requests / concurrency controls | PARTIALLY IMPLEMENTED | `recommendationsLoading` guard in `loadToday()`, `_thinking` guards in stylist UIs; limited request dedupe elsewhere | Some double-submit protection exists, not comprehensive across all AI actions. | Add request IDs/in-flight guards for chat/remix/match/analyze flows. | Medium | Low |
| Authentication and per-user isolation | PARTIALLY IMPLEMENTED / NEEDS RUNTIME VERIFICATION | `server.js` has `auth`/`optionalAuth`, per-user memory lookups/writes in many paths, ownership checks in some outfit endpoints; `req.authUserId` introduced for verified session writes (commented) | Isolation intent is visible, but broad audit of every AI route for strict ownership enforcement was not completed. | Review/enforce user scoping on all reads/writes (wardrobe, conversations, memory, recommendations) and add isolation tests. | Critical | Medium |
| Prompt injection / untrusted content | WEAK | User messages, history, memory digest, wardrobe attributes, filenames/notes can enter prompts/context (`llm.js`, `server.js`) | No explicit injection detection/sanitization or policy firewall observed. | Harden system prompts, separate trusted instructions from data, validate/escape tool inputs, and block cross-user/data exfiltration patterns. | Critical | Medium |
| Secrets handling in audited code paths | IMPLEMENTED BUT NOT FULLY VERIFIED | `llm.js` reads keys from env (`GEMINI_API_KEY`, etc.); README documents `.env`; no keys printed in inspected files | Expected pattern (env vars) is used. | Ensure logs never include prompts with secrets/tokens and audit provider error logging. | High | Low |
| Network interruptions / backend timeouts | PARTIALLY IMPLEMENTED | `ApiClient` timeouts and exceptions; SSE timeout configurable; Flutter offline fallbacks | Basic timeout handling exists; UI-level timeout specificity and resumability are limited. | Expose timeout categories and recovery options; consider resumable streams or safe replays. | Medium | Medium |

---

## 13. Existing Tests and Missing Test Coverage

### 13.1 Existing tests / checks (evidence from repo and provided handoff notes)
- **Backend:** `backend/test/saved-outfits.test.js` exists (file listed). Broader backend test suite contents not fully inspected in this pass.
- **Flutter:** `test/` directory exists (multiple files implied by prior notes), but stylist-intelligence-specific coverage not evidenced in audited files.
- **Handoff/runtime notes in `updata.txt` (not re-executed by this audit):**
  - `flutter analyze`: previously reported clean/no issues after earlier changes.
  - `flutter test`: previously reported 110 passed, 2 failed (pre-existing live-backend `non_clothing_gate_test.dart` failures due to unreachable backend).
  - Manual verification for Stylist Desk gestures/canvas and new chat UX reported as not performed in that environment.

### 13.2 Missing / insufficient coverage for AI Stylist intelligence
- Intent understanding and mode routing (stylist vs critic vs wardrobe vs shopping).
- Wardrobe-grounded recommendation correctness (real IDs only, no invented items, category/occasion/weather constraints).
- Follow-up conversational context and referent resolution ("this one", "remove jacket", "swap shoes").
- Stateful outfit modification (incremental edits vs full regeneration) and canvas/chat synchronization consistency.
- Persistent preference lifecycle: save/learn/inspect/edit/clear, separation of explicit profile vs learned memory vs conversation history.
- Conversation isolation: multiple threads/users, no cross-user leakage in chat/memory/recommendations.
- Arabic and English behavior, including Egyptian Arabic phrasing and language preservation.
- Structured response parsing/validation (stream and non-stream), malformed payload handling, partial stream recovery.
- Hallucination prevention and grounding guarantees (owned vs suggested items, missing data uncertainty).
- AI provider failures: missing key, quota/rate limit, timeout, 5xx, malformed provider response, mid-stream abort.
- Canvas integration correctness from AI responses (item mapping, image resolution, position reset/preservation rules).
- Recommendation consistency/determinism where expected (seeded exploration behavior, compatibility vs ranking score presentation).

### 13.3 Safe checks executed during this audit
- Repository inspection, file reads, and code tracing via PowerShell/CLI read-only commands.
- `git status --porcelain` inspection (read-only).
- **No Flutter/Python/Node test suites were executed** in this audit session, to avoid environment-dependent/runtime side effects and because backend/AI-provider dependencies were not verified as safe/available. Prior results are reported only as documented in `updata.txt`.

---

## 14. Additional Recommended Improvements

| Improvement | Why it matters (project-relevant) | Evidence/context | Priority | Complexity |
|---|---|---|---|---|
| Unified structured AI response contract (all stylist endpoints/modes) | Enables reliable rendering, explainability, and testability across Desk/StylistScreen | Stream path is prose (`llm.streamChat`), non-stream returns richer JSON; UI handling differs | Critical | High |
| Deterministic "current outfit edit" engine | Converts chat follow-ups into safe, testable operations instead of prompt-only behavior | Canvas/manual replace exists, but NL edits not structured | High | High |
| Grounding validator before UI apply/persist | Prevents hallucinated items/IDs and ensures owned-vs-missing labeling | `buildOutfitFromIds` and mention recovery exist but not a full validation layer | High | Medium |
| Conversation thread model + UX (list/reopen/rename/delete) | Needed for "multiple conversations independently" and better memory boundaries | `/ai/conversations` and `conversationId` exist; single in-memory thread in client | High | Medium |
| Preference center (explicit profile + learned memory + history controls) | Makes personalization transparent and user-controllable | `styleProfile` and `style-memory` coexist; controls not surfaced in audited flows | High | Medium |
| Prompt/output evaluation harness (golden fixtures) | Prevents regressions in intent, grounding, schema, and language behavior | No prompt regression tests evidenced | High | Medium |
| Arabic/Egyptian Arabic language policy and fixtures | User requirement implies natural conversational Arabic support; currently unverified | No explicit language handling/tests found | High | Medium |
| Retrieval/ranking observability in dev tooling | Helps tune wardrobe intelligence without replacing architecture | Retrieval and recommendation engines expose rich internals but limited surfaced diagnostics | Medium | Medium |
| Graceful degradation matrix | Consistent UX when LLM/vision/weather/embeddings unavailable | Multiple fallbacks exist but behavior differs by path/screen | Medium | Medium |

---

## 15. Prioritized Implementation Roadmap

### PHASE 1 — Critical AI Quality Improvements
- **Exact features to implement**
  - Unified structured response schema for chat (stream + non-stream): `reply`, `intent`, `mode`, `language`, `outfit`, `itemReasons`, `ownedItems`, `missingItems`, `followUps`, `confidence/uncertainty`, `source`.
  - Grounding/validation layer for all AI-returned item IDs and attributes before render/persist.
  - Deterministic handling for core follow-up edits on current outfit (remove/replace/swap/lock item, "make warmer/more formal" as constrained transforms).
  - Prompt-injection hardening and cross-user/context leakage safeguards in prompt assembly/logging.
- **Relevant frontend/backend files**
  - `backend/src/llm.js`, `backend/server.js`, `backend/src/ai-engine.js`, `backend/src/retrieval.js`
  - `lib/core/api/smartwardrobe_api.dart`, `lib/core/api/api_client.dart`, `lib/data/app_state.dart`, `lib/data/models.dart`
  - `lib/features/stylist/stylist_desk_screen.dart`, `lib/features/stylist/stylist_screen.dart`
- **Dependencies**
  - Agreement on schema and event protocol; minimal migration for existing clients.
- **Expected user benefit**
  - More reliable, explainable, and consistent stylist responses; fewer hallucinations and broken renders.
- **Risks**
  - SSE/protocol refactor complexity; temporary UI regressions if schema rollout is partial.
- **Acceptance criteria**
  - 100% of stylist chat responses conform to schema (including fallback/error states).
  - UI never renders unknown item IDs; owned/missing labels are explicit when applicable.
  - Core follow-up edit commands modify the intended current outfit in deterministic tests.

### PHASE 2 — Wardrobe Intelligence and Recommendation Quality
- **Exact features to implement**
  - Surface per-item recommendation reasons and factor breakdowns in chat/outfit cards (reuse `scoring.js`/`Outfit.factors`).
  - Improve insufficient-wardrobe responses with specific gaps and actionable next steps (reuse wardrobe gap/match gaps).
  - Better ranking/filter controls for occasion/weather/constraints and "try another" grounded alternatives.
  - Consistent compatibility score semantics and caveats (completeness cap) across screens.
- **Relevant frontend/backend files**
  - `backend/src/recommendation-engine.js`, `backend/src/scoring.js`, `backend/src/ai-engine.js`, `backend/server.js`
  - `lib/features/stylist/stylist_desk_screen.dart`, `lib/features/stylist/stylist_screen.dart`, `lib/features/outfits/*`, `lib/data/models.dart`, `lib/data/app_state.dart`
- **Dependencies**
  - Phase 1 structured schema; reliable wardrobe metadata quality.
- **Expected user benefit**
  - Clearer "why this outfit" reasoning and better alternatives using real closet items.
- **Risks**
  - UI clutter if explanations are verbose; tuning needed for relevance/diversity balance.
- **Acceptance criteria**
  - Recommendations include item-level rationale and valid compatibility metadata.
  - "Try another" returns meaningfully different, constraint-respecting outfits.

### PHASE 3 — Conversation Context and Personalization
- **Exact features to implement**
  - Multi-conversation/thread support (create/list/reopen/rename/delete/search) with independent contexts.
  - Persistent client-side conversation selection and restoration; reconcile with backend history.
  - Preferences center: explicit style profile, learned memory digest/facts/exclusions, and conversation reset/clear controls with user confirmation.
  - Smart, contextual follow-up chips generated from response intent/outfit state (not static-only).
- **Relevant frontend/backend files**
  - `backend/server.js`, `backend/src/style-memory.js`, `backend/src/store.js` (if needed for metadata), `backend/data/*` schema usage
  - `lib/data/app_state.dart`, `lib/core/api/smartwardrobe_api.dart`, `lib/features/stylist/*`, profile/settings screens (as applicable)
- **Dependencies**
  - Backward-compatible conversation storage changes; UX design decisions.
- **Expected user benefit**
  - Continuity across sessions, controllable personalization, and clearer separation of memory types.
- **Risks**
  - Migration of existing flat conversation records; privacy/isolation regressions if scoping is wrong.
- **Acceptance criteria**
  - Users can manage multiple threads independently; clearing conversation does not delete learned preferences unless explicitly requested.
  - Preferences can be inspected/edited/cleared with auditable effects.

### PHASE 4 — Advanced Fashion Intelligence
- **Exact features to implement**
  - First-class modes: Stylist, Fashion Critic, Wardrobe Assistant, Shopping Assistant (UI + API/prompt behavior).
  - Structured Fashion Critic reports (strengths/issues/improvements, occasion/weather/style fit).
  - Outfit comparison view (two outfits, factor-by-factor and practical tradeoffs).
  - Enhanced shopping assistant flow labeling owned wardrobe pieces vs missing purchases, with safe suggestions.
  - Arabic/English and Egyptian Arabic conversational support policy (language preservation, culturally natural phrasing where supported).
- **Relevant frontend/backend files**
  - `backend/src/llm.js`, `backend/server.js`, `backend/src/scoring.js`, `backend/src/vision.js`
  - `lib/features/stylist/*`, `lib/data/models.dart`, `lib/data/app_state.dart`, relevant shop/outfit screens
- **Dependencies**
  - Phase 1 schema and Phase 3 context/personalization plumbing; multilingual QA.
- **Expected user benefit**
  - More capable, specialized assistant experiences beyond generic chat.
- **Risks**
  - Mode proliferation/complex prompts; inconsistent quality without evaluation.
- **Acceptance criteria**
  - Mode-specific outputs pass schema and UX expectations; comparisons/critiques grounded in provided outfit/wardrobe data; language behavior verified for Arabic/Egyptian Arabic cases.

### PHASE 5 — Evaluation, Testing, and Optimization
- **Exact features to implement**
  - Prompt/response regression suite (intent, grounding, schema, hallucination, Arabic/English, follow-up edits, provider failures).
  - Contract tests for SSE events and final payloads; isolation/security tests for per-user data boundaries.
  - Telemetry for TTFT/latency/error rates/token/context size; performance tuning based on measurements.
  - Fallback/degradation verification matrix (no LLM key, no embeddings, no weather, backend timeout).
- **Relevant frontend/backend files**
  - `backend/test/*` (new), `backend/src/*`, `backend/server.js`
  - Flutter `test/*` and integration tests for stylist flows; `lib/features/stylist/*`, `lib/data/app_state.dart`
- **Dependencies**
  - Test fixtures/data, mock providers or deterministic stubs, CI/runtime environment support.
- **Expected user benefit**
  - Higher reliability, fewer regressions, and measurable quality/performance improvements.
- **Risks**
  - Test maintenance cost; nondeterminism from live LLMs if not stubbed.
- **Acceptance criteria**
  - Automated suite covers critical AI scenarios; key SLOs/quality thresholds defined and tracked; fallback behaviors verified.

---

## 16. Technical Dependencies and Risks

| Dependency / Risk | Evidence | Impact | Mitigation |
|---|---|---|---|
| LLM provider availability, quotas, and model drift | `llm.js` model rotation/providers; README env-based setup | Variable response quality/latency/failures | Keep rule-engine fallbacks, add typed error handling, provider health checks, and prompt/response evals |
| Optional local embeddings/vision/model assets | `retrieval.js`, `backend/.model-cache/*`, `vision.js` references, README model setup | Feature degradation (semantic retrieval/vision matching) when unavailable | Explicit capability reporting (`/ai/capabilities`), install/setup checks, lexical/image fallback messaging |
| JSON file persistence (`backend/data/db.json`) and flat conversation/memory records | `server.js`, `store.js` usage, README | Concurrency/scalability limits, migration complexity for thread metadata/preferences | Design careful migrations/backups, add integrity checks, avoid destructive edits |
| Prompt/model nondeterminism | LLM-based `stylistChat/streamChat` and vision flows | Inconsistent intent/structure/hallucination risk | Structured schemas, validators, constrained decoding where possible, regression fixtures |
| Auth/session and multi-user isolation correctness | `auth/optionalAuth`, `req.user`/`req.authUserId` handling in `server.js` | Potential data leakage/cross-user contamination if any path is mis-scoped | Comprehensive authorization audit and isolation tests on all AI endpoints/data stores |
| Bilingual UX requirements (Arabic/Egyptian Arabic) | No explicit language policy/tests found | Misunderstood intent or wrong response language | Add language detection/preservation rules and Arabic-focused QA/evals |
| Client/server contract drift across two stylist UIs | `stylist_desk_screen.dart` and `stylist_screen.dart` consume different features/fields | Inconsistent behavior and maintenance burden | Shared typed response models/adapters and feature parity plan |
| Runtime verification gaps in this environment | No backend/LLM/device runtime tests executed during audit | Some findings remain code-inferred | Run targeted manual and automated runtime verification in a configured environment |

---

## 17. Exact Files and Components Relevant to Future Changes

### Frontend (Flutter)
- `lib/features/stylist/stylist_desk_screen.dart` — primary split canvas/chat UI, streaming rendering, markdown, quick chips, canvas apply/drag/replace, retry/error states.
- `lib/features/stylist/stylist_screen.dart` — alternate chat UI, photo-match flow, outfit suggestion/remix chips, follow-up/source display.
- `lib/data/app_state.dart` — stylist conversation state/history, streaming/non-stream calls, remix/match/style DNA, offline fallback, recommendations/ratings/profile orchestration.
- `lib/core/api/smartwardrobe_api.dart` — AI endpoint wrappers (`chat`, `chatStream`, `generateOutfit`, `compatibility`, `matchOutfit`, `remix`, `styleDna`, `conversations`, `capabilities`, wardrobe-gap/packing/recommendations).
- `lib/core/api/api_client.dart` — HTTP/SSE transport, timeouts, multipart upload, error mapping.
- `lib/data/models.dart` — `ChatMessage`, `Outfit`, `MatchFactor`, `OutfitMatch`, `SlotMatch`, `SlotGap`, `UserProfile`, `ClothingItem` contracts used by AI features.
- Likely adjacent UI/state: `lib/features/outfits/*`, profile/style screens, wardrobe screens (for preferences, save/rate, and wardrobe-grounded actions).

### Backend (Node/Express AI)
- `backend/server.js` — AI route handlers, context assembly, chat/stream orchestration, memory learning/persistence, conversation storage, recommendation/rating/feedback endpoints, capability/status exposure.
- `backend/src/llm.js` — provider config/rotation, structured stylist chat, streaming chat, JSON parsing, vision/describe helpers (partially inspected), prompt policy.
- `backend/src/ai-engine.js` — rule fallback chat, occasion detection, beam-search generation, naming, remix logic, gap/packing helpers.
- `backend/src/retrieval.js` — wardrobe ranking/shortlisting, lexical+embedding retrieval, status/warmup.
- `backend/src/style-memory.js` — learned preference model, chat/rating learning, exclusions, digest/style-DNA/confidence.
- `backend/src/scoring.js` — 11-factor compatibility scoring, completeness/capping, explanations.
- `backend/src/recommendation-engine.js` — hard constraints, blended ranking, diversity/exploration, compatibility vs ranking semantics.
- `backend/src/vision.js` — outfit/photo matching and vision interpretation (needs deeper review during implementation of match/critic features).
- `backend/src/taxonomy.js` (referenced), `backend/src/weather.js` (referenced), `backend/src/store.js`, `backend/src/saved-outfits.js`, `backend/src/recommendation-history.js` — supporting context, persistence, and domain logic.
- `backend/README.md`, `backend/package.json`, `backend/data/db.json`, `backend/.model-cache/*` — runtime/config/capabilities/data dependencies.

### Optional/legacy
- `ai-service/main.py`, `ai-service/requirements.txt` — optional FastAPI AI service (not primary path per current Node implementation).

---

## 18. Final Recommendations

1. **Prioritize a strict, validated AI response contract** (especially for streaming) before adding more "smart" behaviors. This is the highest-leverage fix for reliability, explainability, rendering consistency, and testability.
2. **Make outfit follow-up edits deterministic** by introducing a current-outfit edit model and intent-to-operation mapping; keep LLMs for language/selection assistance, not unverified state mutation.
3. **Unify personalization controls and boundaries**: explicit style profile, learned memory, and conversation history must be separately inspectable/editable/clearable with clear UX.
4. **Harden security and isolation** around all AI endpoints (user scoping, prompt-injection resilience, safe logging) and add tests that prove no cross-user leakage.
5. **Treat multilingual quality (Arabic/Egyptian Arabic) as a first-class requirement** with policy + fixtures + runtime verification, not an assumed LLM property.
6. **Build an evaluation harness early (Phase 5 foundations can start in Phase 1)** for prompts/schemas/grounding/provider failures to prevent regressions while iterating.
7. **Reuse existing architecture aggressively** (`scoring`, `retrieval`, `style-memory`, `recommendation-engine`, `ai-engine`, existing Flutter API/state patterns). Do not replace working providers/models without measured evidence.

**Confirmed facts vs assumptions:** Findings above are based on static code inspection and repository documents reviewed in this session. Runtime behavior (LLM quality, Arabic support, latency, provider fallback under real failures, and full auth isolation in live flows) remains **unverified** except where prior handoff notes documented past non-runtime checks; such areas are labeled accordingly.
