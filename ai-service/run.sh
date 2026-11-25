#!/usr/bin/env bash
# One line to start the garment-cutout service the backend uses for colour.
# Usage: bash ai-service/run.sh        (default port 8000, set PORT to change)
cd "$(dirname "$0")" || exit 1
[ -f .venv/bin/activate ] && . .venv/bin/activate
exec python3 -m uvicorn garment_service:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8000}"
