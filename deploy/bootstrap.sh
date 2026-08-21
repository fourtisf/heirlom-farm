#!/usr/bin/env bash
#
# HEIRLOM — one-shot VPS bootstrap.
#
#   cd /var/www/heirlom && sudo ./deploy/bootstrap.sh
#
# Safe to re-run: every step checks before it acts, and an existing
# apps/server/.env is never overwritten — its secrets are reused.
#
# It stops short of two things on purpose:
#   - certbot, so you type your own email rather than having one baked in
#   - ufw, because enabling a firewall unattended over SSH is how people lock
#     themselves out of their own box
# Both are printed at the end.

set -euo pipefail

DOMAIN="${DOMAIN:-heirlom.fun}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[32m✓\033[0m %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo ./deploy/bootstrap.sh)"; exit 1; }

# ---------------------------------------------------------------- packages ---
say "System packages"
export DEBIAN_FRONTEND=noninteractive

# A single broken third-party repo must not end the deploy. Boxes collect these
# — an expired ClickHouse or Docker key, a PPA for something long uninstalled —
# and none of them are repos we need. Refresh what we can, name what failed,
# and let the install below be the real test.
if ! apt-get update -qq 2>/tmp/heirlom-apt.err; then
  grep -oE "The repository '[^']+'" /tmp/heirlom-apt.err 2>/dev/null \
    | sed "s/The repository /    could not refresh: /" | sort -u || true
  echo "    carrying on — the Ubuntu indexes are the ones that matter"
fi

if ! apt-get install -y -qq curl git ca-certificates gnupg nginx postgresql redis-server >/dev/null; then
  echo
  echo "apt could not install the base packages."
  echo "If the failure above names a third-party repo, disable it and re-run:"
  echo "    ls /etc/apt/sources.list.d/"
  echo "    mv /etc/apt/sources.list.d/<offender>.list{,.disabled}"
  exit 1
fi
ok "nginx, postgresql, redis"

if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node -v)"

command -v pm2 >/dev/null || npm i -g pm2 >/dev/null 2>&1
ok "pm2 $(pm2 -v 2>/dev/null || echo installed)"

systemctl enable --now postgresql redis-server nginx >/dev/null 2>&1 || true

# ---------------------------------------------------------------- database ---
say "Database"
ENV_FILE="apps/server/.env"
if [ -f "$ENV_FILE" ] && grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  # Reuse the existing password rather than rotating it, but still make sure the
  # role and database exist — a first run that died midway leaves .env written
  # and Postgres empty, and skipping this would fail every re-run after it.
  DB_PASS="$(sed -n 's|^DATABASE_URL=postgresql://heirlom:\([^@]*\)@.*|\1|p' "$ENV_FILE")"
  ok "apps/server/.env exists — keeping its secrets"
else
  DB_PASS="$(openssl rand -hex 16)"
  JWT="$(openssl rand -hex 32)"
  NEW_ENV=1
fi

# psql as the postgres user goes over the unix socket; Prisma goes over TCP.
# Those are different doors, and on a box with more than one cluster they do not
# lead to the same room — a second cluster lands on 5433 while 5432 stays taken.
# Ask the running cluster which port it is actually on rather than assuming.
PG_PORT="$(sudo -u postgres psql -tAc 'SHOW port' 2>/dev/null | tr -d '[:space:]')"
PG_PORT="${PG_PORT:-5432}"
ok "postgres cluster answers on port ${PG_PORT}"

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='heirlom'" | grep -q 1; then
  sudo -u postgres psql -qc "ALTER USER heirlom WITH PASSWORD '${DB_PASS}';"
else
  sudo -u postgres psql -qc "CREATE USER heirlom WITH PASSWORD '${DB_PASS}';"
fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='heirlom'" | grep -q 1 \
  || sudo -u postgres psql -qc "CREATE DATABASE heirlom OWNER heirlom;"
ok "role and database present"

if [ "${NEW_ENV:-0}" = "1" ]; then
  cp apps/server/.env.example "$ENV_FILE"
  sed -i "s|^NODE_ENV=.*|NODE_ENV=production|" "$ENV_FILE"
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://heirlom:${DB_PASS}@127.0.0.1:${PG_PORT}/heirlom|" "$ENV_FILE"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" "$ENV_FILE"
  sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=https://${DOMAIN},https://www.${DOMAIN}|" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "created $ENV_FILE with a fresh DB password and JWT secret"
fi

