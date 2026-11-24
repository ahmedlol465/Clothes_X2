# AI Stylist — Unified Structured Response Contract (DESIGN)

**Project root:** `D:\Clothes_X2-main\Clothes_X2-main`
**Session:** 2 (DESIGN ONLY)
**Created:** 2026-11-16
**Status:** COMPLETED (design only — no application source changed)
**Amended:** 2026-11-17 (Session 13 — `suggestions[]` documented as an implemented additive field)
**Master tracker:** `AI_UPGRADE.md`

> This document is a design specification. It does **not** describe implemented behaviour.
> It describes the contract that Session 3 is expected to implement, the current contract as
> verified in source, and the migration that keeps existing clients working.

---

## 0. Re-verification against Session 1

Every Session 1 finding was re-checked against the current working tree before designing.
The working tree was also checked for changes since Session 1.

### 0.1 Confirmed as still accurate

- Both Stylist screens (`stylist_screen.dart`, `stylist_desk_screen.dart`) use
  `AppState.streamStylist()` → `POST /ai/chat/stream`. Confirmed at
  `stylist_screen.dart:67` and `stylist_desk_screen.dart:386`.
- `POST /ai/chat` returns richer metadata than the stream. Confirmed at `server.js:953-964`.
- Streaming emits plain-prose `delta` events and recovers the outfit heuristically from the
  text (`server.js:1044-1052`, `idsMentionedIn` at `server.js:774`).
- Streaming `done` is `{reply, outfit, weather, memory, source}` (`server.js:1066-1072`).
- Non-streaming returns `{reply, outfit, followUp, intent, occasion, constraints, weather,
  memory, conversationId, source}` (`server.js:953-964`).
- Outfit object shape differs by producer (`buildOutfitFromIds`, `toOutfit`, match, remix).
  Confirmed at `server.js:834-849`, `ai-engine.js:236-254`, `server.js:1142-1155`,
  `ai-engine.js:421-437`.
- `done.reply == deltas.join()` is asserted by `test/backend_contract_test.dart:301`.

### 0.2 New / refined findings discovered this session

1. **`completeness` type drift can crash the Flutter parser.**
   `buildOutfitFromIds` and `finishRemix` set `completeness` to the scoring object
   `{ratio, filled, required}` (`server.js:840`, `ai-engine.js:428`), but
   `Outfit.fromJson` casts it with `(json['completeness'] as num?)?.toDouble()`
   (`models.dart:250`). A `Map` is not a `num`, so parsing such an outfit throws inside
   `streamStylist`, which is caught by its `catch` and silently degrades the whole turn to
   the offline mock reply. `toOutfit` omits `completeness`, so only some outfits trigger it.
   This is a real producer/consumer disagreement, not just cosmetic drift.
2. **`memory.digest` type drift.** The server always sends `digest` as a **string**
   (`style-memory.js:592-615`), but `AppState._applyMemory` only applies it when
   `digest is Map` and then reads `digest['dislikes'|'prefers'|'notes']`
   (`app_state.dart:1268-1276`, `1246-1258`). The learned-preference summary therefore never
   updates from a chat turn. `GET /ai/style-dna` has the same mismatch.
3. **`followUp` is never wired on the stream path at either layer.**
   - Backend `done` does not contain `followUp` (`server.js:1066`).
   - `AppState.streamStylist` returns no `followUp` (`app_state.dart:1133-1176`).
   - `stylist_screen.dart:78-83` builds the finished `ChatMessage` without `followUp`.
   - `stylist_desk_screen.dart:397-402` does the same.
   The follow-up UI at `stylist_screen.dart:356` is therefore dead for the primary path.
4. **No backend automated coverage for `/ai/chat` or `/ai/chat/stream`.**
   Confirmed by listing `backend/test/*.test.js`: chat/stream are not present. The only
   schema coverage is the Flutter live contract test (which skips when the backend is down).
5. **Non-stream rule fallback never supplies `followUp`/`constraints`.**
   `ai.chatReply()` returns `{text, outfit, intent, occasion?}` (`ai-engine.js:495-633`);
   `server.js:934` reads `fallback.constraints`, which is always `undefined`. Harmless today
   because the default `constraints` object is kept, but it matters for semantic parity.

### 0.3 Changes since Session 1

- No application source file was modified by Session 1 or since it.
- `git status` shows pre-existing uncommitted working-tree changes to
  `lib/data/app_state.dart` and `lib/features/stylist/stylist_desk_screen.dart`. Their mtimes
  (2026-11-16 01:46) predate the Session 1 record (2026-11-16 13:05), and Session 1's notes
  already describe the current `streamStylist` signature including `outfitRaw`. No source
  change occurred after Session 1.

---

## A. Current Contract (as built)

### A.1 Shared turn fields

| Field | Type | Required | Purpose | Frontend consumer | Available in stream | Available in non-stream |
| --- | --- | --- | --- | --- | --- | --- |
| `reply` | `string` | Yes | Assistant prose; the only text the UI must show. | Both screens' chat bubble (`ChatMessage.text`) | Yes (`done.reply`) | Yes |
| `outfit` | `object \| null` | Optional (may be `null`) | The grounded, scored look. | `Outfit.fromJson` → outfit card; Desk canvas via raw `items[]` | Yes (`done.outfit`) | Yes |
| `followUp` | `string \| null` | Optional | Suggested next question. | `ChatMessage.followUp` UI (`stylist_screen.dart:356`) | **No** | Yes |
| `intent` | `string` | Optional | Turn classification (`build_outfit\|remix\|explain\|opinion\|learn\|chat`). | **Not consumed anywhere** | **No** | Yes |
| `occasion` | `string` | Optional | Resolved occasion used for grounding. | Not read from chat; `outfit.occasion` read via model default | **No** (only `outfit.occasion` sometimes) | Yes |
| `constraints` | `{colors:string[],styles:string[],avoid:string[]}` | Optional | Stated preferences/exclusions for the turn. | **Not consumed** | **No** | Yes (default empty object even on fallback) |
| `weather` | `Weather` object | Optional in practice (always sent) | Weather used for grounding. | Not read from chat responses | Yes | Yes |
| `memory` | `{confidence:number,digest:string}` | Optional in practice (always sent) | Learned-taste summary/confidence. | `_applyMemory`: consumes `confidence`; expects `digest` to be a Map (it is a string → ignored) | Yes | Yes |
| `conversationId` | `string \| null` | Optional | Echoed thread id. | Client sends it but does not read it back | **No** | Yes |
| `source` | `string` | Yes in practice | Engine provenance: `gemini\|groq\|openrouter\|openai\|rules\|filename\|offline`. | `ChatMessage.source`; "Rule engine — no AI key configured" chip | Yes | Yes |

