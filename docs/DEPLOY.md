# Deploying HEIRLOM to heirlom.fun

Target: the Hostinger VPS at `31.97.66.123`, which the domain's `A @` record
already points at. One origin serves both apps — Nginx sends `/api` to Fastify
on `:4000` and everything else to Next on `:3000`.

DNS is already correct. Nothing below touches it.

| record | value |
|---|---|
| `A @` | `31.97.66.123` |
| `CNAME www` | `heirlom.fun` |

---

## The one thing that catches everybody

`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SITE_URL` are **inlined at build time**.
Putting them in PM2's environment, in systemd, or in a shell before `pm2 start`
does nothing at all — whatever they were during `next build` is already baked
into the JavaScript.

Export them *before* building, and rebuild whenever they change. If link
previews on X come up blank, this is why.

---

## The short way

Steps 1 to 7 below, in one command:

```bash
cd /var/www/heirlom && sudo ./deploy/bootstrap.sh
```

It is safe to re-run — every step checks before it acts, and an existing
`apps/server/.env` is never overwritten. It stops before certbot and before
`ufw`, and prints both: the first so you enter your own email, the second
because enabling a firewall unattended over SSH is how people lock themselves
out of their own box.

The manual walkthrough follows, for when something needs unpicking.

---

## 1. Prerequisites on the VPS

```bash
ssh root@31.97.66.123

apt update && apt install -y curl git nginx postgresql redis-server
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
npm i -g pm2

systemctl enable --now postgresql redis-server nginx
```

## 2. Database

```bash
sudo -u postgres psql -c "CREATE USER heirlom WITH PASSWORD 'PICK-A-REAL-PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE heirlom OWNER heirlom;"
```

## 3. Code

```bash
mkdir -p /var/www && cd /var/www
git clone https://github.com/fourtisf/heirlom-farm.git heirlom
cd heirlom
npm install
```

## 4. Configuration

```bash
cp apps/server/.env.example apps/server/.env
nano apps/server/.env
```

Set these four. The rest of the file is fine as shipped:

```ini
NODE_ENV=production
DATABASE_URL=postgresql://heirlom:PICK-A-REAL-PASSWORD@localhost:5432/heirlom
JWT_SECRET=          # openssl rand -hex 32  — the server refuses to boot under 32 chars
CORS_ORIGIN=https://heirlom.fun,https://www.heirlom.fun
```

## 5. Build

```bash
npm run build -w @heirlom/genetics     # must be first; the others resolve against it
npm run db:push -w @heirlom/server
npm run build -w @heirlom/server

# Build-time, not run-time. See the warning above.
export NEXT_PUBLIC_API_URL=https://heirlom.fun
export NEXT_PUBLIC_SITE_URL=https://heirlom.fun
npm run build -w @heirlom/web
```

## 6. Run

```bash
mkdir -p logs
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup            # then run the line it prints, so PM2 survives a reboot

curl localhost:4000/health     # {"ok":true,"db":true,"redis":true,...}
curl -I localhost:3000         # 200
```

Both must pass before Nginx goes in front. A 502 later is almost always one of
these two never having answered.

## 7. Nginx and TLS

```bash
cp deploy/nginx/heirlom.fun.conf /etc/nginx/sites-available/heirlom.fun
ln -sf /etc/nginx/sites-available/heirlom.fun /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

apt install -y certbot python3-certbot-nginx
certbot --nginx -d heirlom.fun -d www.heirlom.fun
```

Certbot rewrites the site file to add TLS and sets up renewal. Take its offer
to redirect HTTP to HTTPS.

## 8. Check it from outside

```bash
curl -sI https://heirlom.fun | head -1                       # 200
curl -s  https://heirlom.fun/health                          # ok:true, db:true, redis:true
curl -s  https://heirlom.fun | grep -o '<title>[^<]*</title>'
curl -s  https://heirlom.fun | grep -o 'og:image" content="[^"]*"'
```

That last line must print an **absolute `https://heirlom.fun/...` URL**. If it
shows `localhost`, `NEXT_PUBLIC_SITE_URL` was not exported before the web build
— go back to step 5.

Then paste `https://heirlom.fun` into X's Post Composer and confirm the card
renders. X caches previews aggressively, so get it right before sharing widely.

---

## Redeploying

```bash
cd /var/www/heirlom && ./deploy/update.sh
```

## Firewall

Only 80, 443 and SSH should be open. Postgres, Redis, `:3000` and `:4000` are
all localhost-only and must stay that way.

```bash
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

## Why the proxy headers in the Nginx config matter

The server runs with `trustProxy: true`, and its rate limiter falls back to
`req.ip` for requests that are not yet signed in. Strip `X-Forwarded-For` and
every visitor arrives as `127.0.0.1` sharing a single 240/min bucket — one bot
would rate-limit the login endpoint for everyone. The headers are load-bearing.
