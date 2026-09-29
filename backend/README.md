# SmartWardrobe backend (§5–§8)

Modular REST API (Express runtime, NestJS-style module layout). No database
server needed — data persists to `backend/data/db.json` (seeded from the
Flutter mock data so the UI looks identical on first run).

## Run

```bash
cd backend
npm install
npm start
# → http://localhost:3001  (endpoint index at GET /docs)
```

The Flutter app auto-connects (Android emulator: `10.0.2.2:3000`,
desktop/iOS: `localhost:3000`). If the backend is down, the app falls back
to bundled mock data and shows an "Offline demo" badge.

## API map (spec §8)

Auth: `POST /auth/register|login|refresh|logout`
Users: `GET|PATCH /users/me`, `GET|PATCH /users/me/style-profile`
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
| Semantic retrieval | `npm run embeddings:install` | lexical scorer |

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
bcrypt + PostgreSQL per §6 before production.
