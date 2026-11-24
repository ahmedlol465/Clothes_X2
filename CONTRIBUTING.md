# Contributing

## Prerequisites

- Flutter (stable) with Dart 3.11+
- Node.js 22.5+ (the embedded SQLite fallback uses `node:sqlite`; CI uses 22).
  If you must stay on Node 20, set `DB_TYPE=postgres` or `DB_TYPE=mysql`.
- Python 3.11+ for `ai-service` (optional unless you work on the analyzer)
- No database server is required: the NestJS API falls back to SQLite.

## First run

```bash
# Flutter
flutter pub get
flutter analyze
flutter test

# Backend (canonical NestJS API, port 3002)
cd backend
npm install
npm run dev

# Python analyzer (optional sidecar, port 8000)
cd ../ai-service
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
uvicorn main:app --reload --port 8000
```

## Quality gates

Run these before opening a PR:

```bash
flutter analyze
flutter test
cd backend && npm run typecheck && npm test && npm run test:e2e
```

Python changes should also pass `ruff check clothing_ai tests` and `pytest`.

## Repository conventions

- Text files use LF. See `.gitattributes` and `.editorconfig`. If a Windows
  checkout rewrites the tree, run `git add --renormalize .` once.
- Do not commit generated output: `backend/dist/`, `backend/src/**/*.js`,
  `build/`, `.dart_tool/`, model caches, uploads or local databases.
- The canonical backend is NestJS. `backend/server.js` is the legacy Express
  runtime and must not be used as the primary API.
- The Python service is the preferred clothing analyzer. The local TypeScript
  pipeline is a fallback; both should stay behind the same analyzer interface.
- Keep one source of truth for controlled vocabularies (`backend/src/common/vocabularies.ts`)
  and image asset paths (`lib/data/assets.dart`).

## Commit style

Use short imperative subjects, for example:

```
fix: align Flutter API port with backend .env.example
refactor: split wardrobe controller out of AppState
test: cover the analyzer fallback path
```
