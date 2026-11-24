# Phase 0 — Database Recovery

## Existing Database Artifacts

| File | Size | Last Modified | Description |
|------|------|---------------|-------------|
| `backend/data/db.json` | 96,820 bytes | Nov 18 10:22 | Live JSON data store (used by Express runtime) |
| `backend/data/db.json.bak` | 92,431 bytes | Oct 1 00:09 | Previous backup |

The Express runtime persists data to `backend/data/db.json` via `src/store.js` (which is now deleted; the LegacyDbService uses MySQL instead). The NestJS runtime uses TypeORM with a `better-sqlite3` fallback at `data/smartwardrobe.sqlite` (file does not yet exist — no SQLite database has been created).

## Phase 0 Backup Created

| File | Size | Created | Source |
|------|------|---------|--------|
| `backend/data/db.json.phase0-backup-20261123-144657` | 96,820 bytes | Nov 23 14:46 | `backend/data/db.json` |

## Verification

The backup was verified:
- File exists and is non-empty (96,820 bytes, identical to source)
- File is readable (JSON content intact)
- Size matches the source `db.json` exactly

## Restoration Instructions

### To restore the JSON data store:

```bash
# From the backend directory
cp data/db.json.phase0-backup-20261123-144657 data/db.json
```

### To restore from the older `.bak`:

```bash
# From the backend directory
cp data/db.json.bak data/db.json
```

**Warning:** Restoring a backup will overwrite all current data in `db.json`. Any data created after the backup was made will be lost.

### TypeORM / MySQL / SQLite state

No TypeORM-managed database exists yet:
- `DB_TYPE=sqlite` in `.env`
- `DB_SYNCHRONIZE=true` (auto-creates tables on boot)
- `better-sqlite3` database file `data/smartwardrobe.sqlite` does not exist
- MySQL is not running in this environment
- PostgreSQL is not running in this environment

There is no MySQL/PostgreSQL dump to back up. The only persistent data is `db.json`.

## What Is NOT Backed Up

- No database dumps (MySQL/PostgreSQL not running)
- No environment file backups (`.env` contains secrets — intentionally not backed up to docs)
- No uploaded files in `backend/storage/` (7 files, ~1.3MB total)
- No AI model cache (`.model-cache/` — models can be re-downloaded)

## Recovery Point Summary

| Item | Status | Location |
|------|--------|----------|
| JSON data store backup | ✅ Verified | `data/db.json.phase0-backup-20261123-144657` |
| Previous .bak | ✅ Exists | `data/db.json.bak` |
| TypeORM/SQLite database | ❌ Does not exist | N/A |
| MySQL dump | ❌ Not available | MySQL not running |
| Environment file | ⚠️ Not backed up | `.env` (contains secrets — do not commit) |
| Uploaded files | ⚠️ Not backed up | `storage/` directory |
| Model cache | ⚠️ Not backed up | `.model-cache/` (re-downloadable) |

## How to Restore (Full Procedure)

```bash
# 1. Stop any running backend processes
# 2. Restore the JSON data store
cp backend/data/db.json.phase0-backup-20261123-144657 backend/data/db.json

# 3. Verify restoration
node -e "const d=require('./backend/data/db.json'); console.log('users:', d.users.length, 'items:', d.wardrobe.length)"

# 4. Restart the Express backend
cd backend && npm start
```

## Notes

- The backup was created using `cp` (filesystem copy), not database dump tooling, because no database server is running.
- The `db.json` file is the source of truth for the Express runtime.
- The NestJS runtime with TypeORM would create its own schema on first boot (`synchronize=true`).
- Do not commit `db.json`, `db.json.bak`, or any backup files to git (they are in `.gitignore` or should be).
- Do not commit `.env` — it contains a visible `GEMINI_API_KEY`.
