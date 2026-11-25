#!/usr/bin/env bash
# One-step local setup for SmartWardrobe. Quiet on purpose: one line per
# step, all command output goes to setup.log. Safe to re-run (idempotent).
# See RUNNING.md for the manual version of each step.
set -uo pipefail
cd "$(dirname "$0")"

LOG=setup.log
: > "$LOG"

STEPS=8
i=0
step() { i=$((i + 1)); printf '[%d/%d] %-18s ' "$i" "$STEPS" "$1"; }
ok()   { echo "ok${1:+ ($1)}"; }
warn() { echo "warning: $1"; }
die()  { # die "what went wrong" "how to fix it"
  echo "FAILED"
  echo ""
  echo "ERROR: $1"
  echo "FIX:   $2"
  echo "(full command output is in $LOG)"
  exit 1
}
run() { "$@" >>"$LOG" 2>&1; } # quiet command runner

# ---------------------------------------------------------------- 1. Node.js
step "Node.js"
command -v node >/dev/null 2>&1 \
  || die "node is not installed." "Install Node.js 22 LTS from https://nodejs.org and re-run bash setup.sh."
NODE_V=$(node --version 2>>"$LOG")
case "$NODE_V" in
  v22.*) ok "$NODE_V" ;;
  *) warn "built and tested on Node 22 LTS, found $NODE_V - continuing anyway" ;;
esac

# ---------------------------------------------------------------- 2. Flutter
step "Flutter"
command -v flutter >/dev/null 2>&1 \
  || die "flutter is not installed." "Install Flutter 3.50.x stable: https://docs.flutter.dev/get-started/install - then re-run bash setup.sh."
FLUT_V=$(flutter --version 2>>"$LOG" | head -1 | awk '{print $2}')
case "$FLUT_V" in
  3.50.*) ok "$FLUT_V" ;;
  *) warn "built and tested on Flutter 3.50.x, found ${FLUT_V:-unknown} - continuing anyway" ;;
esac

# ------------------------------------------------------------- 3. MySQL CLI
step "MySQL client"
MYSQL=$(command -v mysql || command -v mariadb || true)
[ -n "$MYSQL" ] \
  || die "no mysql/mariadb client found." "Install MySQL 8 or MariaDB (Debian/Ubuntu: sudo apt install mariadb-server) and re-run bash setup.sh."
ok

# ------------------------------------------------------------- 4. .env file
step "backend/.env"
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env || die "could not create backend/.env." "Check the clone is complete, then re-run bash setup.sh."
  ok "created from .env.example"
else
  ok "already exists"
fi
# DB_SYNCHRONIZE=true on MySQL/MariaDB silently wipes saved style profiles.
if ! grep -q '^DB_SYNCHRONIZE=false' backend/.env; then
  sed -i 's/^DB_SYNCHRONIZE=.*/DB_SYNCHRONIZE=false/' backend/.env
  echo "       note: forced DB_SYNCHRONIZE=false (true wipes saved profiles)"
fi
if grep -q '^JWT_ACCESS_SECRET=CHANGE_ME' backend/.env; then
  echo "       note: JWT secrets are placeholders - fine locally, change before deploying"
fi

# -------------------------------------------------------------- 5. database
step "MySQL database"
# Read the DB settings the backend will use.
db_val() { grep "^$1=" backend/.env | tail -1 | cut -d= -f2-; }
DB_HOST=$(db_val DB_HOST);         DB_HOST=${DB_HOST:-127.0.0.1}
DB_PORT=$(db_val DB_PORT);         DB_PORT=${DB_PORT:-3306}
DB_NAME=$(db_val DB_NAME);         DB_NAME=${DB_NAME:-smartwardrobe}
DB_USER=$(db_val DB_USERNAME);     DB_USER=${DB_USER:-root}
DB_PASS=$(db_val DB_PASSWORD)

# Can the backend connect as the configured user right now?
app_connects() {
  MYSQL_PWD=$DB_PASS "$MYSQL" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
    -e "SELECT 1" "$DB_NAME" >>"$LOG" 2>&1
}