### A.2 Streaming SSE events (as built)

Each frame is `event:<name>\n` + `data:<json>\n\n` (`server.js:981-984`).

| Event | Payload | Notes |
| --- | --- | --- |
| `delta` | `{delta: string}` | One text fragment. On the rule fallback a single delta is sent with `{delta, synthetic:true}` (`server.js:1043`). |
| `error` | `{error: string, recoverable?: boolean}` | Recoverable errors still allow a `done`. Mid-stream provider failure sets `recoverable:true` (`server.js:1028`). Fatal early errors (`empty message`, `stylistContext` failure) end the stream without `done`. |
| `done` | `{reply, outfit, weather, memory:{confidence,digest}, source}` | Final frame (`server.js:1066-1072`). |

Invariants that must not change:
- `done.reply === concat(delta.delta in arrival order)` for every completed stream. This is
  asserted by `test/backend_contract_test.dart:298-301`.
- The client tolerates unknown event names: `streamStylist` switches on `delta|error|done`
  with no default (`app_state.dart:1146-1157`). Adding new event types is client-safe.

### A.3 Non-streaming JSON (as built)

`POST /ai/chat` → `200`:

```json
{
  "reply": "…",
  "outfit": { "…": "…" },
  "followUp": "…",
  "intent": "build_outfit",
  "occasion": "date night",
  "constraints": { "colors": [], "styles": [], "avoid": [] },
  "weather": { "…": "…" },
  "memory": { "confidence": 0.42, "digest": "Likes: navy\nConfidence: 42% from 3 ratings, 5 chat signals" },
  "conversationId": "c1763290000000",
  "source": "gemini"
}
```

Source order (`server.js:874-965`): `stylistContext` → LLM `stylistChat` (structured JSON)
→ `buildOutfitFromIds` → rule fallback if no reply → `learnTurn` → persist → respond.

### A.4 `Weather` object shape (shared)

Produced by `weather.js:shape()` (`weather.js:89-108`), e.g.:

```json
{
  "tempC": 22,
  "feelsLike": 22,
  "condition": "partly cloudy",
  "tags": "partly cloudy",
  "city": "Cairo",
  "country": "EG",
  "humidity": 55,
  "precipitationChance": 5,
  "windKph": 9,
  "isDay": true,
  "highC": 26,
  "lowC": 17,
  "forecast": [],
  "source": "estimate",
  "summary": "Partly cloudy • 22°C"
}
```

### A.5 Outfit shapes by producer (as built)

| Producer | id pattern | `occasion` | `match` | `compatibilityScore` | `rankingScore` | `breakdown` | `completeness` | Extra |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `buildOutfitFromIds` (`server.js:812-850`) | `llm-<ts>` | Yes | int | No | No | 11 factors | **object** `{ratio,filled,required}` | used by chat + stream recovery |
| `toOutfit` (`ai-engine.js:236-254`) | `gen-<hash>` | Yes | int | = match | = match | 11 factors | **absent** | used by generate/recommend |
| match-outfit outfit (`server.js:1142-1155`) | `match-<ts>` | **absent** | int | No | No | 11 factors | **absent** | `vision.matchSpec` result |
| `finishRemix` (`ai-engine.js:418-441`) | `remix-<variant>-<ts>` | Yes | int | No | No | 11 factors | **object** | `variant, keptFromOriginal, regenerated, note?` |

Common fields in all four: `id`, `name`, `match`, `breakdown`, `explanation`, `itemIds`,
`pieces`, `items`, `image`. `items` is always the array of **full wardrobe item objects**
(`id, name, image, category, color, style, material, season, formality, timesWorn, …`).
The Desk canvas requires this and reads only `id/name/category/image|imageUrl`
(`stylist_desk_screen.dart:165-191`).

`Outfit.fromJson` tolerates missing scalar fields via defaults (`models.dart:221-255`) but
**does not tolerate** a non-numeric `completeness` (see §0.2.1).

### A.6 Current semantic gaps (summary)

- Stream lacks `intent`, `occasion`, `followUp`, `constraints`, `conversationId`.
- Stream entity grounding is heuristic; if fewer than two named items are found it attaches
  a freshly generated outfit that may not match the prose (`server.js:1044-1052`), with no
  provenance signal.
- `completeness` and `memory.digest` have backend/frontend type disagreements.
- `followUp` UI is dead on the stream path.
- Outfit objects are not semantically uniform across producers.

---

## B. Proposed Unified Semantic Contract

### B.1 Design principles

1. **Semantic consistency, not structural identity.** The stream and non-stream paths must
   expose the same meaning for the same fields. They do not need byte-identical envelopes.
2. **Additive only.** Every existing top-level and outfit field keeps its name and meaning.
3. **Text never carries metadata.** `reply` remains pure prose. `done.reply == deltas.join()`.
4. **One producer for every outfit.** All outfit paths go through a single normaliser so shape
   drift cannot reappear.
5. **No silent contradiction.** A generated fallback outfit is explicitly marked, never
   presented as if it were grounded in the prose.
6. **No filler fields.** Each added field has a verified consumer or a named future session.

### B.2 Canonical "stylist turn" envelope

Both `POST /ai/chat` (as the JSON body) and the streaming `done` event carry this envelope.
The streaming path additionally emits a partial `meta` event before the text finishes.

