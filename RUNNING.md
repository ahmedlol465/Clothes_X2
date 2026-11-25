# Running SmartWardrobe

Everything below was run and verified on a clean machine. One command per
block, in order. Two terminals are needed at the end (backend + app).

## 1. Prerequisites

- Node.js 22 LTS (`node --version` should print v22.x)
- MySQL 8 (or MariaDB 10.6+) running locally
- Flutter 3.50.x stable (`flutter --version`) with Chrome for the web app
- Git

## 2. Get the code

```
git clone https://github.com/ahmedlol465/Clothes_X2.git
```

```
cd Clothes_X2
```

## 3. One-step setup

```
bash setup.sh
```

Quiet by design: one line per step, all command output goes to `setup.log`.
Safe to re-run - every step skips what is already done. It checks Node and
Flutter (version mismatches warn, they don't stop), creates the MySQL
database, copies `backend/.env.example` to `backend/.env`, installs backend
and Flutter dependencies, and runs `npm run seed` - which creates the
tables on a fresh database (the app always runs with DB_SYNCHRONIZE=false)
and inserts the demo data. If a step fails you get one ERROR line and one
FIX line; the details are always in `setup.log`.

Database notes: if the DB and the configured user already work, setup skips
creation. Otherwise it tries `mysql -u root` (socket auth, the Debian/
MariaDB default) and `sudo mysql`, creates the `smartwardrobe` database,
and - because Debian's root cannot log in over TCP - creates a dedicated
`smartwardrobe` app user and writes its generated password into
`backend/.env`. If no root route works it asks for a MySQL user with rights
on the database.

If you prefer to do it by hand, the steps are 3a-3d below.

### 3a. Database (by hand)

```
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS smartwardrobe CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 3b. Backend config (by hand)

```
cp backend/.env.example backend/.env
```

For local use the defaults work as-is. Two things matter:

- `DB_SYNCHRONIZE=false` must STAY false. With synchronize on, TypeORM
  drops and recreates JSON columns on MySQL/MariaDB and silently wipes
  saved style profiles.
- Optional: replace the two `JWT_*_SECRET=CHANGE_ME...` values with your own
  (`openssl rand -hex 32` twice). Empty `GOOGLE_CLIENT_ID` is fine locally;
  the Google button just answers "not configured". To turn Google sign-in
  on: Google Cloud Console > APIs & Services > Credentials > Create
  Credentials > OAuth client ID (type: Web application), add
  `http://localhost:8080` under Authorized JavaScript origins, then paste
  the Client ID into `GOOGLE_CLIENT_ID` and restart the backend. The app
  fetches the Client ID from the server (`GET /auth/google/config`), so
  nothing else needs to change.

### 3c. Backend dependencies

```
cd backend && npm install
```

### 3d. Flutter dependencies

```
cd .. && flutter pub get
```

### 3e. Tables + demo data (fresh database)

```
cd backend && npm run seed
```

Creates the tables on a fresh database and inserts the demo data. Safe to
re-run: existing data is never touched. The app itself always runs with
`DB_SYNCHRONIZE=false`, so this seed command is the only thing that builds
the schema.

## Windows + XAMPP (no bash needed)

XAMPP's MySQL matches the app's defaults exactly (127.0.0.1:3306, user
`root`, no password), so `backend/.env` works unchanged.

1. Open the XAMPP Control Panel and start **MySQL** (and **Apache** for
   phpMyAdmin).
2. Create the database in phpMyAdmin: open http://localhost/phpmyadmin,
   click **New**, name it `smartwardrobe`, collation
   `utf8mb4_unicode_ci`, **Create**. No user creation needed - the app
   connects as root.
3. Copy `backend/.env.example` to `backend/.env` and leave the DB values
   as they are. Keep `DB_SYNCHRONIZE=false`.
4. In a terminal (PowerShell or CMD) inside the project:

```
cd backend && npm install && npm run seed
```

```
npm run dev
```

5. In a second terminal:

```
flutter run -d web-server --web-port=8080 --release
```

6. Open http://localhost:8080 and sign in with the demo account
   (karim@fashiontech.com / wardrobe2024).

`npm run seed` is the step that creates the tables on a fresh database and
inserts the demo data; it is safe to re-run. On Windows, skip setup.sh /
start.sh (they are bash scripts) - the commands above are all they do.

## 4. Run it

```
bash start.sh
```

Starts the backend and the web app, waits for each to be ready, and
prints the two URLs. Both run in the background with their full output in
`logs/backend.log` and `logs/flutter.log`; Ctrl+C stops both. The first
run compiles the app and can take a few minutes.

or by hand, in two terminals:

```
cd backend && npm run dev
```

```
flutter run -d web-server --web-port=8080 --release
```

(the web-server device does not open a browser window - open
http://localhost:8080 yourself)

- Backend API: http://localhost:3002/api (health: /api/health)
- Web app: http://localhost:8080 (start.sh serves it without opening a
  browser window; open the URL yourself)
- Demo login: karim@fashiontech.com / wardrobe2024 (created by
  `npm run seed`, which setup.sh runs for you; on an empty database the
  backend also seeds on boot via `SEED_ON_BOOT=true`, but the tables must
  already exist - so run the seed once first)
- Android emulator instead of Chrome: `flutter run` (the app already points
  at http://10.0.2.2:3002 on Android).

## 5. Optional: pull real products

```
cd backend && npm run scrape
```

prints the store list; then one store per run, e.g.:

```
cd backend && npm run scrape -- "Dockland"
```

Scraping is manual-trigger only. Only stores whose public product feed and
robots rules permit it are included; stores behind a bot challenge are
skipped on purpose.

## 6. Common problems

- 401 right after logging in again: tokens are tied to the JWT secrets;
  if you changed the secrets, log in again.
- Backend says "Redis unreachable": harmless; it falls back to in-process
  cache. Install Redis only if you want the shared cache.
- `ECONNREFUSED 127.0.0.1:3306`: MySQL/MariaDB is not running or not on TCP
  3306. Start it, or fix `DB_HOST`/`DB_PORT` in `backend/.env`.
- Access denied for user root (backend cannot log into MySQL): on
  Debian/Ubuntu, MySQL/MariaDB root only works over the local socket, not
  TCP. Re-run `bash setup.sh` - it creates a dedicated `smartwardrobe`
  user and writes it into `backend/.env` - or set
  `DB_USERNAME`/`DB_PASSWORD` there yourself.
- Port 3002 or 8080 already in use: stop the old process (`pkill -f
  "node dist/main.js"` / close the other `flutter run`).
- A setup step failed: read the ERROR/FIX lines it printed, then the end
  of `setup.log`. Runtime output lives in `logs/backend.log` and
  `logs/flutter.log`.
- Flutter version errors: the app is built with Flutter 3.50.x; older SDKs
  fail on pub get. `flutter upgrade` on the stable channel.
- Products missing in Smart Shopping: run a scraper (section 5); the demo
  seed only ships a small demo catalog.