# Find an admin channel: plain root (socket auth on Debian/MariaDB) or sudo.
ADMIN=""
admin_probe() { echo "SELECT 1" | $1 >>"$LOG" 2>&1; }
if admin_probe "$MYSQL -u root"; then
  ADMIN="$MYSQL -u root"
elif command -v sudo >/dev/null 2>&1 && admin_probe "sudo -n $MYSQL"; then
  ADMIN="sudo -n $MYSQL"
fi

set_env() { # set_env KEY VALUE  (writes into backend/.env)
  if grep -q "^$1=" backend/.env; then
    sed -i "s|^$1=.*|$1=$2|" backend/.env
  else
    echo "$1=$2" >> backend/.env
  fi
}

if app_connects; then
  ok "'$DB_NAME' reachable as '$DB_USER'"
else
  CREATED=""
  if [ -n "$ADMIN" ]; then
    # Create the database. If the configured user cannot log in over TCP
    # (Debian root uses socket auth, so root-over-TCP always fails), create
    # a dedicated app user and point backend/.env at it.
    if [ "$DB_USER" = "root" ] && [ -z "$DB_PASS" ]; then
      DB_USER=smartwardrobe
      DB_PASS=$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')
      set_env DB_USERNAME "$DB_USER"
      set_env DB_PASSWORD "$DB_PASS"
      CREATED="created app user 'smartwardrobe' (password written to backend/.env)"
    fi
    {
      echo "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
      echo "CREATE USER IF NOT EXISTS '$DB_USER'@'%' IDENTIFIED BY '$DB_PASS';"
      echo "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';"
      echo "GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'%';"
      echo "GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';"
      echo "FLUSH PRIVILEGES;"
    } | $ADMIN >>"$LOG" 2>&1
  fi
  if app_connects; then
    ok "'$DB_NAME' ready${CREATED:+; $CREATED}"
  elif [ -t 0 ]; then
    # Last resort: ask for an existing MySQL user with rights on the DB.
    echo ""
    echo "       root login failed. Enter a MySQL user with full rights on '$DB_NAME'."
    printf '       username: '; read -r U
    printf '       password: '; read -rs P; echo ""
    DB_USER=$U; DB_PASS=$P
    if app_connects; then
      set_env DB_USERNAME "$DB_USER"; set_env DB_PASSWORD "$DB_PASS"
      ok "'$DB_NAME' reachable as '$DB_USER' (saved to backend/.env)"
    else
      die "user '$DB_USER' cannot use database '$DB_NAME'." "Create it: sudo mysql -e \"CREATE DATABASE $DB_NAME; GRANT ALL ON $DB_NAME.* TO '$DB_USER'@'%';\" then re-run bash setup.sh."
    fi
  else
    die "cannot reach MySQL as root (tried socket and sudo) or as '$DB_USER'." "Start MySQL (sudo systemctl start mysql) or set a working DB_USERNAME/DB_PASSWORD in backend/.env, then re-run bash setup.sh."
  fi
fi

# ---------------------------------------------------- 6. backend npm install
step "npm install (backend)"
if run npm --prefix backend install; then
  ok
else
  die "npm install failed for the backend." "Check the end of setup.log - most often the network or the Node version (need 22 LTS)."
fi

# ------------------------------------------------------- 7. flutter pub get
step "flutter pub get"
if run flutter pub get; then
  ok
else
  die "flutter pub get failed." "Check the end of setup.log - most often the Flutter version (need 3.50.x stable)."
fi

# ---------------------------------------------- 8. schema + demo data (seed)
step "database seed"
# npm run seed creates the schema on a fresh database (the app always runs
# with DB_SYNCHRONIZE=false) and inserts the demo data. Idempotent: existing
# rows are skipped, an existing schema is never touched.
if run npm --prefix backend run seed; then
  ok
else
  die "seeding the database failed." "Check the end of setup.log - usually MySQL is not running or DB_USERNAME/DB_PASSWORD in backend/.env are wrong."
fi

echo ""
echo "Setup complete. Start the app with: bash start.sh"
