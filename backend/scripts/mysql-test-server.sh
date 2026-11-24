#!/bin/bash
# Manage the user-space MySQL 8.0.44 test server used by Phase 3/4 verification.
# No sudo required — binaries and data live in /tmp/opencode/mysql8.
#
# Usage:
#   ./scripts/mysql-test-server.sh start     # start detached (survives this shell)
#   ./scripts/mysql-test-server.sh stop      # graceful shutdown
#   ./scripts/mysql-test-server.sh status    # ping + row counts
#   ./scripts/mysql-test-server.sh connect   # interactive mysql shell (swtest)
#   ./scripts/mysql-test-server.sh import    # run the Phase 4 dry-run importer
set -e

BASE=/tmp/opencode/mysql8
MDIR="$BASE/mysql-8.0.44-linux-glibc2.17-x86_64-minimal"
SOCK="$BASE/run/mysqld.sock"
PID="$BASE/run/mysqld.pid"
LOG="$BASE/run/mysqld.err"
export LD_LIBRARY_PATH="$BASE/deps/root/usr/lib/x86_64-linux-gnu:$BASE/deps/root/lib/x86_64-linux-gnu"

alive() {
  "$MDIR/bin/mysqladmin" --socket="$SOCK" -u root ping >/dev/null 2>&1
}
root_sql() {
  "$MDIR/bin/mysql" --socket="$SOCK" -u root "$@"
}

case "${1:-status}" in
  start)
    if alive; then
      echo "MySQL 8 is already running (socket $SOCK, port 3307) — $($MDIR/bin/mysql --socket="$SOCK" -u root -N -e 'SELECT VERSION()')"
      exit 0
    fi
    echo "Starting MySQL 8.0.44 test server..."
    mkdir -p "$BASE/run"
    setsid "$MDIR/bin/mysqld" \
      --basedir="$MDIR" \
      --datadir="$BASE/data" \
      --socket="$SOCK" \
      --pid-file="$PID" \
      --log-error="$LOG" \
      --port=3307 \
      --bind-address=127.0.0.1 \
      --mysqlx=0 \
      --skip-name-resolve \
      --user=h \
      </dev/null >>"$BASE/run/stdout.log" 2>&1 &
    for i in $(seq 1 30); do
      if alive; then
        echo "Ready after ${i}s — $(root_sql -N -e 'SELECT VERSION()')"
        exit 0
      fi
      sleep 1
    done
    echo "FAILED to start. Last 20 log lines:"; tail -20 "$LOG"; exit 1
    ;;

  stop)
    if alive; then
      echo "Shutting down MySQL 8..."
      "$MDIR/bin/mysqladmin" --socket="$SOCK" -u root shutdown
      for i in $(seq 1 20); do alive || { echo "Stopped."; exit 0; }; sleep 1; done
      echo "Still running; check $LOG"; exit 1
    else
      echo "MySQL 8 is not running."
    fi
    ;;

  status)
    if ! alive; then
      echo "MySQL 8 is NOT running. Start it with: $0 start"
      exit 1
    fi
    echo "MySQL 8 is running: $(root_sql -N -e 'SELECT VERSION()')"
    echo "Target: 127.0.0.1:3307 / smartwardrobe_migration_test"
    "$MDIR/bin/mysql" -h 127.0.0.1 -P 3307 -u swtest -pSwTest_2026! \
      smartwardrobe_migration_test -N 2>/dev/null -e "
      SELECT CONCAT('users=',(SELECT COUNT(*) FROM users),
                    ' sessions=',(SELECT COUNT(*) FROM sessions),
                    ' wardrobe_items=',(SELECT COUNT(*) FROM wardrobe_items),
                    ' ai_usage=',(SELECT COUNT(*) FROM ai_usage),
                    ' weekly_plans=',(SELECT COUNT(*) FROM weekly_plans));"
    ;;

  connect)
    alive || { echo "MySQL 8 is not running. Start it with: $0 start"; exit 1; }
    exec "$MDIR/bin/mysql" -h 127.0.0.1 -P 3307 -u swtest -pSwTest_2026! \
      smartwardrobe_migration_test
    ;;

  import)
    alive || { echo "MySQL 8 is not running. Start it with: $0 start"; exit 1; }
    HERE="$(cd "$(dirname "$0")/.." && pwd)"
    cd "$HERE"
    NODE_PATH="$HERE/node_modules" node scripts/phase4-dry-run-importer.js
    ;;

  *)
    echo "Usage: $0 {start|stop|status|connect|import}"
    exit 2
    ;;
esac
