# VPS production stack — real tools, one command

This runs the **full production system** on a VPS with Docker: your website +
operations console, plus the **real** open-source products for CRM, invoicing and
booking, each on its own subdomain with automatic HTTPS.

| Service | What it is | Turnkey in this stack? |
|---|---|---|
| `app` | Website + operations console (this repo) | ✅ Yes |
| `caddy` | Reverse proxy + automatic HTTPS | ✅ Yes |
| `espocrm` | Real CRM product | ✅ Yes |
| `invoiceninja` | Real invoicing product | ⚠️ One first-run step (below) |
| `cal` | Real booking product (Cal.com) | ⚠️ One first-run step (below) |
| databases + `redis` | MySQL / Postgres / Redis | ✅ Yes |

> **Honesty note.** I validated the compose file's syntax and interpolation, and
> the `app`/`caddy`/`espocrm`/database services are standard official images that
> run as-is. Invoice Ninja and Cal.com are wired (database, Redis, env, HTTPS
> routing) but each has a documented first-run step, and I could not boot Docker
> in my build environment to runtime-verify them end to end. Follow the two short
> steps below and check each subdomain.

## 0. Prerequisites
- A VPS (Hostinger VPS is fine) with **Docker + Docker Compose** installed.
- Four DNS **A records**, all pointing at the VPS IP:
  - `likeakinginc.com` → app
  - `crm.likeakinginc.com` → EspoCRM
  - `invoices.likeakinginc.com` → Invoice Ninja
  - `book.likeakinginc.com` → Cal.com
- Ports **80** and **443** open.

## 1. Get the code + config onto the VPS
```bash
git clone <your repo> likeaking && cd likeaking/likeaking-inc-app
cp .env.prod.example .env
```

## 2. Fill in `.env`
Generate the secrets it asks for:
```bash
openssl rand -hex 32                       # SESSION_SECRET
echo "base64:$(openssl rand -base64 32)"   # IN_APP_KEY   (Invoice Ninja)
openssl rand -base64 32                     # CAL_NEXTAUTH_SECRET
openssl rand -base64 24 | cut -c1-32        # CAL_ENCRYPTION_KEY (must be 32 chars)
```
Set the domains, `CRM_PASSWORD`, database passwords, and (optionally) SMTP.

## 3. Bring it up
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
Caddy issues HTTPS certs on first request (give it a minute). Then:
- `https://likeakinginc.com` — site + `/admin` console
- `https://crm.likeakinginc.com` — EspoCRM (log in with `ESPO_ADMIN_*`)

## 4. Invoice Ninja — first run
Once containers are up, initialise its database:
```bash
docker compose -f docker-compose.prod.yml exec invoiceninja php artisan migrate:fresh --seed --force
```
Then open `https://invoices.likeakinginc.com` and sign in with the default
Invoice Ninja credentials shown in their docs (change them immediately). If the
page 502s, the app container is still booting — wait and retry.
Reference: https://invoiceninja.github.io/docs/self-host-installation/

## 5. Cal.com — first run
Apply its database schema:
```bash
docker compose -f docker-compose.prod.yml exec cal npx prisma migrate deploy
```
Open `https://book.likeakinginc.com` and complete the setup wizard.
Reference: https://github.com/calcom/cal.com (self-hosting)

## 6. Wire the console to the real tools
In `https://likeakinginc.com/admin` → **Settings → Integrations**, paste:
- Invoicing URL → `https://invoices.likeakinginc.com`
- Booking URL → `https://book.likeakinginc.com`
- CRM URL → `https://crm.likeakinginc.com`

Save. Now the console's **Invoices / Bookings / Customers** tabs open the real
products inside the admin, with the built-in modules as a fallback.

## 7. The other 130+ tools
Everything else in the **Armory** (Chatwoot, n8n, Metabase, Plausible, …) launches
from the console once it can reach the Docker socket. To enable that, add to the
`app` service in `docker-compose.prod.yml`:
```yaml
    volumes:
      - app_data:/data
      - /var/run/docker.sock:/var/run/docker.sock   # lets the Armory launch tools
```
Only do this on a host you control — it grants the app control of Docker.

## Updating / backups
```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build   # update
docker compose -f docker-compose.prod.yml down                        # stop (keeps volumes/data)
```
Your CRM data lives in the `app_data`, `mysql_*`, `pg_cal` volumes — back those up
(`docker run --rm -v likeaking_app_data:/d -v $PWD:/b alpine tar czf /b/app_data.tgz /d`).
