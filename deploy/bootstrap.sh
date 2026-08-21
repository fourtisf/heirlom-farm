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
  sed -i "s|^HOST=.*|HOST=127.0.0.1|" "$ENV_FILE"
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
# Same origin behind nginx: relative, so it works on http and https alike.
export NEXT_PUBLIC_API_URL=""
export NEXT_PUBLIC_SITE_URL="https://${DOMAIN}"
npm run build -w @heirlom/web
ok "built for https://${DOMAIN}"

# --------------------------------------------------------------------- run ---
say "Processes"
mkdir -p logs apps/server/logs apps/web/logs

# Clear our own entries first, so a previous attempt's processes do not make
# their own ports look occupied to the search below. Only ours — anything else
# on this box is somebody's running site.
pm2 delete heirlom-server heirlom-web >/dev/null 2>&1 || true

# Actually try to connect rather than parsing `ss`, which is not guaranteed to
# be installed — and a missing tool made the earlier version report every port
# free, which is the one wrong answer that matters here.
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3<&- 3>&-; return 0; }; return 1; }
pick_port() { local p="$1"; while port_busy "$p"; do p=$((p + 1)); done; echo "$p"; }

API_PORT="$(pick_port 4000)"
WEB_PORT="$(pick_port 3000)"
export API_PORT WEB_PORT
if [ "$API_PORT" != "4000" ] || [ "$WEB_PORT" != "3000" ]; then
  ok "3000/4000 already taken on this box — using web ${WEB_PORT}, api ${API_PORT}"
else
  ok "web ${WEB_PORT}, api ${API_PORT}"
fi

pm2 start ecosystem.config.cjs --env production
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
ok "pm2 up and set to survive reboot"

say "Waiting for both apps to answer"
for i in $(seq 1 30); do
  api=$(curl -fsS "localhost:${API_PORT}/health" 2>/dev/null || true)
  web=$(curl -fsS -o /dev/null -w '%{http_code}' "localhost:${WEB_PORT}" 2>/dev/null || true)
  [ -n "$api" ] && [ "$web" = "200" ] && break
  sleep 2
done
if [ -z "${api:-}" ] || [ "${web:-}" != "200" ]; then
  echo
  echo "One of the apps never answered. Last lines of its log:"
  [ -z "${api:-}" ] && { echo "--- heirlom-server ---"; pm2 logs heirlom-server --lines 30 --nostream 2>/dev/null || true; }
  [ "${web:-}" != "200" ] && { echo "--- heirlom-web ---"; pm2 logs heirlom-web --lines 30 --nostream 2>/dev/null || true; }
  exit 1
fi
ok "api  $api"
ok "web  HTTP $web"

# ------------------------------------------------------------------- nginx ---
say "Nginx"
sed -e "s|127\\.0\\.0\\.1:3000|127.0.0.1:${WEB_PORT}|" \
    -e "s|127\\.0\\.0\\.1:4000|127.0.0.1:${API_PORT}|" \
    "deploy/nginx/${DOMAIN}.conf" > "/etc/nginx/sites-available/${DOMAIN}"
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"

# Not every box includes sites-enabled. Panel-built stacks often use conf.d
# only, and then the file above is written, symlinked, passes `nginx -t`, and is
# never loaded — the request falls through to whatever is default and 404s.
if ! nginx -T 2>/dev/null | grep -q "server_name ${DOMAIN}"; then
  ok "sites-enabled is not included — installing into conf.d instead"
  cp "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/conf.d/${DOMAIN}.conf"
fi

nginx -t
systemctl reload nginx

code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN}" http://127.0.0.1/ || echo 000)
if [ "$code" = "200" ]; then
  ok "through nginx: HTTP 200"
else
  echo
  echo "nginx answered HTTP ${code} for ${DOMAIN}, not 200."
  echo
  echo "Server blocks nginx has actually loaded:"
  nginx -T 2>/dev/null | grep -nE "^\s*(server_name|listen)" | sed 's/^/    /'
  echo
  echo "Config directories:"
  ls -1 /etc/nginx/sites-enabled/ 2>/dev/null | sed 's/^/    sites-enabled: /'
  ls -1 /etc/nginx/conf.d/ 2>/dev/null | sed 's/^/    conf.d: /'
  echo
  echo "Upstreams this site was rendered with:"
  grep -n "upstream\|127.0.0.1:" "/etc/nginx/sites-available/${DOMAIN}" | sed 's/^/    /'
  echo
  echo "What is listening:"
  for prt in 3000 3001 3002 3003 4000 4001 4002 4003; do
    (exec 3<>"/dev/tcp/127.0.0.1/$prt") 2>/dev/null && { exec 3<&- 3>&-; echo "    $prt busy"; }
  done
  echo
  echo "The apps themselves are fine — web answered 200 on ${WEB_PORT} above."
  echo "This is nginx routing only. Send the block above and it can be pinned down."
  exit 1
fi

# On a box already serving other sites over TLS, a domain with no 443 block of
# its own is not merely un-encrypted — it is served as somebody else. Browsers
# now upgrade navigations to https on their own, nginx finds no server_name
# match on 443, and falls through to whichever site holds the first one. The
# visitor types this domain and is shown a different product entirely.
if nginx -T 2>/dev/null | grep -q "listen 443" && \
   ! nginx -T 2>/dev/null | awk '/listen .*443/,/}/' | grep -q "server_name.*${DOMAIN}"; then
  echo
  echo "  ⚠  Other sites on this box answer on 443; ${DOMAIN} does not."
  echo "     A browser upgrading to https will be shown one of them instead of"
  echo "     this game. Run certbot below before sharing the link."
fi

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