| Field | Type | Required | Nullable | Meaning | Example | Source of value |
| --- | --- | --- | --- | --- | --- | --- |
| `reply` | `string` | Yes | No (empty allowed only for fatal/no-reply edge cases) | Assistant prose. | `"It's 22°C — a light layer works. Try the Oxford Shirt with chinos."` | LLM `text` or `ai.chatReply().text` |
| `intent` | enum string: `build_outfit\|remix\|explain\|opinion\|learn\|chat` | Yes | No | What the user asked for. | `"build_outfit"` | LLM `intent`; rules `chatReply().intent`; stream annotation pass; default `"chat"` |
| `occasion` | `string` | Yes | Yes (`null` allowed) | Occasion used for grounding. | `"date night"` | LLM `occasion` → `ctx.occasion` (`detectOccasion` fallback) |
| `followUp` | `string` | No | Yes | One short suggested next question. | `"Want me to make it dressier?"` | LLM `followUp`; stream annotation pass; `null` without an LLM unless a deterministic suggestion exists |
| `suggestions` | `string[]` | No | No (empty array allowed) | Short contextual next actions for the composer/chips. | `["Swap the shoes","Make it more formal"]` | deterministic `suggestionsForTurn()` after contextual routing; shipped on `done`, never inside `delta` |
| `constraints` | `{colors:string[], styles:string[], avoid:string[]}` | Yes | No (empty arrays allowed) | Preferences/exclusions interpreted for this turn. | `{"colors":["navy"],"styles":[],"avoid":["sneakers"]}` | LLM `constraints`; message-derived rules; default empty object |
| `conversationId` | `string` | Yes | Yes | Thread identity (client-generated today). | `"c1763290000000"` | Request echo; `null` if not supplied |
| `outfit` | `Outfit \| null` | Yes | Yes | Canonical outfit (§D) or `null`. | see §F | normalized producer output |
| `weather` | `Weather` | Yes | No | Weather used for grounding. | see §A.4 | `resolveWeather()` |
| `memory` | `{confidence:number, digest:string, facets:MemoryFacets}` | Yes | No | Learned summary + structured facets. | see §B.3 | `memoryStore` |
| `source` | `string` | Yes | No | Engine provenance for the **text**. | `"gemini"`, `"rules"` | `llm.status().provider` or `"rules"` |
| `mode` | enum string: `stylist\|critic\|wardrobe\|shopping` | No | No | Reserved for Phase 4 modes. Omit or `"stylist"` until Session 10–11. | `"stylist"` | request/config (future) |
| `meta` | `object` | Yes | No | Processing metadata (§B.4). | see §B.4 | server |

`memory.digest` stays a **string** for backward compatibility. The structured summary is added
additively as `memory.facets` so `_applyMemory`/`_describeDna` can adopt it without a type change.

### B.3 `MemoryFacets` (new, additive)

```json
{
  "prefers": ["navy", "minimal"],
  "dislikes": ["neon"],
  "favouredStyles": ["smart casual"],
  "formalityLean": "relaxed",
  "avoid": ["sneakers"],
  "notes": ["Prefers breathable fabrics"],
  "confidence": 0.42,
  "totals": { "ratings": 3, "chats": 5 }
}
```

- Keys `prefers`, `dislikes`, `notes` deliberately match the keys
  `AppState._describeDna` already looks for (`app_state.dart:1246-1258`), so adoption is a
  one-line source change from `digest` to `facets`.
- `formalityLean` is `"relaxed"`, `"dressier"`, or `null`, mirroring `digest()` logic
  (`style-memory.js:607-610`).
- Source: `memory.colors`, `memory.styles`, `memory.facts`, `memory.avoid`, `memory.occasions`,
  `memory.totals`, `confidence`.

### B.4 `meta` object (new, additive)

| Field | Type | Required | Meaning | Example |
| --- | --- | --- | --- | --- |
| `contractVersion` | `integer` | Yes | Envelope version. Starts at `2`. | `2` |
| `requestId` | `string` | Yes | Correlates logs/telemetry for the turn. | `"req_8f2a1c"` |
| `generatedAt` | ISO-8601 `string` | Yes | When the turn was composed. | `"2026-11-16T13:45:00.000Z"` |
| `engine` | `string` | Yes | Engine that produced the reply (mirrors `source`). | `"gemini"` / `"rules"` |
| `degraded` | `boolean` | Yes | True when any stage fell back (LLM→rules, named→generated outfit, missing data). | `false` |
| `itemIdValidation` | `{requested:string[], valid:string[], dropped:string[]}` | Yes | Wardrobe validation report for IDs proposed during the turn. Empty arrays when not applicable. | `{"requested":["w_1","w_ghost"],"valid":["w_1"],"dropped":["w_ghost"]}` |

`requested` = IDs the LLM named or the rule engine selected; `valid` = IDs that exist in the
**current** wardrobe and survived garment-deduping; `dropped` = IDs that did not.
This is the single source of truth for "validated wardrobe item IDs".

### B.5 Explicit non-goals for this contract

- No `language` field. Arabic/English behaviour is Session 12; adding an unverified field now
  would be guesswork.
- No top-level `itemIds` duplicate. `outfit.itemIds` plus `meta.itemIdValidation` already
  express owned/validated IDs.
- No `ownedItems`/`missingItems`/`itemReasons` arrays. Those belong to Sessions 4 and 6 and
  require vision/gap work that does not exist yet.
- No multiple follow-ups array. The singular `followUp` matches the existing model and UI.

---

## C. Streaming Event Design

### C.1 Event catalogue

| Event | When | Payload | Text? |
| --- | --- | --- | --- |
| `meta` | Optional, once, before the first `delta` (or before `done` when there is no text) | Partial envelope: `{intent, occasion, constraints, conversationId, source, mode?, meta}`. Never contains `reply`/`delta`. | No |
| `delta` | Zero or more times | `{delta: string, synthetic?: true}` — unchanged. | Yes |
| `error` | Zero or more times | `{error: string, recoverable?: boolean}` — unchanged. `recoverable:true` ⇒ a `done` still follows. | No |
| `done` | Exactly once on success | Full envelope (§B.2), including `reply`, `outfit`, `weather`, `memory`, `suggestions`, `meta`. | No (carries final text, not a delta) |

No other events are required. `meta` is optional; old clients ignore unknown events.

### C.2 Ordering and invariants

```
[ meta? ]  ( delta*  [ error* ] )?  done        (success)
message empty / context failure:  error          (terminal, no done)
client disconnect: stream aborted; no done
```

Hard invariants:
1. `done.reply === deltas.map(d => d.delta).join('')`, preserving
   `test/backend_contract_test.dart:301`.
2. `meta` never contributes text and is never counted in the delta join.
3. `suggestions[]` travels on `done` (and non-stream JSON), never inside a text delta.
4. `done` is authoritative for structured data; `meta` is an early subset of the same values.
5. Field values in `meta` and `done` must agree (`intent`, `occasion`, `constraints`,
   `conversationId`, `source`).
