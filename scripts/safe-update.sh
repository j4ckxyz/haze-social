#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/4] backing up local data"
node scripts/backup-instance.js

echo "[2/4] pulling latest code"
git pull --ff-only

echo "[3/4] installing dependencies"
npm install

echo "[4/4] done. restart your process manager (systemd/pm2/docker)"
echo "example: sudo systemctl restart haze-social"
