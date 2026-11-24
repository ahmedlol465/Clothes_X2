#!/bin/bash
# Phase 3 MySQL 8 verification — reproducible wrapper.
#
# Prereq: the user-space MySQL 8.0.44 test server must be running:
#   /tmp/opencode/mysql8/run/start.sh &
#
# Steps:
#   1. compile the project (pre-existing TS errors in unrelated files are OK;
#      tsc still emits). The entity TDZ bug is fixed in source, so no emitted
#      JS patching is required.
#   2. run the verification harness against the dedicated test database.
set -e
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Compiling project"
(cd "$BACKEND" && ./node_modules/.bin/tsc -p tsconfig.json --noEmitOnError false --incremental false >/tmp/opencode/tsc.log 2>&1 || true)

echo "==> Verifying real compiled entities load without patching"
(cd "$BACKEND" && NODE_PATH="$BACKEND/node_modules" node /tmp/opencode/load-test.js "$BACKEND/dist/database/entities")

echo "==> Running verification suite"
(cd "$BACKEND" && NODE_PATH="$BACKEND/node_modules" \
  VERIFY_ENTITIES_DIR="$BACKEND/dist/database/entities" \
  node scripts/phase3-mysql-verify.js "${1:-all}")