6. Exactly one `done` per successful turn.
7. `synthetic:true` remains only on the single rule-engine delta.

### C.3 How the stream obtains structured metadata without breaking text

The current provider abstraction streams **plain prose only** (`llm.js:370-394`). Structured
LLM fields (`intent`, `itemIds`, `followUp`, `constraints`, `memoryNotes`) come from the
non-stream JSON call. The design therefore separates text generation from metadata generation.

**Recommended (two-phase, one user-visible stream):**

1. **Phase A — stream prose (unchanged).** `llm.streamChat` yields `delta` frames exactly as
   today. Emit `meta` first with values already known deterministically from `ctx`
   (`occasion`, `conversationId`, `source`, `meta`), plus `intent`/`constraints` from a local
   rule classifier. This `meta` event is emitted before the first token.
2. **Phase B — annotate after the text is complete (no user-visible latency for the text).**
   After the last delta, run one short structured call (same `STYLIST_SYSTEM` schema) using the
   finished reply + original message + shortlist to obtain `intent`, `itemIds`, `followUp`,
   `constraints`, `memoryNotes`. Then recover/validate the outfit from those `itemIds` first,
   falling back to `idsMentionedIn(reply)` and only then to generation (marked, §D.3).
   Emit `done` with the merged envelope. Phase B adds cost/latency only to the trailing
   completion, not to visible typing.

**Fallback annotations without an LLM:** derive `intent`/`occasion`/`outfit` from
`ai.chatReply`, set `constraints` from a deterministic message parser (or empty), set
`followUp` to a deterministic suggestion or `null`, and mark `meta.degraded=true`.

**Rejected alternative:** streaming structured JSON and extracting the `text` field from
partial JSON. It risks leaking JSON fragments into `delta`, makes `reply == deltas.join()`
fragile, and changes provider behaviour. It is listed as an open question (§H) but not
recommended.

### C.4 Compatibility on the wire

- Old Flutter clients: `streamStylist` already ignores unknown event names and reads only
  `delta/error/done` (`app_state.dart:1146-1157`). A new `meta` event is invisible to them.
- Old clients still get every legacy `done` field unchanged.
- New clients may read `meta` early (e.g., to show intent/filters) and `done` for the full
  turn.
- No content negotiation or version header is required. `meta.contractVersion` allows future
  clients to branch if needed.

---

## D. Outfit Contract

### D.1 Canonical `Outfit` schema

All producers MUST emit these fields (optional fields may be `null`, but must be present or
safely defaultable by the existing model):

| Field | Type | Required | Nullable | Meaning |
| --- | --- | --- | --- | --- |
| `id` | `string` | Yes | No | Outfit identity. Keep existing `llm-/gen-/match-/remix-` prefixes. |
| `name` | `string` | Yes | No | Human name. |
| `occasion` | `string` | No | Yes | Occasion used for scoring. **Match outfits must add this.** |
| `match` | `integer 0..100` | Yes | No | Legacy compatibility number. Preserved exactly. |
| `compatibilityScore` | `integer 0..100` | No | Yes | Explained 11-factor compatibility. For chat/recovered/match/remix set equal to `match`. |
| `rankingScore` | `integer` | No | Yes | Recommendation-engine ordering score only. Never displayed as Match %. |
| `breakdown` | `MatchFactor[11]` | Yes | No | 11-factor report (`key,label,value,weight,applied,contribution`). |
| `explanation` | `string` | Yes | No | Prose derived from the actual arithmetic. |
| `itemIds` | `string[]` | Yes | No (empty only when `outfit` itself is `null`) | **Validated, owned, garment-deduped** wardrobe IDs. |
| `pieces` | `string[]` | Yes | No | Names parallel to `itemIds`. |
| `items` | `WardrobeItem[]` | Yes | No | Full wardrobe item objects. **Desk canvas contract.** |
| `image` | `string` | No | Yes | Primary image (first item). |
| `completeness` | `number 0..1` | No | Yes | **Normalized ratio** (see D.4). |
| `completenessDetail` | `{ratio:number,filled:int,required:int}` | No | Yes | **New additive** detailed gate, carrying the old object form. |
| `variant` | `string` | No | Yes | Remix variant. |
| `note` | `string` | No | Yes | Remix note. |
| `keptFromOriginal` | `integer` | No | Yes | Remix survival count. |
| `regenerated` | `boolean` | No | Yes | Remix rebuilt flag. |
| `provenance` | enum string | Yes | No | **New additive.** `llm_ids \| recovered_from_reply \| generated_fallback \| rule_fallback \| generated \| match \| remix`. |
| `grounding` | `{recoveredItemIds:string[], usedFallback:boolean, allOwned:boolean}` | Yes | No | **New additive.** How the outfit relates to the reply/wardrobe. |

### D.2 Producer mapping (current → canonical)

| Producer | Keep as-is | Add | Notes |
| --- | --- | --- | --- |
| `buildOutfitFromIds` | `id,name,occasion,match,breakdown,explanation,itemIds,pieces,items,image` | `compatibilityScore=match`, `rankingScore=null`, `completeness=<ratio>`, `completenessDetail=<old object>`, `provenance='llm_ids'` (or `'recovered_from_reply'` when called from stream recovery), `grounding={recoveredItemIds:itemIds, usedFallback:false, allOwned:true}` | Dedupe by `tax.garmentKey` already exists; keep. |
| `toOutfit` | all current fields | `completeness`, `completenessDetail`, `provenance='generated'`, `grounding={recoveredItemIds:[], usedFallback:false, allOwned:true}` | When used as the stream fallback, override `provenance='generated_fallback'`, `usedFallback:true`. |
| match-outfit outfit | all current fields | `occasion`, `compatibilityScore=match`, `rankingScore=null`, `completeness`, `completenessDetail`, `provenance='match'`, `grounding` | `items` already wardrobe objects. |
| `finishRemix` | all current fields | `compatibilityScore=match`, `rankingScore=null`, `completeness=<ratio>`, `completenessDetail`, `provenance='remix'`, `grounding` | Preserve `variant/note/keptFromOriginal/regenerated`. |
| `ai.chatReply` fallback | outfit from `generateOutfits` | same as `toOutfit`, then `provenance='rule_fallback'`, `grounding.usedFallback=true` unless the reply was built around that exact look | The prose describes the attached outfit, so this is not a contradiction; provenance documents it. |

