# SmartWardrobe backend (§5–§8)

The canonical backend is the **NestJS** application in `src/`. It uses a
normalised TypeORM schema on **MySQL only** (utf8mb4). A reachable MySQL
server is required: there is no SQLite fallback, so set `DB_HOST`/`DB_PORT`/
`DB_USERNAME`/`DB_PASSWORD`/`DB_NAME` (see `.env.example`) before booting.

The legacy Express runtime and the file-backed JSON store have been removed.
The NestJS app is the only runtime, and TypeORM is the only source of truth for
application data (uploaded images stay in file/object storage).

## Run

```bash
cd backend
npm install
npm run setup:models   # one-time: download local AI models (see below)
npm run dev            # NestJS with watch → http://localhost:3002/api
# → Swagger UI: http://localhost:3002/docs
```

The Flutter app auto-connects (Android emulator: `10.0.2.2:3002`,
desktop/iOS/Chrome: `localhost:3002`) under the `/api` prefix. If the backend is
down the app shows an offline/empty state; there is no bundled mock fallback.

## Local AI models (backend/.model-cache)

The local transformers.js pipeline is used by the NestJS clothing-vision
analyzer and the rule-based stylist. It never needs an API key:

| Model | Purpose | Loader |
| --- | --- | --- |
| `Marqo/marqo-fashionSigLIP` (default; `VISION_MODEL=clip` uses marqo-fashionCLIP) | clothing/non-clothing gate + all attributes (768-dim) | `src/clothing-vision/encoder.ts` |
| `Xenova/all-MiniLM-L6-v2` | semantic retrieval (384-dim) | `src/retrieval.ts` |

Both load lazily from `backend/.model-cache` (set explicitly by both loaders).
Weights are ignored by git; on a fresh clone run `npm run setup:models` (reuses
the app's own loaders, so it fetches exactly what the server loads, downloads
only missing files, and never overwrites an existing cache).

> **Model reproducibility note.** Models resolve from the Hugging Face Hub
> default `main` revision. The flat transformers.js cache does not record the
> original commit SHA, so none is hard-coded (no guessing). To lock a revision
> later, add `revision` to the `from_pretrained`/`pipeline` options in the two
> loaders. Current `main` SHAs seen during setup: `Marqo/marqo-fashionSigLIP`
> is not pinned on the Node side, `Xenova/all-MiniLM-L6-v2` →
> `751bff37182d3f1213fa05d7196b954e230abad9`.

## API map (spec §8)

Auth: `POST /auth/register|login|refresh|logout`
Users: `GET|PATCH /users/me`, `POST /users/me/avatar`,
`GET|PATCH /users/me/style-profile`
Storage: `POST /wardrobe/upload` (multipart `photos[]`, max 10 × 10MB),
files are written to `backend/storage/` and served at `GET /storage/<file>`
Wardrobe: `GET|POST /wardrobe/items`, `GET|PATCH|DELETE /wardrobe/items/:id`,
`POST /wardrobe/items/batch-upload`, `GET /wardrobe/collections`
AI: `POST /ai/analyze-clothing|generate-outfit|calculate-compatibility|style-profile|wardrobe-gap|packing-list|chat`,
`POST /ai/chat/stream` (SSE), `POST /ai/match-outfit` (photo → own wardrobe),
`POST /ai/remix`, `GET /ai/style-dna`, `GET|DELETE /ai/conversations`,
`GET /ai/capabilities`
Outfits: `GET /outfits/recommended`, `POST|GET|PATCH|DELETE /outfits…`,
`POST /outfits/:id/favorite|feedback`
Planner: `GET|POST|PATCH|DELETE /events`, `GET|POST /planner/weekly`,
`POST /travel/packing-list`
Shopping: `GET /shop/recommended`, `POST /shop/before-you-buy`,
`GET|POST /shop/wishlist`
Admin: `GET /admin/dashboard|users|ai-performance|reports|system-health`
Misc: `GET /weather/current`, `GET /health`, `GET /docs`

