# kharcha-web

- Personal finance data. Public only behind the login in `src/start.ts`; every new route or server function is protected by default; add to `PUBLIC` only with its own guard. Keep `/api/ingest` and `/api/health` blocked in `deploy/kharcha.caddy`.
- Never commit tokens, URLs with tokens, `.data/`, or real transaction exports. Use synthetic fixtures.
- Run `npm run quality` after edits and `npm run build` for SSR/build changes. `scripts/check-db.ts` is the one self-check for ingest merge rules; keep it passing.
- All DB access goes through Drizzle (`src/server/db/`). Schema changes: edit `schema.ts`, run `npm run db:generate`, commit the migration. Never hand-edit applied migrations.
- Pages must stay `no-store` and the service worker must never cache HTML or `/_serverFn`/`/api` responses; the device holds no finance data.
- The ingest contract (`miniRowSchema` in `src/server/db/queries.ts`) must match `kharcha-mini/src/sync/push-vps.ts`. Change both together.
- Changes do not authorize push, merge, or deploy. Keep unrelated VPS services and port 20128 running.
- `src/server/parsers/` is a copy of the mini's regex parsers, used by Paste. A parser fix in `kharcha-mini/src/parsers/` must be copied over.
- UI follows `docs/design/DESIGN.md` and its boards. Tokens live in `src/styles.css`; formatting in `src/lib/format.ts` (`npm run check:format`).
- AI: OpenRouter only from `src/server/ai/`. Never send raw SMS, card numbers or UPI IDs. Ask and Receipts stay off unless `KHARCHA_AI=on`.
- `/api/jobs/*` are bearer-token endpoints for the systemd timer; keep them blocked in `deploy/kharcha.caddy`.
