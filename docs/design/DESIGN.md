# Kharcha design handoff

Source of truth for the UI rebuild of `kharcha-web`. Read this whole file before writing code.

- Canvas (visual reference): https://claude.ai/code/artifact/2342fd6d-ea07-4b0f-aa69-9b7d310a57b7
- Board sources: `docs/design/boards/*.dc.html`. Each file is one screen with inline styles. Read exact values (sizes, colours, spacing) from these files, not from screenshots.
- The boards run on a design runtime (`support.js`, `<x-dc>`, `<sc-for>`, `{{holes}}`). Do not copy that runtime into the app. Port the markup to React components.
- All numbers are sample data. Real October 2026 figures were used where they existed (spend ₹47,854, categories, merchants, 115 to review). Fund values, targets, trips, income and multipliers like "2.8×" are invented.

## 0. Stack

TanStack Start (SSR), React 19, Drizzle over `node:sqlite`, and Zod, as today.

- **UI:** Tailwind 4 plus shadcn/ui. Restyle shadcn with the ledger tokens in §3 and never ship its default look.
- **Motion:** `motion` for swipe (review deck, row actions), sheets and snackbars only.
- **Charts:** plain SVG components, no chart library.

## 1. Principles

1. **Single user.** No accounts, sharing or invites.
2. **The ledger fills itself.** SMS ingest is the main input. The core job is reviewing what arrived. Manual add is the fallback.
3. **Honest numbers.** Every total links to its rows. The AI never computes a figure. Prices carry their date.
4. **The device holds no finance data.** Pages stay `no-store`. The service worker caches the shell only. `AGENTS.md` stays as it is.
5. **Classical ledger look.** Paper, ink, one indigo accent, serif numerals, hairline rules. At most one dark ink hero per screen.
6. **Copy.** Sentence case, one short label. No helper text under headings unless it prevents a mistake (privacy, FX rate, AI off).

## 2. Information architecture

Mobile has a bottom tab bar with 5 tabs, plus the add button. Desktop (≥840px) has a sidebar with 7 items, then Settings.

| Mobile | Desktop | Route | Boards |
|---|---|---|---|
| Today | Today | `/` | `Main`, `DeskHome` |
| card on Today | Review | `/review` | `Review`, `DeskReview` |
| Activity | Activity | `/activity` | `History`, `DeskHistory` |
| Plan | Plan | `/plan/budgets` · `/plan/recurring` · `/plan/trips` | `Budgets` `Recurring` `Trips`, `DeskPlan` |
| Wealth | Wealth | `/wealth` | `Wealth`, `DeskWealth` |
| Insights | Insights | `/insights` | `Insights`, `DeskInsights` |
| header button | Ask | `/ask` | `Ask`, `DeskAsk` |
| gear on Today | Settings | `/settings` | `Settings` |

Detail and form routes:

| Route | Board |
|---|---|
| `/txn/$id` | `Detail` |
| `/txn/$id/edit` | `Edit` |
| `/txn/$id/receipt` | `Receipt` |
| `/add` | `Add` |
| `/paste?text=` | `Paste` |
| `/plan/recurring/$id` and `/plan/recurring/new` | `Series` |
| `/plan/trips/$id` | `Trip` |
| `/plan/trips/new` | `TripStart` |
| `/wealth/$id` | `Fund` |
| `/wealth/new` and `/wealth/$id/edit` | `Holding` |

Sheets (Add, Edit, TripStart) are bottom sheets on phones and dialogs at ≥600px.

Rename `/history` to `/activity` and `/budgets` to `/plan/budgets`. Delete the old routes; do not keep redirects.

## 3. Tokens

Replace the placeholder `@theme` in `src/styles.css` with this, and map shadcn's CSS variables onto it.