## AI Stylist

The stylist works with **no API key at all**. Every endpoint below has a
rule-engine answer, and `GET /ai/capabilities` reports what is currently
enabled and how to turn the rest on.

| Capability | Needs | Without it |
| --- | --- | --- |
| Conversation memory, 11-factor scoring, remixes, style DNA | nothing | — |
| Live weather | nothing (Open-Meteo) | seasonal estimate |
| Streaming replies | an LLM key | whole reply in one `delta` |
| Photo → outfit matching | LLM key **with vision** | plan derived from the filename |
| Semantic retrieval | MiniLM q8 (via `npm run setup:models`) | lexical scorer |

`npm install` does **not** pull the embedding runtime in — it is an
`optionalDependencies` entry. Skipping it keeps the install small; the server
detects its absence and uses the lexical scorer instead.

Free keys, no card required:

```bash
# backend/.env
GEMINI_API_KEY=…        # https://aistudio.google.com/apikey  (default)
# GROQ_API_KEY=…       # https://console.groq.com/keys
# OPENROUTER_API_KEY=… # https://openrouter.ai/keys
# OPENAI_API_KEY=…
# LLM_PROVIDER=gemini   # optional: force a provider
# LLM_MODEL=gemini-flash-lite-latest   # optional: pin one; unset rotates on quota errors
# LLM_TIMEOUT_MS=25000
# EMBEDDINGS=on         # `off` forces lexical retrieval
```

Embeddings run locally on `Xenova/all-MiniLM-L6-v2` (384-dim, downloaded once
on first use). `retrieval.js` tries `@huggingface/transformers` first and falls
back to the retired `@xenova/transformers` if you already have it installed; it
is deliberately not listed as a dependency because that package pulls a
critical `protobufjs` advisory into the tree. If neither is installed, or
`EMBEDDINGS=off`, retrieval silently degrades to the lexical scorer and
`GET /ai/capabilities` reports `fallback: "lexical"` with the reason.

### Modules

| File | Responsibility |
| --- | --- |
| `src/taxonomy.js` | hue/harmony, formality scale, occasion targets, fabric warmth, season fit, slot definitions |
| `src/scoring.js` | the 11 factors, signal-aware renormalisation, completeness gate, logistic calibration, `explain()` |
| `src/style-memory.js` | per-attribute learning, chat-sentiment mining, confidence, `factorWeights()`, `styleDna()` |
| `src/retrieval.js` | optional MiniLM embeddings with a lexical fallback, category-balanced ranking |
| `src/weather.js` | keyless Open-Meteo, OWM fallback, seasonal estimate, caching |
| `src/vision.js` | reference-outfit spec parsing and matching against the wardrobe |
| `src/llm.js` | provider calls: structured chat, SSE streaming, outfit description |
| `src/ai-engine.js` | beam search, remixes, occasion detection, offline chat, gaps, packing |

Scoring notes: a factor with no evidence (no style profile, no ratings) is
**excluded and the weights renormalised** rather than contributing a constant,
and completeness is a hard gate — an outfit missing a required slot is capped.

Learning notes: chat is mined **clause by clause**, so "I always wear navy. I
hate bright colours and never wear sneakers." records navy as liked and
sneakers as excluded. Absolute statements ("never/avoid/stop wearing X") are
kept as hard exclusions and filtered out of generation, not scored — so they
also apply to remixes, which the stylist screen offers on any outfit. Footwear
is exempt from the remix formality *ceiling*: a casual look in loafers is
ordinary, a casual look with no shoes cannot be worn.

## Legacy AI service (optional, §6.3)

```bash
cd ai-service
pip install -r requirements.txt
uvicorn main:app --port 8000
# backend/.env: AI_SERVICE_URL=http://localhost:8000
```

`/ai/chat` and `/ai/generate-outfit` no longer depend on it — they use the
in-process engine. Auth is demo-grade SHA-256 — swap for `@nestjs/jwt` +
bcrypt per §6 before production.
