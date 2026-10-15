# kharcha-web

- Personal finance data. Keep it tailnet-only (`tailscale serve`); never add a public Caddy site or Funnel without real auth.
- Never commit tokens, URLs with tokens, `.data/`, or real transaction exports. Use synthetic fixtures.
- Run `npm run quality` after edits and `npm run build` for SSR/build changes. `scripts/check-db.ts` is the one self-check for ingest merge rules; keep it passing.
- All DB access goes through Drizzle (`src/server/db/`). Schema changes: edit `schema.ts`, run `npm run db:generate`, commit the migration. Never hand-edit applied migrations.
- Pages must stay `no-store` and the service worker must never cache HTML or `/_serverFn`/`/api` responses; the device holds no finance data.
- The ingest contract (`miniRowSchema` in `src/server/db/queries.ts`) must match `kharcha-mini/src/sync/push-vps.ts`. Change both together.
- Changes do not authorize push, merge, or deploy. Keep unrelated VPS services and port 20128 running.
