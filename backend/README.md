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
AI: `POST /ai/analyze-clothing|generate-outfit|calculate-compatibility|style-profile|wardrobe-gap|packing-list|chat`
Outfits: `GET /outfits/recommended`, `POST|GET|PATCH|DELETE /outfits…`,
`POST /outfits/:id/favorite|feedback`
Planner: `GET|POST|PATCH|DELETE /events`, `GET|POST /planner/weekly`,
`POST /travel/packing-list`
Shopping: `GET /shop/recommended`, `POST /shop/before-you-buy`,
`GET|POST /shop/wishlist`
Admin: `GET /admin/dashboard|users|ai-performance|reports|system-health`
Misc: `GET /weather/current`, `GET /health`, `GET /docs`

## AI service (optional, §6.3)

```bash
cd ai-service
pip install -r requirements.txt
uvicorn main:app --port 8000
# backend/.env: AI_SERVICE_URL=http://localhost:8000
```

Without it, the backend uses the embedded engine (`src/ai-engine.js`,
same scoring pipeline §9). Auth is demo-grade SHA-256 — swap for
`@nestjs/jwt` + bcrypt + PostgreSQL per §6 before production.
