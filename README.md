# kharcha-web

Kharcha as a PWA. Replaces the sideloaded Expo app.

```
iPhone SMS ─▶ Mac mini chat.db ─▶ kharcha-mini ingest (every 15 min, regex parse)
                                        │ POST /api/ingest (bearer token, tailnet)
                                        ▼
                         VPS: kharcha-web (this repo, SQLite) ◀── PWA on phone/laptop
```

- **kharcha-mini** (Mac mini) only reads `chat.db` and parses. After each run, `src/sync/push-vps.ts` sends rows past its cursor.
- **kharcha-web** (VPS) is the source of truth for the UI. Ingest upserts by `mini_id`. Rows edited in the app keep their edits. A tombstone from either side sticks.
- Stack copies `odisha-travel`: TanStack Start (SSR), React 19, Tailwind 4, Zod, Nitro on Node 22.
- Data: **Drizzle ORM** over `node:sqlite` via `drizzle-orm/sqlite-proxy` (no native build on the VPS). Schema is `src/server/db/schema.ts`. Migrations live in `drizzle/` (`npm run db:generate`) and apply on first DB use. File: `$STATE_DIRECTORY/kharcha.db`.

## PWA and offline

Every page is server-rendered with live data and sent `Cache-Control: no-store`. The phone keeps **no transaction data**: the service worker caches only the app shell (icons, manifest, hashed JS/CSS, `offline.html`). When the device is offline or off the tailnet, navigation shows the offline page. Server-function writes are CSRF-checked (TanStack's default same-origin middleware).

## Security model

Finance data. Two ways in:

- **Public**: `https://kharcha.chetan-vps.tech` via Coolify's Traefik proxy. Every page and server function requires a password login: scrypt hash in `APP_PASSWORD_HASH`, HMAC-signed 90-day `HttpOnly; Secure; SameSite=Lax` cookie keyed by `SESSION_SECRET`. Login is rate-limited (5 per IP and 30 global per 15 minutes). `/api/ingest`, `/api/health`, `/api/jobs` and `/api/mini` return 403 publicly (Traefik rule `/data/coolify/proxy/dynamic/kharcha-guard.yaml`). If either env var is missing, the app fails closed.
- **Tailnet**: `https://vps.bullhead-mine.ts.net:8790` (`tailscale serve`). Same login. The mini pushes to `/api/ingest` here with `INGEST_TOKEN`.

Log out everywhere: change `SESSION_SECRET` and restart. Change password: `printf %s 'new password' | node --experimental-strip-types scripts/hash-password.ts`, put the output in `APP_PASSWORD_HASH`, restart.

## Screens

Today, Review, Activity, Plan (budgets, recurring, trips, owed), Wealth, Insights, Ask, Settings, transaction detail with receipts. Spec: `docs/design/DESIGN.md`. `GET /api/health` (tailnet only) gives row count and last ingest time.

## Wealth data

Fund values and SIPs come from broker statements, not live prices: there are no units or purchase history yet, so Wealth shows "Statement of <date> · not live" and XIRR —. To refresh, hand the new statement to an agent; it loads `holdings.manual_value`/`manual_invested`/`manual_value_date` and upserts `sip_mandates` (keyed by hashed `source_key`) on the VPS after a `.backup`. There is no import screen for this on purpose. Live value needs units per fund (then `scheme_code` + nightly prices take over).

## Develop

```bash
npm ci
npm run dev           # http://127.0.0.1:3000, data in .data/
npm run quality       # biome, tsc, knip, scripts/check-db.ts self-check
npm run db:generate   # after editing schema.ts; commit the new drizzle/ files
npm run build
```

## Deploy (VPS)

Coolify on the VPS builds `main` with Railpack (no Dockerfile) since 2026-10-20. Live since 2026-10-15.

- Push or merge to `main`: Coolify GitHub App `chetan-vps-coolify` deploys it.
- Pull requests: Coolify deploys a preview at `https://kharcha-<pr>.chetan-vps.tech` and comments its URL on the PR. Closing the PR deletes it. Previews get the same secrets and login, and their own empty database.
- `https://kharcha.chetan-vps.tech` (Hostinger A record `kharcha` → `200.234.46.235`; Traefik handles TLS)
- `https://vps.bullhead-mine.ts.net:8790` (tailnet; Tailscale Serve to `127.0.0.1:8790`)

Login is on. Data: SQLite in Docker volume `kharcha-web-data` at `/data/kharcha.db`, attachments in `/data/attachments`. Secrets are runtime environment variables in Coolify: `INGEST_TOKEN`, `SESSION_SECRET`, `APP_PASSWORD_HASH`, `OPENROUTER_API_KEY`, `KHARCHA_AI=on`, `STATE_DIRECTORY=/data`.

Receipt reading runs OCR (`tesseract`) and sends only redacted text to OpenRouter. Without `tesseract`, receipts fail as unreadable and nothing is sent. The Railpack image does not install it yet, so receipt OCR is off in the Coolify container.

Job timers (`kharcha-web-job-*.timer`) run on the VPS host and POST to `127.0.0.1:8790` with `INGEST_TOKEN`.

Operate: logs, redeploy and rollback in the Coolify dashboard (app `kharcha-web`). Health: `curl https://vps.bullhead-mine.ts.net:8790/api/health`. Nightly `vps-backup` copies the database and files to R2.

Legacy: `deploy/` holds the retired `/srv/kharcha-web` + Caddy release scripts. Their units are disabled, not deleted, as a rollback path.

Connect the mini (in the kharcha-mini repo, never commit these values):

```bash
sqlite3 data/kharcha-mini.db "INSERT OR REPLACE INTO config (key,value) VALUES
  ('vps_push_url','https://vps.bullhead-mine.ts.net:8790'),('vps_push_token','<same token>');"
bun run push:vps   # backfills all rows, then every ingest run pushes the new ones
```

## Retiring the Expo app

Keep it installed until this covers daily use, then let its signing lapse. Gmail sync moves server-side later if still wanted.