```css
@theme {
  --font-serif: "Newsreader", Georgia, serif;
  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  --color-paper: #F6F4EE;      /* page */
  --color-card: #FBFAF6;       /* cards, sheets, tab bar */
  --color-sunken: #EEEBE2;     /* segmented track, pills, SMS block */
  --color-rule: #D9D5C8;       /* card borders (decorative) */
  --color-hairline: #E2DED3;   /* row separators */
  --color-field: #8A8576;      /* input, chip, switch-off, dashed suggestion borders: 3.3:1 */
  --color-ink: #1C2230;
  --color-ink-2: #4A5163;
  --color-ink-3: #5E6272;      /* lowest text colour; do not go lighter */
  --color-brand: #2F4A7A;
  --color-brand-deep: #1F3459;
  --color-brand-soft: #E3E8F1;
  --color-earn: #2D6B4A;
  --color-over: #A3402D;
  --color-watch: #8A5A12;      /* bar fill only */
  --color-watch-text: #7A4F0E;
  --color-watch-soft: #F4E9D2;
  --color-trip: #1F3B4D;
  --color-trip-muted: #C8D3DA;

  --color-on-ink: #F6F4EE;
  --color-on-ink-2: #A9AEBB;
  --color-on-ink-month: #F2C879;
  --color-on-ink-gain: #8FD1A8;
  --color-on-ink-pace: #8FA6CF;

  --color-cat-food: #B4572E;
  --color-cat-shopping: #6B4C8A;
  --color-cat-transport: #2F6F8F;
  --color-cat-utilities: #8A6A1F;
  --color-cat-entertainment: #9B3D5C;
  --color-cat-home: #4F7A4A;
  --color-cat-health: #3D8077;
  --color-cat-sports: #6B7A2A;
  --color-cat-work: #55606E;
  --color-cat-other: #8A8576;

  --radius-chip: 999px;
  --radius-button: 10px;
  --radius-card: 12px;
  --radius-hero: 14px;
  --radius-sheet: 20px;
}
body { font-variant-numeric: tabular-nums lining-nums; }
```

- **Day-ring and heat scale:** `#CFD8E8 → #B9C6DD → #8199BF → #4C6A9C → #1F3459`.
- **Contrast:** measured on every board. Every text pair is 4.9:1 or better. Light text colours appear only on ink or trip surfaces. Field borders are 3.3:1 against paper.
- **Categories:** Sports' colour sits close in lightness to Home and Utilities. Categories are always shown with their label, so this is acceptable.
- **Fonts:** self-host with `@fontsource/newsreader`, `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono`. Weights used: Newsreader 400, 500 and 400 italic; Plex Sans 400, 500 and 600; Plex Mono 400.
- **Dark mode:** not designed. Ship light only, with every colour behind a token.

## 4. Formatting (`src/lib/format.ts`, unit-tested)

- **Money:** `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })` → `₹1,23,450`, `₹219.50`. Without the minimum, the default prints `.00`.
- **Compact (axes, tiles):** `notation: "compact"` → `1.2L`, `45K`.
- **Signs:** income and gains get `+` in `earn`. Expenses carry no sign. Over budget is written in words: `₹3,088 over`.
- **Foreign currency:** `$12.99 · ₹1,143`.
- **Dates:** `Thu 15 Oct`, `15 Oct, 14:44`, `24 Sept` (four-letter September, as `en-IN` prints it).
- **Prices:** always dated: `NAVs of 15 Oct`.
- **Cards:** `••2047`.

## 5. Components (`src/components/`)

| Component | Notes |
|---|---|
| `AppShell` | Mobile: `TabBar` (`calc(50px + env(safe-area-inset-bottom))`, 5 tabs, active tab gets a 2px top rule) plus `Fab` (56px, radius 16). ≥840px: `Sidebar` (240px), with the trip card when a trip is upcoming or active, then the sync pill and Settings. Desktop pages use a main column plus a 300px right rail. |
| `MonthSwitcher`, `SyncPill`, `StatusTag` | Sync pill states are listed in §9. |
| `InkHero` | Today and Wealth only. |
| `PaceChart`, `GainChart`, `Waterfall`, `DayRings`, `Beeswarm`, `Treemap`, `Sparkline`, `BudgetBar` | Plain SVG or CSS. Rules are on the Style board, §6. |
| `LedgerRow`, `DayHeader` | 56px rows, day total under a 1px ink rule. |
| `Chip`, `FilterChip`, `Segmented`, `Switch`, `Field` | Built on shadcn. Borders use `field`. Targets 38–44px. |
| `Sheet`, `Snackbar` | shadcn Sheet/Drawer and Sonner, restyled and animated with `motion`. |
| `TxnForm` | One component with `mode="add" \| "edit"`. **Add:** keypad first, expressions like `450+120`. **Edit:** amount field, a "Not a spend" switch, Delete, and a note when the merchant was renamed. |
| `DigestCard`, `InsightCard`, `AnswerCard`, `AiUnavailable` | Provenance lines stay visible. |
| `TripBand`, `ReceiptItems`, `RuleRow`, `CategoryRow` | |