# An existing .env may point at the wrong port if the cluster moved.
if [ "${NEW_ENV:-0}" != "1" ]; then
  sed -i "s|^DATABASE_URL=postgresql://heirlom:\([^@]*\)@[^/]*/heirlom|DATABASE_URL=postgresql://heirlom:\1@127.0.0.1:${PG_PORT}/heirlom|" "$ENV_FILE"
fi

# Prove TCP works before Prisma has to, so a failure names the cause instead of
# arriving as a bare "Can't reach database server".
if ! PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p "$PG_PORT" -U heirlom -d heirlom -tAc 'SELECT 1' >/dev/null 2>&1; then
  say "Postgres is not reachable over TCP — opening localhost"
  PG_CONF="$(sudo -u postgres psql -tAc 'SHOW config_file' | tr -d '[:space:]')"
  HBA="$(sudo -u postgres psql -tAc 'SHOW hba_file' | tr -d '[:space:]')"

  grep -qE "^\s*listen_addresses\s*=\s*'.*localhost" "$PG_CONF" \
    || { sed -i "s|^#*\s*listen_addresses.*|listen_addresses = 'localhost'|" "$PG_CONF"; ok "set listen_addresses = 'localhost'"; }
  grep -qE "^host\s+heirlom\s+heirlom\s+127\.0\.0\.1/32" "$HBA" \
    || { echo "host    heirlom    heirlom    127.0.0.1/32    scram-sha-256" >> "$HBA"; ok "allowed heirlom over 127.0.0.1 in pg_hba"; }

  systemctl restart postgresql
  sleep 3
  PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -p "$PG_PORT" -U heirlom -d heirlom -tAc 'SELECT 1' >/dev/null 2>&1 || {
    echo
    echo "Still cannot reach Postgres over TCP at 127.0.0.1:${PG_PORT}."
    echo "Show me the output of these three and I can pin it down:"
    echo "    pg_lsclusters"
    echo "    ss -ltnp | grep 543"
    echo "    tail -20 ${HBA}"
    exit 1
  }
fi
ok "database reachable over TCP on ${PG_PORT}"

# ------------------------------------------------------------------- build ---
say "Install and build"
npm install --no-audit --no-fund
npm run build -w @heirlom/genetics        # first: the other two resolve against it
npm run db:push -w @heirlom/server
npm run build -w @heirlom/server

# NEXT_PUBLIC_* are inlined at BUILD time. Exported here because setting them in
# PM2 would have no effect at all — the value is already in the bundle.
export NEXT_PUBLIC_API_URL="https://${DOMAIN}"
export NEXT_PUBLIC_SITE_URL="https://${DOMAIN}"
npm run build -w @heirlom/web
ok "built for https://${DOMAIN}"

# --------------------------------------------------------------------- run ---
say "Processes"
mkdir -p logs apps/server/logs apps/web/logs
if pm2 describe heirlom-server >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --env production
else
  pm2 start ecosystem.config.cjs --env production
fi
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
ok "pm2 up and set to survive reboot"

say "Waiting for both apps to answer"
for i in $(seq 1 30); do
  api=$(curl -fsS localhost:4000/health 2>/dev/null || true)
  web=$(curl -fsS -o /dev/null -w '%{http_code}' localhost:3000 2>/dev/null || true)
  [ -n "$api" ] && [ "$web" = "200" ] && break
  sleep 2
done
[ -n "${api:-}" ] || { echo "API never answered. pm2 logs heirlom-server --lines 50"; exit 1; }
[ "${web:-}" = "200" ] || { echo "Web never answered. pm2 logs heirlom-web --lines 50"; exit 1; }
ok "api  $api"
ok "web  HTTP $web"

# ------------------------------------------------------------------- nginx ---
say "Nginx"
cp "deploy/nginx/${DOMAIN}.conf" "/etc/nginx/sites-available/${DOMAIN}"
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
ok "serving ${DOMAIN} on :80"

code=$(curl -fsS -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN}" http://127.0.0.1/ || true)
ok "through nginx: HTTP ${code}"

cat <<EOF

────────────────────────────────────────────────────────────
 http://${DOMAIN} should be live now.

 Two steps left, deliberately not automated:

 1. TLS — you enter your own email:
      apt install -y certbot python3-certbot-nginx
      certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}

 2. Firewall — check the SSH rule lands before enabling:
      ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable

 Then confirm the link preview is absolute:
      curl -s https://${DOMAIN} | grep -o 'og:image" content="[^"]*"'
────────────────────────────────────────────────────────────
EOF
