#!/usr/bin/env bash
# Starts the backend (port 3002) and the Flutter web app (port 8080).
# Quiet: one line per component, full output in logs/. Ctrl+C stops both.
set -uo pipefail
cd "$(dirname "$0")"
mkdir -p logs

BACK_PID=""
APP_PID=""
cleanup() {
  # Each component runs in its own process group; kill the whole group so
  # npm/flutter wrapper children cannot survive.
  [ -n "$BACK_PID" ] && kill -- -"$BACK_PID" 2>/dev/null
  [ -n "$APP_PID" ] && kill -- -"$APP_PID" 2>/dev/null
  exit 0
}
trap cleanup EXIT INT TERM

die() {
  echo "ERROR: $1"
  echo "FIX:   $2"
  exit 1
}

port_busy() {
  (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -Eq ":$1( |$)"
}

[ -f backend/.env ] || die "backend/.env is missing." "Run bash setup.sh first."
port_busy 3002 && die "port 3002 is already in use." "Stop the old backend: pkill -f 'nest start' (or pkill -f 'node dist/main.js'), then re-run bash start.sh."
port_busy 8080 && die "port 8080 is already in use." "Stop the old app: pkill -f 'flutter_tools.*web-server', then re-run bash start.sh."

echo "Starting SmartWardrobe (full logs in logs/)"

printf '  backend   '
setsid bash -c 'cd backend && exec npm run dev' >logs/backend.log 2>&1 &
BACK_PID=$!
UP=""
for _ in $(seq 1 60); do
  curl -fsS http://localhost:3002/api/health >/dev/null 2>&1 && { UP=1; break; }
  kill -0 "$BACK_PID" 2>/dev/null || break
  sleep 2
done
[ -n "$UP" ] && echo "ok -> http://localhost:3002/api" \
  || die "backend did not come up." "Read the end of logs/backend.log - usually MySQL is not running or DB_USERNAME/DB_PASSWORD in backend/.env are wrong."

printf '  web app   '
setsid flutter run -d web-server --web-port 8080 >logs/flutter.log 2>&1 &
APP_PID=$!
UP=""
for _ in $(seq 1 180); do
  curl -fsS -o /dev/null http://localhost:8080 2>/dev/null && { UP=1; break; }
  kill -0 "$APP_PID" 2>/dev/null || break
  sleep 2
done
[ -n "$UP" ] && echo "ok -> http://localhost:8080" \
  || die "the Flutter app did not come up." "Read the end of logs/flutter.log - the first run compiles for a few minutes; also check the Flutter version (need 3.50.x)."

echo ""
echo "Open http://localhost:8080 - Ctrl+C stops both."
wait -n $BACK_PID $APP_PID 2>/dev/null || wait
echo "One component stopped; shutting down the other."