## 6. Screens

Every list screen needs an empty state (one line plus one action), a loading skeleton, and an error state with retry.

- **Today**
  - Ink hero: spend, ₹ left, pace chart.
  - Gear (Settings) and Ask in the header.
  - Trip band, when a trip is upcoming within 7 days or active.
  - Digest card.
  - Next 10 days of recurring payments.
  - Review strip.
  - Treemap.
  - Wealth row.
  - Recent rows.
- **Review**
  - Mobile: card deck. Right confirms, left skips. Not a spend, Duplicate, Edit (`/txn/$id/edit`). An "Always file X as Y" checkbox creates a rule.
  - Desktop: table plus detail pane, with J/K/X/R/C/E shortcuts and bulk confirm.
- **Activity**
  - Search across merchant, category and SMS text.
  - Filter chips: needs review, month, category, card, type, trip. A summary bar for the filtered set.
  - Day groups. Swipe to delete with undo; the same action is on Detail.
- **Detail**
  - Amount, fields, source SMS, rename note, receipt entry, more rows from this merchant.
  - Not a spend / Delete. Edit opens `Edit`.
- **Edit:** `TxnForm` in edit mode, prefilled. Delete asks once, then shows an undo snackbar.
- **Receipt**
  - Up to 5 images or PDFs. AI extracts items, checks the total against the matched transaction, assigns a category per item, and offers an optional split.
  - When AI is unavailable, the images are kept and items are added by hand.
- **Paste:** text goes to the VPS, which parses it with the server copy of the mini's regex parsers (§8). The card shows "Parsed on server" and the FX note.
- **Plan · Budgets**
  - Month bar with a pace tick.
  - Category rows: tap to edit or remove inline.
  - "Other" has no budget; it shows as a dashed card that links to Review.
- **Plan · Recurring**
  - Committed per month, split SIPs vs subscriptions.
  - Calendar (filled dot = paid, ring = due), Coming up, Paid this month, "Looks recurring" suggestion, Add recurring.
  - Rows open `Series`.
- **Series**
  - Name, kind (Subscription, Bill, SIP, EMI, Insurance), expected amount ± tolerance, repeats, usual day, merchant match, Active/Paused, last payments with status and price change, Delete.
  - The predicted next date is shown under the name.
- **Plan · Trips**
  - Upcoming or active trip card, past trips with budget result, Start a trip.
  - Trip page: band, per-day bars (tap a day), categories, "Getting there" outside the daily budget, recurring payments left out, Edit / End.
- **Start a trip:** name, dates, budget per day, auto-tag and leave-recurring-out switches, bookings found before the trip.
- **Wealth**
  - Ink hero: value, day change with NAV date, invested / gain / XIRR, GainChart (1Y/2Y/All).
  - Allocation vs target.
  - Holdings rows open `Fund`.
  - Add holding, Import CSV.
  - NPS financial-year cap tracker.
- **Holding** (add or edit)
  - Kind: Fund, NPS, Gold, Other.
  - **Fund and Gold:** search by name, results show the AMFI code and current NAV.
  - **NPS and Other:** name plus a value you type in.
  - SIP amount and day, an "SMS contains" match with a live count of matching past debits, target %.
  - CSV import (`date, fund, amount, units, nav`) with a preview and an error count.
- **Fund:** value, NAV line with SIP buys and average cost, stats, next instalment, instalments.
- **Insights**
  - KPI tiles.
  - Worth-a-look cards (dismissable).
  - Fig. 1 waterfall, Fig. 2 day rings, Fig. 3 beeswarm, Fig. 4 six months.
  - Table 1: top merchants.
- **Ask:** thread of AnswerCards, follow-ups, input, privacy line.
- **Settings**
  - **App:** last SMS from the mini with health, Install app, Export CSV.
  - **AI:** off notice while login is off, text model, vision model, daily cap with today's usage.
  - **Categories:** reorder, rename, colour, add.
  - **Merchant rules:** list with edit and delete (undo), search, "All N rules".
- **Offline:** one line, "Can't reach your server right now.", and Retry. Nothing else.

**Desktop** (boards exist for all of these):