A single `normalizeOutfit(outfit, {provenance, grounding})` helper should own this mapping so
future producers cannot drift.

### D.3 Validation and the "silent contradiction" guard

- `validateItemIds(proposedIds, wardrobe)`:
  1. Filter to ids present in the **current, non-archived** wardrobe.
  2. Dedupe by `tax.garmentKey` (same rule as `buildOutfitFromIds`/`remixOutfit`).
  3. Return `{valid, dropped}`.
- `outfit.itemIds` contains only `valid` ids. `meta.itemIdValidation` records
  `requested/valid/dropped`.
- An outfit is only constructed when `valid.length >= 2` (matching the current builder).
- **Stream recovery order (recommended):**
  1. Structured `itemIds` from the annotation pass, validated.
  2. `idsMentionedIn(reply)`, validated.
  3. `generateOutfits()[0]` **only** as a marked fallback:
     `provenance='generated_fallback'`, `grounding.usedFallback=true`,
     `meta.degraded=true`.
- The reply text is never rewritten to match a fallback outfit. Instead the contradiction is
  made explicit via provenance. Sessions 4/5 can decide to withhold an ungrounded outfit or
  ask a clarifying question. This session only specifies the signal, not new UX.

### D.4 The `completeness` normalization decision

Current state is contradictory: some producers send an object, the Flutter model expects a
number. The design normalizes the public field:

- `completeness: number` (ratio 0..1) in **all** producers — what `Outfit.fromJson` already
  expects.
- `completenessDetail: {ratio, filled, required}` — new additive field for clients/telemetry
  that want the full gate.

Risk note: any unknown external consumer that read the old object would need
`completenessDetail`. No such consumer exists in this repository (verified by search); the only
in-repo consumer expects a number and currently crashes on the object. This is therefore a
compatibility **fix** with a documented fallback field, not a silent break. It is also listed
as an open question (§H) in case an out-of-repo client exists.

---

## E. Backward Compatibility

### E.1 What is preserved verbatim

- Streaming `delta` frames, `error` frames, and `done.reply == deltas.join()`.
- `done` always includes `reply`, `outfit`, `weather`, `memory`, `source`.
- Non-stream always includes `reply`, `outfit`, `followUp`, `intent`, `occasion`,
  `constraints`, `weather`, `memory`, `conversationId`, `source`.
- Outfit legacy fields: `id,name,occasion,match,breakdown,explanation,itemIds,pieces,items,image`.
- Outfit optional legacy fields where present: `compatibilityScore,rankingScore,variant,note,
  keptFromOriginal,regenerated`.
- `outfit.items[]` remains full wardrobe objects required by the Desk canvas.
- `outfit.itemIds` remains owned wardrobe IDs; `match` remains an integer.
- `source` semantics unchanged.
- Valid wardrobe item IDs and meanings unchanged.

### E.2 Migration strategy (incremental, additive)

1. **Backend first, additive only.** Add `meta` event and new envelope fields. Keep every old
   field. Deploy with no Flutter changes; old clients keep working.
2. **Fix the two type drifts in a backward-compatible direction.**
   - `completeness`: number + new `completenessDetail` (§D.4).
   - `memory.digest`: keep string, add `memory.facets`.
   Neither removes a field.
3. **Flutter adopts new fields gradually.**
   - Phase 1: extend `AppState.streamStylist` return record with optional `followUp`,
     `intent`, `occasion`, `constraints`, `memoryFacets`, `meta` (all nullable).
   - Phase 2: pass `followUp` into the finished `ChatMessage` in both screens; point
     `_applyMemory` at `memory.facets`.
   - Phase 3 (optional): use `outfit.provenance`/`meta.degraded` to adjust UI copy.
   Each phase is independently shippable and degrades to today's behaviour if fields are absent.
4. **Old/new clients coexist.** Server sends a superset; old clients read the subset they know;
   new clients read the superset. No version negotiation required. `meta.contractVersion`
   enables future branching.
5. **Tests preserved.** `backend_contract_test.dart` keeps passing because it asserts only
   legacy fields plus the delta-join invariant. New assertions are added alongside, not by
   replacing them.

### E.3 Regression risks and prevention

| Risk | Why it could happen | Prevention |
| --- | --- | --- |
| `done.reply != deltas.join()` | Metadata accidentally emitted as a `delta`, or Phase B rewrites text | Keep text generation single-source; assert equality in backend + Flutter contract tests; `meta` carries no text |
| Old client breaks on unknown event | A parser rejects unmapped events | Verified current parser ignores unknown events; keep `meta` optional and non-fatal |
| Outfit parse crash from `completeness` | Object form still emitted | Normalize to number in one helper; add a test that parses every producer's outfit through `Outfit.fromJson` |
| Follow-up duplicated or lost | Two sources of `followUp` | `done.followUp` is the only structured source; UI sets it after `done`, never from deltas |
| Silent contradiction between prose and fallback outfit | Generation fallback unattributed | `provenance='generated_fallback'`, `grounding.usedFallback=true`, `meta.degraded=true` |
| Hallucinated IDs enter `outfit.itemIds` | LLM names unknown IDs | `validateItemIds` drops unknown ids; `meta.itemIdValidation.dropped` records them |
| `match` changes meaning | Confusing `compatibilityScore`/`rankingScore` | Keep `match` as compatibility alias (already enforced by `finish()`), never use ranking score |
| Extra LLM annotation call changes text | Annotation call regenerates prose | Annotation prompt must be extraction-only; never used for `reply`; Phase A text is authoritative |
| `memory.digest` object shift breaks clients | Changing its type | Keep string; add `facets` |
| Stream timeout/latency regression | Phase B blocks `done` | Phase B is bounded and optional; on timeout emit `done` with deterministic metadata and `degraded=true` |
| Persisted conversation schema gains fields | Uncontrolled writes | Do not change `db.conversations` shape in this design; only summary fields if needed in Session 3 with non-destructive defaults |

---

## F. Concrete Examples

> IDs, names, images and numbers are illustrative. Real wardrobe IDs are `w_<hash>`.
> `breakdown` is abbreviated to a few entries for readability; in reality it has 11 entries.

