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
pm2 reload ecosystem.config.cjs --env production

echo "==> health"
sleep 3
curl -fsS localhost:4000/health && echo
curl -fsSI localhost:3000 | head -1
echo "==> done"
