# Running SmartWardrobe (feature/creative-round)

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

```
git checkout feature/creative-round
```

## 3. One-step setup

```
bash setup.sh
```

This checks the prerequisites, creates the MySQL database, copies
`backend/.env.example` to `backend/.env`, installs backend and Flutter
dependencies. If you prefer to do it by hand, the steps are 3a-3d below.

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
  the Google button just answers "not configured".

### 3c. Backend dependencies

```
cd backend && npm install
```

### 3d. Flutter dependencies

```
cd .. && flutter pub get
```

## 4. Run it

```
bash start.sh
```

or by hand, in two terminals:

```
cd backend && npm run dev
```

```
flutter run -d chrome --web-port 8080
```

- Backend API: http://localhost:3002/api (health: /api/health)
- Web app: http://localhost:8080
- On first boot with an empty database the demo data seeds itself
  (`SEED_ON_BOOT=true`). Demo login: karim@fashiontech.com / wardrobe2024
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
- Access denied for user root: set `DB_USERNAME`/`DB_PASSWORD` in
  `backend/.env` to a MySQL user with rights on `smartwardrobe`.
- Port 3002 or 8080 already in use: stop the old process (`pkill -f
  "node dist/main.js"` / close the other `flutter run`).
- Flutter version errors: the app is built with Flutter 3.50.x; older SDKs
  fail on pub get. `flutter upgrade` on the stable channel.
- Products missing in Smart Shopping: run a scraper (section 5); the demo
  seed only ships a small demo catalog.