### F.1 Complete non-streaming response

```json
{
  "reply": "It's a mild 22°C tonight — perfect for the navy blazer. I'd wear it with the white Oxford and black loafers.",
  "intent": "build_outfit",
  "occasion": "date night",
  "followUp": "Want me to soften it with a knit instead of the blazer?",
  "constraints": { "colors": ["navy"], "styles": [], "avoid": [] },
  "conversationId": "c1763290000000",
  "outfit": {
    "id": "llm-1763290000000",
    "name": "Sharp Layered Look",
    "occasion": "date night",
    "match": 88,
    "compatibilityScore": 88,
    "rankingScore": null,
    "breakdown": [
      { "key": "color_harmony", "label": "Color harmony", "value": 91, "weight": 0.16, "applied": true, "contribution": 14.6 },
      { "key": "occasion_fit", "label": "Occasion fit", "value": 90, "weight": 0.14, "applied": true, "contribution": 12.6 },
      { "key": "weather_match", "label": "Weather match", "value": 84, "weight": 0.11, "applied": true, "contribution": 9.2 }
    ],
    "completeness": 1.0,
    "completenessDetail": { "ratio": 1.0, "filled": 3, "required": 3 },
    "explanation": "The navy-to-white contrast and matching dress shoes make this an easy evening look for 22°C.",
    "itemIds": ["w_blazer_navy", "w_oxford_white", "w_loafers_black"],
    "pieces": ["Navy Blazer", "White Oxford Shirt", "Black Leather Loafers"],
    "items": [
      { "id": "w_blazer_navy", "name": "Navy Blazer", "image": "http://localhost:3001/storage/blazer.webp", "category": "Outerwear", "color": "Navy", "style": "Formal", "material": "Wool", "season": "Autumn / Winter", "formality": "Formal", "timesWorn": 2 },
      { "id": "w_oxford_white", "name": "White Oxford Shirt", "image": "http://localhost:3001/storage/oxford.webp", "category": "Tops", "color": "White", "style": "Formal", "material": "Cotton", "season": "All Season", "formality": "Smart Casual", "timesWorn": 4 },
      { "id": "w_loafers_black", "name": "Black Leather Loafers", "image": "http://localhost:3001/storage/loafers.webp", "category": "Shoes", "color": "Black", "style": "Formal", "material": "Leather", "season": "All Season", "formality": "Formal", "timesWorn": 1 }
    ],
    "image": "http://localhost:3001/storage/blazer.webp",
    "provenance": "llm_ids",
    "grounding": {
      "recoveredItemIds": ["w_blazer_navy", "w_oxford_white", "w_loafers_black"],
      "usedFallback": false,
      "allOwned": true
    }
  },
  "weather": {
    "tempC": 22, "feelsLike": 22, "condition": "partly cloudy", "tags": "partly cloudy",
    "city": "Cairo", "country": "EG", "humidity": 55, "precipitationChance": 5,
    "windKph": 9, "isDay": true, "highC": 26, "lowC": 17, "forecast": [],
    "source": "estimate", "summary": "Partly cloudy • 22°C"
  },
  "memory": {
    "confidence": 0.42,
    "digest": "Likes: navy\nConfidence: 42% from 3 ratings, 5 chat signals",
    "facets": {
      "prefers": ["navy"],
      "dislikes": [],
      "favouredStyles": ["formal"],
      "formalityLean": "dressier",
      "avoid": [],
      "notes": [],
      "confidence": 0.42,
      "totals": { "ratings": 3, "chats": 5 }
    }
  },
  "source": "gemini",
  "mode": "stylist",
  "meta": {
    "contractVersion": 2,
    "requestId": "req_8f2a1c",
    "generatedAt": "2026-11-16T13:45:00.000Z",
    "engine": "gemini",
    "degraded": false,
    "itemIdValidation": {
      "requested": ["w_blazer_navy", "w_oxford_white", "w_loafers_black"],
      "valid": ["w_blazer_navy", "w_oxford_white", "w_loafers_black"],
      "dropped": []
    }
  }
}
```

### F.2 Streaming sequence with several deltas and completion

```
event: meta
data: {"intent":"build_outfit","occasion":"date night","constraints":{"colors":[],"styles":[],"avoid":[]},"conversationId":"c1763290000000","source":"gemini","mode":"stylist","meta":{"contractVersion":2,"requestId":"req_8f2a1c","generatedAt":"2026-11-16T13:45:00.000Z","engine":"gemini","degraded":false}}

event: delta
data: {"delta":"It's a mild 22°C tonight — "}

event: delta
data: {"delta":"perfect for the navy blazer. "}

event: delta
data: {"delta":"I'd wear it with the white Oxford and black loafers."}

event: done
data: {"reply":"It's a mild 22°C tonight — perfect for the navy blazer. I'd wear it with the white Oxford and black loafers.","intent":"build_outfit","occasion":"date night","followUp":"Want me to soften it with a knit instead of the blazer?","constraints":{"colors":[],"styles":[],"avoid":[]},"conversationId":"c1763290000000","outfit":{"id":"llm-1763290000000","name":"Sharp Layered Look","occasion":"date night","match":88,"compatibilityScore":88,"rankingScore":null,"breakdown":[{"key":"color_harmony","label":"Color harmony","value":91,"weight":0.16,"applied":true,"contribution":14.6}],"completeness":1.0,"completenessDetail":{"ratio":1.0,"filled":3,"required":3},"explanation":"Easy evening look for 22°C.","itemIds":["w_blazer_navy","w_oxford_white","w_loafers_black"],"pieces":["Navy Blazer","White Oxford Shirt","Black Leather Loafers"],"items":[{"id":"w_blazer_navy","name":"Navy Blazer","image":"http://localhost:3001/storage/blazer.webp","category":"Outerwear"},{"id":"w_oxford_white","name":"White Oxford Shirt","image":"http://localhost:3001/storage/oxford.webp","category":"Tops"},{"id":"w_loafers_black","name":"Black Leather Loafers","image":"http://localhost:3001/storage/loafers.webp","category":"Shoes"}],"image":"http://localhost:3001/storage/blazer.webp","provenance":"recovered_from_reply","grounding":{"recoveredItemIds":["w_blazer_navy","w_oxford_white","w_loafers_black"],"usedFallback":false,"allOwned":true}},"weather":{"tempC":22,"condition":"partly cloudy","summary":"Partly cloudy • 22°C"},"memory":{"confidence":0.42,"digest":"Likes: navy","facets":{"prefers":["navy"],"dislikes":[],"notes":[],"confidence":0.42,"totals":{"ratings":3,"chats":5}}},"source":"gemini","mode":"stylist","meta":{"contractVersion":2,"requestId":"req_8f2a1c","generatedAt":"2026-11-16T13:45:00.000Z","engine":"gemini","degraded":false,"itemIdValidation":{"requested":["w_blazer_navy","w_oxford_white","w_loafers_black"],"valid":["w_blazer_navy","w_oxford_white","w_loafers_black"],"dropped":[]}}}
```