| Page | Main | Right rail |
|---|---|---|
| Today | ink hero + pace, then review / next 10 days / wealth, treemap, recent | digest card next to the hero |
| Review | table | detail pane for the selected row |
| Activity | day-grouped table + filters | detail pane |
| Plan | segmented Budgets/Recurring/Trips; budgets table (category, spent, limit, pace bar, status, edit) | trip card, next 10 days, "Other has no budget" |
| Wealth | ink hero with wide GainChart; holdings table with XIRR bars | Add holding / Import CSV, allocation vs target, NPS cap, price sources with dates |
| Insights | KPI row; Fig. 1 + Fig. 2 side by side; Fig. 3 full width | worth-a-look cards, top merchants |
| Ask | thread at max 760px, input pinned at the bottom | suggested questions, earlier questions, AI usage and privacy note |

## 7. Data model (Drizzle)

Keep `transactions` and the ingest contract (`miniRowSchema` ↔ `kharcha-mini/src/sync/push-vps.ts`) unchanged.

**Changes to `transactions`:**

- Add `excluded` (bool, "not a spend") and `duplicate_of` (int, nullable).
- `category` stays plain text, with **no foreign key**. Ingest maps any category missing from `categories` to `Other`, so ingest never fails.

**New tables:**

- **`categories`**: `name` (pk), `type`, `color_token`, `sort_order`.
  - Seed expense: Food, Transport, Shopping, Utilities, Entertainment, Health, Home, Sports, Work, Other.
  - Seed income: Salary, Refunds, Other.
- **`merchant_rules`**: `id`, `match`, `display_merchant`, `category`, `created_from_txn_id`, `created_at`. Applied on ingest. Edited and deleted in Settings. Deleting a rule never rewrites past rows.
- **`trips`**: `id`, `name`, `start_date`, `end_date`, `budget`, `auto_tag`, `skip_recurring`, `created_at`.
- **`transaction_trips`**: `transaction_id`, `trip_id`, `source` (auto/manual), `in_daily_budget`.
- **`recurring_series`**: `id`, `name`, `kind`, `match`, `cadence`, `usual_day`, `expected_amount`, `tolerance_pct`, `holding_id`, `status`, `created_at`.
- **`recurring_occurrences`**: `series_id`, `due_date` (predicted), `transaction_id`, `status` (upcoming/cleared/cleared_late/past_due).
- **`holdings`**:
  - `id`, `name`, `kind` (fund/gold/nps/other), `scheme_code` (nullable), `target_pct`, `is_closed`.
  - `manual_value` and `manual_value_date`, for NPS and other.
  - `sip_amount`, `sip_day`, `sms_match`.
- **`holding_txns`**: `id`, `holding_id`, `transaction_id`, `date`, `amount`, `units`, `nav`, `source` (sms/csv/manual).
- **`prices`**: `scheme_code`, `date`, `nav`, `source` (mfapi/amfi). Primary key on `scheme_code` and `date`.
- **`attachments`**, **`transaction_items`**, **`transaction_splits`**: as on the Receipt board. Splits must sum to the transaction amount, and budgets use splits when they exist.
- **`insights`**: `detector`, `key`, `payload_json`, `dismissed_at`.
- **`digests`**: `week_start`, `facts_json`, `text`, `model`.

Run `npm run db:generate` after each schema edit. Extend `scripts/check-db.ts` with these checks: unknown category maps to Other, rules apply on ingest, trip auto-tag, splits sum.

## 8. Server work

**Parsers.** Copy the mini's regex parsers into `src/server/parsers/` for Paste. They are a copy, not a shared package. Note this in `AGENTS.md`: a parser fix in the mini must be copied over.

Jobs run on a systemd timer next to autodeploy.

| Job | When | Does |
|---|---|---|
| `prices` | 23:30 and 06:00 IST | For each holding with a `scheme_code`: mfapi `/mf/{code}/latest`, falling back to AMFI `NAVAll.txt`. That covers funds and gold funds or ETFs. NPS and Other use their typed-in value. Show a stale badge after 2 trading days. |
| `recurring` | after each ingest | Match new rows to series (merchant, ±3 days, ± tolerance). Predict the next date from past payments: median interval, usual day. Suggest a series after 2 or more similar hits. Flag price changes. |
| `trip-tag` | after ingest and add | Tag rows inside an active trip window, unless the row is recurring, an investment or a self-transfer. |
| `detectors` | nightly | Unusual merchant spend, same-day repeat charges, new recurring, missing SIP debit, budget crossing date. |
| `digest` | Monday 07:00 IST | Compute facts with SQL; the LLM writes 3 lines from those facts only. |

