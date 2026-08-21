#!/usr/bin/env bash
# Redeploy HEIRLOM in place. Run from the repo root on the VPS.
set -euo pipefail

echo "==> pulling"
git pull --ff-only

echo "==> installing"
npm install

echo "==> building genetics (the other two resolve against it)"
npm run build -w @heirlom/genetics

echo "==> schema"
npm run db:push -w @heirlom/server

echo "==> building server"
npm run build -w @heirlom/server

# NEXT_PUBLIC_* are inlined at build time, so they are exported here rather than
# left to PM2, where they would have no effect whatsoever.
echo "==> building web"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://heirlom.fun}"
export NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-https://heirlom.fun}"
npm run build -w @heirlom/web

echo "==> reloading"
# Keep the ports the bootstrap chose; this box may host more than one app.
API_PORT="${API_PORT:-$(grep -oP '127\.0\.0\.1:\K4[0-9]+' /etc/nginx/sites-available/heirlom.fun 2>/dev/null | head -1)}"
WEB_PORT="${WEB_PORT:-$(grep -oP '127\.0\.0\.1:\K3[0-9]+' /etc/nginx/sites-available/heirlom.fun 2>/dev/null | head -1)}"
export API_PORT="${API_PORT:-4000}" WEB_PORT="${WEB_PORT:-3000}"
echo "    web ${WEB_PORT}, api ${API_PORT}"
pm2 reload ecosystem.config.cjs --env production

echo "==> health"
sleep 3
curl -fsS "localhost:${API_PORT}/health" && echo
curl -fsSI "localhost:${WEB_PORT}" | head -1
echo "==> done"