`done.reply` equals the three `delta` values joined exactly.

### F.3 Outfit modification response (`POST /ai/remix`)

The remix endpoint is not a chat turn, so it keeps its existing top-level shape
(`{outfit, variants, labels}`). The outfit now follows the canonical contract.

```json
{
  "outfit": {
    "id": "remix-casual-1763290123456",
    "name": "Effortless Everyday · Casual version",
    "variant": "casual",
    "occasion": "casual",
    "match": 81,
    "compatibilityScore": 81,
    "rankingScore": null,
    "breakdown": [
      { "key": "color_harmony", "label": "Color harmony", "value": 88, "weight": 0.16, "applied": true, "contribution": 14.1 },
      { "key": "occasion_fit", "label": "Occasion fit", "value": 79, "weight": 0.14, "applied": true, "contribution": 11.1 }
    ],
    "completeness": 0.67,
    "completenessDetail": { "ratio": 0.67, "filled": 2, "required": 3 },
    "explanation": "Kept the white Oxford and swapped in the stone chinos for a relaxed weekend feel.",
    "itemIds": ["w_oxford_white", "w_chinos_stone"],
    "pieces": ["White Oxford Shirt", "Stone Chinos"],
    "items": [
      { "id": "w_oxford_white", "name": "White Oxford Shirt", "image": "http://localhost:3001/storage/oxford.webp", "category": "Tops", "color": "White", "style": "Formal", "formality": "Smart Casual" },
      { "id": "w_chinos_stone", "name": "Stone Chinos", "image": "http://localhost:3001/storage/chinos.webp", "category": "Bottoms", "color": "Beige", "style": "Casual", "formality": "Casual" }
    ],
    "image": "http://localhost:3001/storage/oxford.webp",
    "keptFromOriginal": 1,
    "regenerated": false,
    "provenance": "remix",
    "grounding": {
      "recoveredItemIds": ["w_oxford_white", "w_chinos_stone"],
      "usedFallback": false,
      "allOwned": true
    }
  },
  "variants": ["casual", "cold", "summer", "date", "formal"],
  "labels": {
    "casual": "Casual version",
    "cold": "Cold version",
    "summer": "Summer version",
    "date": "Date version",
    "formal": "Formal version"
  }
}
```

### F.4 Response where no suitable wardrobe items exist

Non-stream (`outfit: null`; no fabricated look):

```json
{
  "reply": "I don't have enough pieces to build a full look yet. Add a top, a bottom and shoes and I'll put something together.",
  "intent": "build_outfit",
  "occasion": "casual",
  "followUp": "Want me to suggest the three pieces your wardrobe is missing?",
  "constraints": { "colors": [], "styles": [], "avoid": ["sneakers"] },
  "conversationId": "c1763290999999",
  "outfit": null,
  "weather": {
    "tempC": 24, "condition": "clear sky", "city": "Cairo", "summary": "Clear sky • 24°C",
    "source": "estimate", "forecast": []
  },
  "memory": {
    "confidence": 0.1,
    "digest": "No learned preferences yet.",
    "facets": { "prefers": [], "dislikes": [], "favouredStyles": [], "formalityLean": null, "avoid": ["sneakers"], "notes": [], "confidence": 0.1, "totals": { "ratings": 0, "chats": 1 } }
  },
  "source": "gemini",
  "mode": "stylist",
  "meta": {
    "contractVersion": 2,
    "requestId": "req_9c11de",
    "generatedAt": "2026-11-16T13:50:00.000Z",
    "engine": "gemini",
    "degraded": true,
    "itemIdValidation": {
      "requested": ["w_top_white", "w_ghost_pants"],
      "valid": ["w_top_white"],
      "dropped": ["w_ghost_pants"]
    }
  }
}
```

Streaming equivalent: the same `reply` arrives as deltas, and `done` carries the same envelope
with `outfit: null`. A `delta` is never emitted for metadata, and a fallback outfit is not
invented just to make `done.outfit` non-null.

---

## G. Implementation Plan (do not implement in Session 2)

Each step is independently shippable and additive. "Files likely to change" are predictions.

### Step 1 — Introduce the contract helper layer (backend, no route change)

- **Files:** new `backend/src/response-contract.js` (or helpers in `server.js` + `ai-engine.js`);
  `backend/test/response-contract.test.js`.
- **Backend:** `validateItemIds(ids, wardrobe)`, `normalizeOutfit(outfit, opts)`,
  `memoryFacets(memory)`, `baseMeta()`.
- **Flutter:** none.
- **Tests:** unit tests for dedupe, invalid id dropping, `completeness` normalization, facets.
- **Compatibility risk:** none (unused by routes).
- **Acceptance:** helpers exported and unit-tested; no endpoint output changes yet.

### Step 2 — Normalize all outfit producers

- **Files:** `server.js` (`buildOutfitFromIds`, match outfit), `ai-engine.js` (`toOutfit`,
  `finishRemix`).
- **Backend:** route all four through `normalizeOutfit`; set `provenance`/`grounding`;
  `completeness` number + `completenessDetail`.
- **Flutter:** none required (fixes the `completeness` crash); optionally add
  `completenessDetail` parsing.
- **Tests:** a test that feeds a fabricated outfit from each producer through the equivalent
  of `Outfit.fromJson` field expectations; assert identical key set and types.
- **Compatibility risk:** any external reader of the old object `completeness`.
- **Acceptance:** every outfit from every endpoint has the same keys/types; `match` unchanged.

### Step 3 — Extend non-stream `/ai/chat` additively

