# SmartWardrobe backend (§5–§8)

Express REST API in plain JavaScript. Data lives in **MySQL** (or, for a quick
start without a database, in `backend/data/db.json`; the first MySQL start
imports that file automatically).

## Run

```bash
cd backend
cp .env.example .env          # then edit
npm install
npm run setup:models          # one-time: download AI models into .model-cache (see below)
npm start
# -> http://localhost:3001  (endpoint index at GET /docs)
```

Needs Node 22.5 or newer.

### With MySQL

```bash
docker compose up -d db       # MySQL 8.4 on localhost:3306
# backend/.env
DB_DRIVER=mysql
DB_HOST=127.0.0.1  DB_PORT=3306
DB_USER=smartwardrobe  DB_PASSWORD=smartwardrobe  DB_NAME=smartwardrobe
npm start                     # logs: [db] mysql 127.0.0.1/smartwardrobe
```

Without Docker, point `DB_*` at any MySQL 8 / MariaDB server (the database is
created if the user may create it). Records are stored one row each in
`sw_records(collection, position, data JSON)`; writes happen in the background
and are flushed on Ctrl+C / SIGTERM. Passwords are bcrypt; older SHA-256
hashes in an imported `db.json` are upgraded the first time that user logs in.

### Tests

```bash
npm test                      # node --test, no database or models needed
```

## Folder layout

```
backend/
  server.js                 entry point: env, storage init, listen
  src/app.js                builds the Express app (CORS, JSON, /storage, routers)
  src/routes/               auth, users, wardrobe, ai, outfits, planner, shop, admin, misc
  src/middleware/auth.js    bearer auth, session expiry, admin guard
  src/lib/                  style profile, uploads, stylist chat helpers, shared state
  src/services/             AI engine, scoring, learning, retrieval, weather, vision, LLM calls
  src/data/store.js         persistence (MySQL or JSON file)
  scripts/                  model download and vision self-test
  test/                     node:test suites
  archive/nest-skeleton/    earlier, unconnected NestJS + TypeORM draft (kept for reference)
```

Admin routes (`/admin/*`) need a login whose email is listed in `ADMIN_EMAILS`.

## Local AI models (backend/.model-cache)

The Express runtime analyzes garment photos **locally** with transformers.js
(ONNX, q8), so no API key is required for clothing analysis:

| Model | Purpose | Loader |
| --- | --- | --- |
| `Marqo/marqo-fashionCLIP` | clothing/non-clothing gate + all attributes (512-dim) | `src/services/clothing-vision/encoder.js` |
| `Xenova/all-MiniLM-L6-v2` | semantic retrieval (384-dim) | `src/services/retrieval.js` |

Both load lazily from `backend/.model-cache` (set explicitly by both loaders).
Weights are ignored by git; on a fresh clone run `npm run setup:models` (reuses
the app's own loaders, so it fetches exactly what the server loads, downloads
only missing files, and never overwrites an existing cache).

> **Model reproducibility note.** Models resolve from the Hugging Face Hub
> default `main` revision. The flat transformers.js cache does not record the
> original commit SHA, so none is hard-coded (no guessing). To lock a revision
> later, add `revision` to the `from_pretrained`/`pipeline` options in the two
> loaders. Current `main` SHAs seen during setup: `Marqo/marqo-fashionCLIP` →
> `44f4c655124ed71e90cbf528d82f508d69d8a81b`, `Xenova/all-MiniLM-L6-v2` →
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

### Modules

| File | Responsibility |
| --- | --- |
| `src/services/taxonomy.js` | hue/harmony, formality scale, occasion targets, fabric warmth, season fit, slot definitions |
| `src/services/scoring.js` | the 11 factors, signal-aware renormalisation, completeness gate, logistic calibration, `explain()` |
| `src/services/style-memory.js` | per-attribute learning, chat-sentiment mining, confidence, `factorWeights()`, `styleDna()` |
| `src/services/retrieval.js` | optional MiniLM embeddings with a lexical fallback, category-balanced ranking |
| `src/services/weather.js` | keyless Open-Meteo, OWM fallback, seasonal estimate, caching |
| `src/services/vision.js` | reference-outfit spec parsing and matching against the wardrobe |
| `src/services/llm.js` | provider calls: structured chat, SSE streaming, outfit description |
| `src/services/ai-engine.js` | beam search, remixes, occasion detection, offline chat, gaps, packing |

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
in-process engine.
