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

Finance data. **Tailnet-only**: served by `tailscale serve` on `https://vps.bullhead-mine.ts.net:8790`. No Caddy site, never Funnel. The UI and server functions have no login; tailnet membership is the auth. `/api/ingest` also requires `INGEST_TOKEN` (32+ chars). Before exposing this anywhere public, add real auth.

## Screens (v1)

- **Today**: month switcher, spend, income, invested, by-category bars, recent, review count, last sync.
- **History**: search, needs-review filter, edit or delete in a dialog (shows the source SMS).
- **Budgets**: monthly limit per category with progress; 0 removes one.
- **Add**: manual entry.
- `GET /api/health`: row count and last ingest time, for Uptime Kuma.

The UI is a placeholder until the Claude Design pass. Deferred: subscriptions, portfolio, export, reimbursements, offline write outbox.

## Develop

```bash
npm ci
npm run dev           # http://127.0.0.1:3000, data in .data/
npm run quality       # biome, tsc, knip, scripts/check-db.ts self-check
npm run db:generate   # after editing schema.ts; commit the new drizzle/ files
npm run build
```

## Deploy (VPS)

First install, from the Mac:

1. On the VPS, create `/etc/kharcha-web/env` with mode 600 containing `INGEST_TOKEN=<openssl rand -hex 32>`.
2. Run `bash deploy/release.sh`. It installs the units, the `/usr/local/lib/kharcha-web/activate.sh` script, and the autodeploy timer.
3. On the VPS, run `sudo tailscale serve --bg --https=8790 http://127.0.0.1:8790`.

Routine deploys: merge to `main`. The VPS timer builds and activates within about 3 minutes. Unit and script changes need `release.sh` again.

Connect the mini (in the kharcha-mini repo, never commit these values):

```bash
sqlite3 data/kharcha-mini.db "INSERT OR REPLACE INTO config (key,value) VALUES
  ('vps_push_url','https://vps.bullhead-mine.ts.net:8790'),('vps_push_token','<same token>');"
bun run push:vps   # backfills all rows, then every ingest run pushes the new ones
```

## Retiring the Expo app

Keep it installed until this covers daily use, then let its signing lapse. Gmail sync moves server-side later if still wanted.
