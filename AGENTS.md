# kharcha-web

- Personal finance data. Keep it tailnet-only (`tailscale serve`); never add a public Caddy site or Funnel without real auth.
- Never commit tokens, URLs with tokens, `.data/`, or real transaction exports. Use synthetic fixtures.
- Run `npm run quality` after edits and `npm run build` for SSR/build changes. `scripts/check-db.ts` is the one self-check for ingest merge rules; keep it passing.
- The ingest contract (`miniRowSchema` in `src/server/db.ts`) must match `kharcha-mini/src/sync/push-vps.ts`. Change both together.
- Changes do not authorize push, merge, or deploy. Keep unrelated VPS services and port 20128 running.