**SIP linking.** Debits matching a holding's `sms_match` become `holding_txns`. Units come from that day's NAV in `prices`.

**OpenRouter** (`src/server/ai/`):

1. **Ask:** the model returns a query spec only, `{metric, filters, groupBy, period, compareTo}`, validated with zod. The server runs it. The model narrates the returned rows. Reject the answer if it contains a ₹ figure that is not in the result. Return `transactionIds` for the "Based on N" link.
2. **Receipts:** vision model. Blur card-number and phone-number regions first where possible. Output is validated with zod. Match to a transaction by amount ±₹1 and date ±1 day.
3. **Never send** raw SMS, card numbers or UPI IDs.
4. **Config** lives in `meta` and is editable in Settings: `openrouter_model`, `openrouter_vision_model`, `openrouter_daily_cap`.
5. **Unavailable** (cap reached, OpenRouter down, or AI off):
   - Ask: "AI is unavailable right now. Filters still work."
   - Receipt: "Couldn't read the images. They're saved; add items by hand or try later."
   - Digest: "This week's summary will be back tomorrow."
   - See the States board.

## 9. PWA

- **Manifest:**
  - `shortcuts`: Add expense `/add`, Paste SMS `/paste`, Review `/review`.
  - `share_target`: GET `/paste` with `text`.
- **Install**
  - Android and desktop Chrome: `beforeinstallprompt`, then a snackbar after the 3rd add. Remember dismissal.
  - iOS Safari: a one-time sheet with the steps (••• → Share → Add to Home Screen).
  - Settings → Install, always available.
- **Update:** when a worker is waiting, show "New version ready · Reload". Never reload while a sheet or form is open.
- **No offline writes.** The service worker caches the shell and `offline.html` only, and never HTML, `/_serverFn` or `/api`.
  - When offline, every write control is disabled.
  - A failed write shows "Couldn't save. Check the connection. · Retry", and the form keeps its values.
- **Sync pill** reads `/api/health`:
  - `Synced N min ago`: time of the last mini push.
  - `Offline`: `navigator.onLine` is false.
  - `Server unreachable`: online, but the health check fails.
  - `Mini quiet · N h`: no push for 6 hours.
- **Badge:** `navigator.setAppBadge(reviewCount)` when supported.

## 10. Keyboard (`src/keybindings.ts`, the single entry point)

| Key | Action |
|---|---|
| `N` | Add |
| `/` | Ask |
| `R` | Review |
| `J` / `K` | Move |
| `X` | Select |
| `C` | Category |
| `E` | Not a spend |
| `Esc` | Close |
| `?` | Shortcuts dialog, generated from the same file |

## 11. Accessibility

- Real `button` / `a` / `input` + `label`.
- Icon-only buttons get `aria-label`.
- Text 4.5:1 or better (measured, §3).
- 44px targets.
- Charts get `role="img"` with an `aria-label` stating the finding.
- Swipe actions also exist as buttons.
- Respect `prefers-reduced-motion`; `motion` handles it.

## 12. Build

Build everything in this file. Run `npm run quality` and `npm run build`, and check 390px and 1440px for each screen.

Remaining dependencies:

| Needed | For | Owner |
|---|---|---|
| `OPENROUTER_API_KEY` in `/etc/kharcha-web/env` | Ask, Receipts, digest | you |
| AMFI scheme codes for your funds (or pick them in Add holding) | Wealth prices, SIP units | you |
| CSV of past SIP buys (`date, fund, amount, units, nav`), optional | Wealth history before SMS | you |
| Login (auth) | Ask and Receipts are off until it exists. Settings shows why. The digest runs (server-side, aggregates only). | deferred, §13 |
| kharcha-mini fix for "Unknown ₹0" rows | clean Activity and Review | kharcha-mini, in parallel |

## 13. Open items

- **Auth:** deferred to the ChatGPT connector work. Until then, `KHARCHA_AUTH=off` stays as it is, and Ask and Receipts stay disabled behind `KHARCHA_AI=off`.
- **"Unknown ₹0" rows:** skipped SMS leaking through as transactions. Fix in kharcha-mini (do not push non-transactions). This runs in parallel and is the only change in the mini.
- **NPS:** NAVs are not in AMFI data, so mfapi does not have them. NPS stays a typed-in value unless you hold it through a fund that has an AMFI code.
- **Not designed:** dark mode, reimbursements.
