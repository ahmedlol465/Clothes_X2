#!/bin/bash
# Manage the user-space XAMPP stack (MariaDB 10.4 + Apache/phpMyAdmin).
#
# Installed without root at ~/xampp (the official installer hardcodes
# /opt/lampp, so it was installed through bwrap and its paths rewritten).
#
#   ./scripts/xampp-ctl.sh start     # MariaDB (3306) + Apache (8081)
#   ./scripts/xampp-ctl.sh stop
#   ./scripts/xampp-ctl.sh restart
#   ./scripts/xampp-ctl.sh status    # ports, row counts, URLs
#   ./scripts/xampp-ctl.sh initdb    # create DB + swtest user (idempotent)
#   ./scripts/xampp-ctl.sh import    # Phase 4 JSON -> MariaDB dry-run import
#   ./scripts/xampp-ctl.sh mysql     # SQL shell as swtest on the project DB
#   ./scripts/xampp-ctl.sh root      # SQL shell as root
#
# phpMyAdmin: http://127.0.0.1:8081/phpmyadmin/  (root, no password)
set -u

XAMPP="${XAMPP_HOME:-$HOME/xampp}"
SOCK="$XAMPP/var/mysql/mysql.sock"
DB_PORT="${XAMPP_DB_PORT:-3306}"
HTTP_PORT="${XAMPP_HTTP_PORT:-8081}"
DB_NAME="${XAMPP_DB_NAME:-smartwardrobe_migration_test}"
DB_USER="${XAMPP_DB_USER:-swtest}"
DB_PASS="${XAMPP_DB_PASS:-SwTest_2026!}"

# XAMPP's binaries need its bundled libs; keep this scoped to XAMPP commands so
# system tools (curl, etc.) keep using the distro libraries.
x() { env LD_LIBRARY_PATH="$XAMPP/lib" PHPRC="$XAMPP/etc" "$@"; }
mysql_root() { x "$XAMPP/bin/mysql" --socket="$SOCK" -u root "$@"; }
mysql_app()  { x "$XAMPP/bin/mysql" -h 127.0.0.1 -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$@"; }

mysql_alive() { x "$XAMPP/bin/mysqladmin" --socket="$SOCK" -u root ping >/dev/null 2>&1; }
http_pid()    { cat "$XAMPP/logs/httpd.pid" 2>/dev/null; }
http_alive()  { local p; p="$(http_pid)"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

start_mysql() {
  if mysql_alive; then
    echo "MariaDB already running on 127.0.0.1:$DB_PORT"
    return 0
  fi
  echo -n "Starting MariaDB 10.4 ... "
  setsid env LD_LIBRARY_PATH="$XAMPP/lib" "$XAMPP/sbin/mysqld" \
    --defaults-file="$XAMPP/etc/my.cnf" \
    --basedir="$XAMPP" \
    --datadir="$XAMPP/var/mysql" \
    --socket="$SOCK" \
    --port="$DB_PORT" \
    --bind-address=127.0.0.1 \
    --pid-file="$XAMPP/var/mysql/mysqld.pid" \
    --log-error="$XAMPP/var/mysql/mysqld.err" \
    --user="$(id -un)" \
    </dev/null >/dev/null 2>&1 &
  for _ in $(seq 1 30); do
    if mysql_alive; then echo "ok"; return 0; fi
    sleep 1
  done
  echo "FAILED"
  tail -15 "$XAMPP/var/mysql/mysqld.err" 2>/dev/null
  return 1
}

start_http() {
  if http_alive; then
    echo "Apache already running on http://127.0.0.1:$HTTP_PORT"
    return 0
  fi
  echo -n "Starting Apache/phpMyAdmin ... "
  setsid env LD_LIBRARY_PATH="$XAMPP/lib" PHPRC="$XAMPP/etc" \
    "$XAMPP/bin/httpd" -f "$XAMPP/etc/httpd.conf" </dev/null >/dev/null 2>&1 &
  for _ in $(seq 1 20); do
    sleep 1
    if http_alive; then echo "ok"; return 0; fi
  done
  echo "FAILED"
  tail -15 "$XAMPP/logs/error_log" 2>/dev/null
  return 1
}

stop_http() {
  if http_alive; then
    echo -n "Stopping Apache ... "
    kill "$(http_pid)" 2>/dev/null
    for _ in $(seq 1 15); do http_alive || { echo "ok"; return 0; }; sleep 1; done
    echo "still running"
    return 1
  fi
  echo "Apache is not running"
}

stop_mysql() {
  if mysql_alive; then
    echo -n "Stopping MariaDB ... "
    x "$XAMPP/bin/mysqladmin" --socket="$SOCK" -u root shutdown
    for _ in $(seq 1 20); do mysql_alive || { echo "ok"; return 0; }; sleep 1; done
    echo "still running"
    return 1
  fi
  echo "MariaDB is not running"
}

status() {
  echo "XAMPP root : $XAMPP"
  if mysql_alive; then
    echo "MariaDB    : running on 127.0.0.1:$DB_PORT ($(mysql_root -N -e 'SELECT VERSION()' 2>/dev/null))"
    echo "Database   : $DB_NAME (user $DB_USER)"
    mysql_app -N "$DB_NAME" 2>/dev/null -e "
      SELECT CONCAT('  users=',(SELECT COUNT(*) FROM users),
                    ' sessions=',(SELECT COUNT(*) FROM sessions),
                    ' wardrobe_items=',(SELECT COUNT(*) FROM wardrobe_items),
                    ' outfits=',(SELECT COUNT(*) FROM outfits),
                    ' ai_usage=',(SELECT COUNT(*) FROM ai_usage));" 2>/dev/null \
      || echo "  (tables not imported yet — run: $0 import)"
  else
    echo "MariaDB    : stopped"
  fi
  if http_alive; then
    echo "Apache     : running on http://127.0.0.1:$HTTP_PORT (pid $(http_pid))"
    echo "phpMyAdmin : http://127.0.0.1:$HTTP_PORT/phpmyadmin/"
  else
    echo "Apache     : stopped"
  fi
}

initdb() {
  mysql_alive || { echo "MariaDB is not running. Start it first: $0 start"; return 1; }
  mysql_root -e "
    CREATE DATABASE IF NOT EXISTS \`$DB_NAME\`
      CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
    CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
    CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
    GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
    GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
    FLUSH PRIVILEGES;"
  echo "Database '$DB_NAME' and user '$DB_USER' are ready."
}

run_import() {
  mysql_alive || { echo "MariaDB is not running. Start it first: $0 start"; return 1; }
  local here
  here="$(cd "$(dirname "$0")/.." && pwd)"
  ( cd "$here" && PHASE4_DB_HOST=127.0.0.1 PHASE4_DB_PORT="$DB_PORT" \
      PHASE4_DB_USER="$DB_USER" PHASE4_DB_PASSWORD="$DB_PASS" \
      PHASE4_DB_NAME="$DB_NAME" NODE_PATH="$here/node_modules" \
      node scripts/phase4-dry-run-importer.js )
}

case "${1:-status}" in
  start)   start_mysql && start_http ;;
  stop)    stop_http; stop_mysql ;;
  restart) stop_http; stop_mysql; sleep 1; start_mysql && start_http ;;
  status)  status ;;
  initdb)  initdb ;;
  import)  run_import ;;
  mysql)   mysql_app "$DB_NAME" ;;
  root)    x "$XAMPP/bin/mysql" --socket="$SOCK" -u root ;;
  *) echo "Usage: $0 {start|stop|restart|status|initdb|import|mysql|root}"; exit 2 ;;
esac
