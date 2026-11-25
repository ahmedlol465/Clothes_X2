#!/usr/bin/env bash
# Starts the backend (3002) and the Flutter web app (8080).
# Ctrl+C stops both. See RUNNING.md.
set -euo pipefail

(cd backend && npm run dev) &
BACK=$!
trap 'kill $BACK 2>/dev/null || true' EXIT

flutter run -d chrome --web-port 8080