- **Files:** `server.js`.
- **Backend:** add `meta`, `memory.facets`, outfit provenance; keep every existing field.
  Ensure rule fallback returns `constraints`/`followUp` (or explicit `null`).
- **Flutter:** none required.
- **Tests:** extend `backend_contract_test.dart` (new assertions only) + a backend schema test.
- **Compatibility risk:** low (superset).
- **Acceptance:** old contract assertions still pass; new fields present and typed.

### Step 4 — Extend streaming `done` and add the `meta` event

- **Files:** `server.js` (`/ai/chat/stream`).
- **Backend:** emit `meta` before the first delta; include `intent/occasion/followUp/constraints/
  conversationId/meta` in `done`; use `normalizeOutfit`; keep delta text byte-identical.
- **Flutter:** none required (unknown event ignored); old fields unchanged.
- **Tests:** assert delta-join equality with new fields present; assert `meta` is not counted;
  assert `done` is a superset.
- **Compatibility risk:** medium if metadata accidentally becomes a delta.
- **Acceptance:** `done.reply == deltas.join()`; legacy assertions pass; `meta` optional.

### Step 5 — Stream structured annotation strategy (two-phase)

- **Files:** `llm.js`, `server.js`.
- **Backend:** after the prose stream, run a bounded extraction call for
  `intent/itemIds/followUp/constraints/memoryNotes`; merge into `done`; validate outfit via
  Step 1 helpers; mark `generated_fallback`/`degraded` when used. On timeout, fall back to
  deterministic metadata.
- **Flutter:** none.
- **Tests:** mock/stub provider annotation; assert text unaffected; assert fallback marking.
- **Compatibility risk:** latency/cost at completion; annotation must not alter prose.
- **Acceptance:** semantics match non-stream for the same input; text invariant intact.

### Step 6 — Flutter model + state adoption

- **Files:** `lib/data/app_state.dart`, `lib/data/models.dart`, possibly
  `lib/core/api/api_client.dart` docs.
- **Flutter:** extend `streamStylist` return record with nullable `followUp`, `intent`,
  `occasion`, `constraints`, `memoryFacets`, `meta`; parse `completenessDetail`; point
  `_applyMemory` at `memory.facets` (keeping string `digest` fallback).
- **Backend:** none.
- **Tests:** unit/widget tests for parsing missing/extra fields; ensure defaults preserve
  today's behaviour.
- **Compatibility risk:** parser must tolerate absent new fields (old servers).
- **Acceptance:** works against both old and new backends.

### Step 7 — Wire follow-up and provenance into the screens

- **Files:** `lib/features/stylist/stylist_screen.dart`,
  `lib/features/stylist/stylist_desk_screen.dart`.
- **Flutter:** set `ChatMessage.followUp` from the returned turn; optionally show a
  "generated suggestion" note when `grounding.usedFallback` or `meta.degraded`.
- **Backend:** none.
- **Tests:** widget test that `followUp` renders on the stream path; golden/regression check
  that outfit cards are unchanged.
- **Compatibility risk:** duplicated follow-up if both delta and done drive UI; use `done` only.
- **Acceptance:** follow-up bubble appears on both screens; no visual regressions.

### Step 8 — Contract test expansion and telemetry

- **Files:** `test/backend_contract_test.dart`, `backend/test/*`, `server.js` telemetry.
- **Backend:** record `requestId`, `degraded`, `itemIdValidation` counts in `trackAi`.
- **Tests:** assert new fields, `meta` event, provenance, and the no-items `outfit:null` case.
- **Compatibility risk:** live-backend tests still skip when the backend is down.
- **Acceptance:** new coverage is additive and legacy assertions unchanged.

### Step 9 — Capabilities/documentation sync

- **Files:** `server.js` (`/ai/capabilities`), `AI_UPGRADE.md`.
- **Backend:** expose `contractVersion: 2` and `structuredStream: true` when Step 5 is live.
- **Tests:** capability assertions.
- **Acceptance:** capabilities reflect actual behaviour, not aspirational behaviour.

---

## H. Open Questions (must be resolved before/within Session 3)

1. **Phase-B annotation cost/latency.** Is a second structured call acceptable on the streaming
   path, or should stream metadata be rules-derived only? Needs a product call. The contract
   supports either; only `followUp`/`constraints` quality differs.
2. **`completeness` type.** Confirm no out-of-repo client reads the object form. If one exists,
   keep the object publicly and fix only `Outfit.fromJson`, using `completenessDetail` as the
   canonical detailed field.
3. **Intent enum authority.** Should stream `intent` be forced to match the non-stream LLM
   classification exactly, or is a rules-derived intent acceptable when no annotation call runs?
4. **Fallback policy.** When the LLM prose names fewer than two owned items, should the server
   (a) attach a marked generated fallback (current behaviour + provenance), or (b) return
   `outfit: null` and a clarifying `followUp`? This affects backward compatibility with the
   existing stream contract test scenario.
5. **`mode` field.** Reserve it now (default `"stylist"`) or defer entirely to Sessions 10–11?
6. **Conversation persistence.** Should the structured turn (intent/followUp/constraints) be
   stored in `db.conversations`, or only the current message/reply/itemIds? Session 8 will need
   richer context; changing the persisted shape must be non-destructive.
7. **Item validation across turns.** If a conversation history references an item since
   archived/deleted, should it be dropped from context silently or surfaced via
   `meta.itemIdValidation.dropped`? This design assumes dropping + reporting.
8. **Language.** No `language` field exists or is verified. Arabic/Egyptian Arabic handling and
   any language metadata are deferred to Session 12; do not add speculative fields now.
9. **`followUp` with no LLM.** Is `null` acceptable, or should the rule engine emit a
   deterministic suggestion? The contract allows `null`; UX decision pending.
10. **Multiple follow-ups.** The model exposes a single `followUp`. If a future UI wants
    several, it needs a new field and model change; do not overload the existing one.

---

## I. Summary of what Session 3 may implement (scope guard)

Session 3 may implement **only** the additive contract and its tests as described in §G:
normalized outfits, extended `done`, an optional `meta` event, `meta`/`memory.facets`, and the
Flutter parsing/wiring needed to consume them. It must **not** start wardrobe-gap reasoning,
hallucination prevention beyond ID validation, contextual editing, stylist modes, or Arabic
testing (Sessions 4–12).
