#!/usr/bin/env bash
# One-step local setup for SmartWardrobe. See RUNNING.md for details.
set -euo pipefail

echo "== checking prerequisites"
node --version | grep -q '^v22' || { echo "Need Node.js 22 LTS"; exit 1; }
flutter --version | grep -q 'Flutter 3\.50' || { echo "Need Flutter 3.50.x stable"; exit 1; }
command -v mysql >/dev/null || command -v mariadb >/dev/null || { echo "Need MySQL or MariaDB"; exit 1; }

echo "== creating database (may prompt for the MySQL root password)"
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS smartwardrobe CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo "== backend config"
[ -f backend/.env ] || cp backend/.env.example backend/.env
grep -q '^DB_SYNCHRONIZE=false' backend/.env || {
  echo "Fixing DB_SYNCHRONIZE to false (true wipes saved profiles on MySQL/MariaDB)"
  sed -i 's/^DB_SYNCHRONIZE=.*/DB_SYNCHRONIZE=false/' backend/.env
}

echo "== backend dependencies"
(cd backend && npm install)

echo "== flutter dependencies"
flutter pub get

echo "Done. Start everything with: bash start.sh"
