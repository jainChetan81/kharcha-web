# Kharcha design handoff

Source of truth for the UI rebuild of `kharcha-web`. Read this whole file before writing code.

- Canvas (visual reference): https://claude.ai/code/artifact/2342fd6d-ea07-4b0f-aa69-9b7d310a57b7
- Board sources: `docs/design/boards/*.dc.html`. Each file is one screen with inline styles. Read exact values (sizes, colours, spacing) from these files, not from screenshots.
- The boards run on a design runtime (`<x-dc>`, `<sc-for>`, `{{holes}}`). `boards/support.js` is a small stand-in written for this handoff so a board opens on its own: run `npx serve docs/design/boards` and open any `Name.dc.html` (opening the file straight from disk blocks the `<dc-import>` fetches). Do not copy it into the app. Port the markup to React components.
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
| Activity | Activity | `/activity?…` (filters in the address, §16) | `History`, filter screen `ActFilter`, `ActSort`, `ActDate`; `DeskHistory` |
| Plan | Plan | `/plan/budgets` · `/plan/recurring` · `/plan/trips` · `/plan/owed` | `Budgets` `Recurring` `Trips` `RbList`, `DeskPlan` `DeskOwed` |
| Wealth | Wealth | `/wealth` | `Wealth`, `DeskWealth` |
| Insights | Insights | `/insights` | `Insights`, `DeskInsights` |
| header button | Ask | `/ask` | `Ask`, `DeskAsk` |
| gear on Today | Settings | `/settings` | `Settings` |

Detail and form routes:

| Route | Board |
|---|---|
| `/txn/$id` | `Detail` |
| `/txn/$id/edit` | `Edit` |
| `/txn/$id/receipt` | `RcCapture` → `RcReading` → `RcResult` (`RcLowConf`, `RcEdit`, `RcFailed`, `RcManual`), desktop `DeskReceipt` |
| `/txn/$id/reimburse` | `RbMark`, `RbItems` (sheet) |
| `/settings` | `Settings`, `SetModel`, `SetCatDelete`, `DeskSettings` (§18) |
| `/add` | `Add` |
| `/paste?text=` | `Paste` |
| `/plan/recurring/$id` and `/plan/recurring/new` | `Series` |
| `/plan/trips/$id` | `Trip` |
| `/plan/trips/new` | `TripStart` |
| `/wealth/$id` | `Fund` |
| `/wealth/new` and `/wealth/$id/edit` | `Holding` |

Sheets (Add, Edit, TripStart, receipt capture, Mark reimbursable) are bottom sheets on phones and dialogs at ≥600px.

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
  --color-input: #FFFFFF;      /* field fill */
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
  --color-earn-soft: #E2EFE6;  /* Reimbursed, Extra back tags */
  --color-over-soft: #F6E3DE;  /* Overdue tag */
  --color-on-over: #FFFFFF;    /* text on an over fill (swipe Delete) */

  --color-hero: #1C2230;       /* Today and Wealth hero; stays dark in dark mode */
  --color-on-hero: #F6F4EE;
  --color-on-hero-2: #A9AEBB;
  --color-on-hero-month: #F2C879;
  --color-on-hero-gain: #8FD1A8;
  --color-on-hero-pace: #8FA6CF;
  --color-on-hero-over: #F2A08C; /* over-budget figure on the hero: 7.7:1 */
  --color-raised: #FBFAF6;     /* selected segment */
  --color-track: #E6E2D7;      /* bar and ring tracks */
  --color-on-cat: #FFFFFF;     /* text on a category fill (treemap) */

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
  --color-cat-salary: #2D6B4A;   /* income categories: greens */
  --color-cat-refunds: #1F7A63;
  --color-cat-interest: #4B7432;
  --color-cat-other-income: #8A8576;

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
- **Type scale** (px): 11 tab labels and stat captions · 12 eyebrows, captions, tags · 13 meta lines and helper copy · 14 controls and chips · 15 rows and body · 16 inputs (stops iOS zoom) · 18 section headings · 22 sheet and dialog titles · 26 page titles (30 on desktop) · 34–64 hero figures in Newsreader. Chart labels may go to 10. Nothing else.
- **Fonts:** self-host with `@fontsource/newsreader`, `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono`. Weights used: Newsreader 400, 500 and 400 italic; Plex Sans 400, 500 and 600; Plex Mono 400.
- **Dark mode:** follows `prefers-color-scheme`, with a Light / Dark / System choice in Settings. Override the same names under `.dark`. Every pair below is measured: text 6:1 or better, `field` 3.9:1, categories 4.96:1 or better on `card`.

```css
.dark {
  --color-paper: #12151C;  --color-card: #191D26;  --color-sunken: #222733;
  --color-rule: #323848;   --color-hairline: #282E3B; --color-field: #737A8C;
  --color-input: #12151C;
  --color-ink: #ECE8DF;    --color-ink-2: #BFC2CC;  --color-ink-3: #A0A4B0;
  --color-brand: #9DB3DA;  --color-on-brand: #12151C; --color-brand-soft: #243149;
  --color-earn: #74C595;   --color-earn-soft: #1D3326;
  --color-over: #F08C76;   --color-over-soft: #3A1F1A; --color-on-over: #12151C;
  --color-watch: #C99A3A;  --color-watch-text: #E6B864; --color-watch-soft: #3A2F18;
  --color-cat-food: #E08A60; --color-cat-shopping: #B497D6; --color-cat-transport: #66AFD0;
  --color-cat-utilities: #D2AE55; --color-cat-entertainment: #DB86A2; --color-cat-home: #8CC487;
  --color-cat-health: #63BFB1; --color-cat-sports: #B2C46A; --color-cat-work: #A3ACBC;
  --color-cat-other: #8F8B80;
  --color-cat-salary: #74C595; --color-cat-refunds: #5FC4A6; --color-cat-interest: #A4C97E;
  --color-cat-other-income: #8F8B80;
  --color-hero: #232937; --color-raised: #363D4D; --color-track: #2A303D; --color-on-cat: #12151C;
}
```

  - Primary buttons use `ink` fill with `paper` text in both modes, so they invert in dark.
  - Drawn in dark: Today, Activity, Settings, receipt reading and reimbursements (the `…Dark` boards). Port the rest with the same tokens; no screen hard-codes a hex.
  - The hero stays dark in both modes (`hero` lifts to #232937 in dark so it separates from the page).

## 4. Formatting (`src/lib/format.ts`, unit-tested)

- **Money:** `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })` → `₹1,23,450`, `₹219.50`. Without the minimum, the default prints `.00`.
- **Compact:** `notation: "compact"` → `₹1.6L`, `₹18.1K`. Only on chart labels and amount filter chips (`₹500–5K`). Everywhere else, full Indian grouping.
- **Signs:** income and gains get `+` in `earn`. Expenses carry no sign. Over budget is written in words: `₹3,088 over`.
- **Foreign currency:** `$12.99 · ₹1,143`.
- **Dates and times:** `Thu 15 Oct`, `15 Oct, 2:44 PM`, `2:44 PM`, `24 Sept` (four-letter September, as `en-IN` prints it). Always 12-hour: `hour: "numeric", minute: "2-digit", hour12: true`. Raw SMS text keeps what the bank sent.
- **Prices:** always dated: `NAVs of 15 Oct`.
- **Cards:** `••2047`.

## 5. Components (`src/components/`)

| Component | Notes |
|---|---|
| `AppShell` | Mobile: `TabBar` (`calc(50px + env(safe-area-inset-bottom))`, so 84px on a phone with a home indicator; 5 tabs; active tab gets a 2px top rule) plus `Fab` (56px, radius 16, 16px above the tab bar). ≥840px: `Sidebar` (240px), with the trip card when a trip is upcoming or active, then the sync pill and Settings. Desktop pages use a main column plus a 300px right rail; Plan tabs keep that column even when it is empty, so all four share one width. |
| `MonthStepper`, `SyncPill`, `SyncNow`, `StatusTag` | Pill and Sync now states: §18. Month stepper: §16. |
| `InkHero` | Today and Wealth only. |
| `PaceChart`, `GainChart`, `Waterfall`, `DayRings`, `Beeswarm`, `Treemap`, `Sparkline`, `BudgetBar` | Plain SVG or CSS. Rules are on the Style board, §6. |
| `LedgerRow`, `DayHeader` | 56px rows, day total under a 1px ink rule. |
| `Chip`, `FilterChip`, `Segmented`, `Switch`, `Field` | Built on shadcn. Borders use `field`. 44px tall on phones. A chip or option sits on `card` when the page behind is `paper`, and on `input` when it is inside a card or sheet. **Selected, everywhere:** `brand` fill, `on-brand` text. The only other selected look is the segmented control (`raised` on `sunken`). A switch's whole row toggles it, so the 28px switch is not the target. |
| `Sheet`, `Snackbar` | shadcn Sheet/Drawer and Sonner, restyled and animated with `motion`. |
| `TxnForm` | One component with `mode="add" \| "edit"`. **Add:** keypad first, expressions like `450+120`. **Edit:** amount field, a "Not a spend" switch, Delete, and a note when the merchant was renamed. |
| `DigestCard`, `InsightCard`, `AnswerCard`, `AiUnavailable` | Provenance lines stay visible. |
| `TripBand`, `RuleRow`, `CategoryRow` | |
| `ItemRow` | Receipt line: name, qty, amount, `CategoryChip`. Unsure state: `watch-soft` fill and a "?" mark. Selectable in edit mode. Swipe reveals Delete (`over` fill, `on-over` text). |
| `CategoryChip` | Category dot + name, 36px tall, `field` border. Tap opens the category list inline. Selected: `brand` fill. |
| `SplitBar` | Stacked category segments, 2px gaps, legend below. Large (10px) on Result and Detail, small (4px) inside a ledger row. `role="img"` with the split in the label. |
| `ReconcileLine` | Items total vs bank amount. Match: `earn` tick. Gap: `watch-text` with "Add as adjustment". |
| `ReimbursableBadge` | U-turn arrow + "₹1,200 back" in `brand`. On ledger rows next to the amount. |
| `StatusTag` (extended) | 12px, weight 600, radius 999. Pending (`brand-soft` / `brand`), Partly back (`watch-soft` / `watch-text`), Reimbursed and Extra back (`earn-soft` / `earn`), Overdue (`over-soft` / `over`), Cancelled (`sunken` / `ink-2`, struck amount). |
| `ShareLedger` | Three lines: Paid, Back from X, Yours. Used on Mark reimbursable, Status and Plan › Owed. |

All of these are on the `RcComponents` board in light and dark.

| Activity and Settings | Notes (`ActComponents`, `PtrStates` boards) |
|---|---|
| `FilterPill` | 36px pill inside a 44px target. `Filter` (icon; `brand` fill and a count when anything is set), `Sort`, quick pills (Category, Card, Type with ▾), the Needs review toggle, and applied pills (`brand` fill, value and ×). One row, scrolls sideways, fade on the right edge. |
| `AppliedChip` | Inside the filter screen and above the desktop table: `brand-soft` pill with the value and ×. |
| `FilterScreen` | Phones: full screen. Header ✕, "Filters", Clear all; selected chips under it; left rail of filter types (124px, `sunken`; active one on `card` with a 3px `brand` bar; a count when set); options on the right; sticky "Show N transactions" (N live on Activity and Insights; "1 transaction" when one; "Show results" while N loads or fails). Desktop: `FilterRail`, a 248px card beside the table with sections that open and close, live updates, Clear all and a hide button. |
| `RangeCalendar` | Opened from Date › Custom range › Pick on a calendar (`ActDate`). Week starts Monday. Tap start, then end. Start and end filled `brand`, days between on a `brand-soft` band, today ringed, days after today muted. The From and To date fields in the Date pane are the fallback. |
| `SummaryStrip` | Collapsed: one row of stats (count, spent, income, transferred; zero figures hidden except spent). Expanded: net, top 4 categories, biggest, most frequent, avg/day, See insights. |
| `TxnRow` | Line 1 merchant (+ review dot). Line 2 time · category dot and name (or `Card bill` / `Transfer` tag, or split bar + categories) · card. Card bills and transfers: amount in `ink-3`, weight 400, never struck through. |
| `SwipeRow` | §19. |
| `PullToRefresh` | 36px ring: pulling (ring fills with distance), past threshold (arrow flips), refreshing (spinning arc), done (tick, "Up to date · N new"), failed (`over`), offline. |
| `SwatchPicker` | 7-column grid of 44px targets, 28px swatches, selected has a 2px ink ring and a tick. Category and income colours only; no free hex. |
| `ModelSelect` | Combobox: name, provider, rough cost per call; search filters presets. |
| `Segmented` | `sunken` track, selected segment on `raised`. Used for Theme and Daily cap. |

## 6. Screens

Every list screen needs an empty state (one line plus one action), a loading skeleton, and an error state with retry.

- **Today** (§17)
  - Ink hero: spend, budget state, pace chart.
  - Gear (Settings) and Ask in the header.
  - Trip band, when a trip is upcoming within 7 days or active.
  - Digest card.
  - Next 10 days of recurring payments.
  - Review strip.
  - Treemap.
  - Wealth card: value, gain, next SIP, allocation bar with a legend, NAV date.
  - Recent rows.
- **Review**
  - Mobile: card deck. Right confirms, left skips. Not a spend, Duplicate, Edit (`/txn/$id/edit`). An "Always file X as Y" checkbox creates a rule.
  - Desktop: table plus detail pane, with J/K/X/R/C/E shortcuts and bulk confirm.
  - Nothing to review: tick, "Nothing to review", Open Activity and Back to Today (`ReviewEmpty`, `DeskReviewEmpty`).
- **Activity:** §16.
- **Detail**
  - Amount, fields, source SMS, rename note, receipt entry, more rows from this merchant.
  - Mark reimbursable, Not a spend, Delete. Edit opens `Edit`.
  - With a split: "Expense · split in N", `SplitBar`, item groups by category, receipt thumbnails, Remove split (`RcSaved`).
  - With a claim: header reads "₹3,000 paid · ₹1,800 yours" and the claim card sits under the amount (`RbStatus`).
- **Add and Edit on desktop:** a centred dialog over the page, never the phone keypad (`DeskAdd`, `DeskEdit`). Type segment, Merchant, Amount (accepts `250+210` and shows `= ₹460`), category chips, Date, Card, Not a spend. Esc cancels, Enter saves. Edit adds the source line ("From SMS · 18 Oct, 7:47 PM") and Delete.
- **Edit:** `TxnForm` in edit mode, prefilled. Delete asks once, then shows an undo snackbar.
- **Receipt reading:** §14.
- **Reimbursements:** §15.
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
  - Ink hero: value, day change with NAV date, invested / gain / XIRR, GainChart (1Y/2Y/All). Holdings with only a statement value show "Statement of 9 Oct · not live"; XIRR stays — until real buys exist.
  - Allocation vs target.
  - Holdings rows open `Fund`.
  - Add holding, Import CSV.
  - NPS financial-year cap tracker.
  - SIPs: planned mandates (`sip_mandates`), one row per mandate (fund, "Day 20 · next 20 Oct", amount), sorted by next date. Planned dates only, never shown as paid. "Bank mandate not checked" in watch text when the mandate is unseen. Footer: "Mandates as seen 11 Oct. Planned dates, not confirmed debits."
- **Holding** (add or edit)
  - Kind: Fund, NPS, Gold, Other.
  - **Fund and Gold:** search by name, results show the AMFI code and current NAV.
  - **NPS and Other:** name plus a value you type in.
  - SIP amount and day, an "SMS contains" match with a live count of matching past debits, target %.
  - CSV import (`date, fund, amount, units, nav`) with a preview and an error count.
- **Fund:** value, NAV line with SIP buys and average cost, stats, SIP mandates, instalments. No NAV history hides the chart.
- **Insights**
  - Filter bar under the title, the same `FilterPill` row as Activity: Filter, the month, Category, Card, Type, Trip. Ask from Insights carries the filters.
  - KPI tiles.
  - Worth-a-look cards (dismissable).
  - Fig. 1 waterfall, Fig. 2 day rings, Fig. 3 beeswarm, Fig. 4 six months.
  - Table 1: top merchants.
- **Ask:** thread of AnswerCards, follow-ups, input, privacy line.
- **Settings:** §18.
- **Offline:** one line, "Can't reach your server right now.", and Retry. Nothing else.

**Desktop** (boards exist for all of these):

| Page | Main | Right rail |
|---|---|---|
| Today | ink hero + pace, then review / next 10 days / wealth, treemap, recent | digest card next to the hero |
| Review | table | detail pane for the selected row |
| Activity | filter rail (248px, can hide) beside the table; above the table: count, applied chips, Clear all, Sort | detail drawer (380px) over the page when a row is picked |
| Settings | one 680px column of the same sections; Categories and Merchant rules open centred dialogs (`DeskSetCategories`, `DeskSetRules`) | — |
| Plan | segmented Budgets/Recurring/Trips/Owed; budgets table (category, spent, limit, pace bar, status, edit) | trip card, next 10 days, "Other has no budget" |
| Plan › Owed | KPI row (owed, overdue, oldest, back this month); table (date, spend, from, paid, yours, due, status) | owed by person, credits that might match |
| Receipt | photo viewer (hovered row highlights its line on the image) and items table side by side | — |
| Wealth | ink hero with wide GainChart; holdings table with XIRR bars | Add holding / Import CSV, allocation vs target, NPS cap, SIPs schedule, price sources with dates |
| Insights | filter bar; KPI row; Fig. 1 + Fig. 2 side by side; Fig. 3 full width | worth-a-look cards, top merchants |
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
  - `manual_invested`: statement cost basis paired with `manual_value`, used until `holding_txns` exist.
- **`sip_mandates`**: `source_key` (unique, hashed broker identity), `holding_id`, `amount`, `day`, `next_date`, `note`, `observed_on`. Loaded from a statement on the server; never creates buys or clears debits.
- **`holding_txns`**: `id`, `holding_id`, `transaction_id`, `date`, `amount`, `units`, `nav`, `source` (sms/csv/manual).
- **`prices`**: `scheme_code`, `date`, `nav`, `source` (mfapi/amfi). Primary key on `scheme_code` and `date`.
- **`attachments`**, **`transaction_items`**, **`transaction_splits`**: §14.
- **`reimbursements`**, **`reimbursement_links`**: §15.
- **`insights`**: `detector`, `key`, `payload_json`, `dismissed_at`.
- **`digests`**: `week_start`, `facts_json`, `text`, `model`.

Run `npm run db:generate` after each schema edit. Extend `scripts/check-db.ts` with these checks: unknown category maps to Other, rules apply on ingest, trip auto-tag, splits sum, your share never below zero.

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
2. **Receipts:** text only. The server runs `tesseract` on each image, drops payment lines and redacts card, account, phone, UPI and email, then makes one text call per transaction. Images never leave the server; no OCR text means `unreadable`, never an image fallback. Output is validated with zod (§14). The receipt is always read from a transaction's Detail, so there is no matching step.
3. **Never send** raw SMS, card numbers or UPI IDs.
4. **Config** lives in `meta` and is editable in Settings: `openrouter_model`, `openrouter_daily_cap`.
5. **Unavailable** (cap reached, OpenRouter down, or AI off):
   - Ask: "AI is unavailable right now. Filters still work."
   - Receipt: see `RcFailed` and `RcManual`.
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
- **Sync pill** reads `/api/health` (states in §18):
  - `Mini online · checked N min ago`, `Mini offline since 6:10 PM`, `Mini quiet · N h` (online, but no new row for 6 hours).
  - `Offline`: `navigator.onLine` is false.
  - `Server unreachable`: online, but the health check fails.
- **Installed:** `matchMedia('(display-mode: standalone)')` or `navigator.standalone` on iOS. Settings shows "Installed ✓" and no instructions.
- **Pull to refresh:** Today, Activity, Detail and the Plan lists. It refetches from the VPS; it does not ask the mini (Sync now does).
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
- Targets: 44px on phones; 36px minimum for desktop buttons. Inline text links on desktop may be shorter. Measured on every board.
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
| Login (auth) | Ask, receipt reading and the weekly digest are off until it exists. Settings shows one quiet line. | deferred, §13 |
| kharcha-mini fix for "Unknown ₹0" rows | clean Activity and Review | kharcha-mini, in parallel |
| kharcha-mini polls `/api/mini/poll` every 30 s | Sync now, mini online/offline | kharcha-mini |

## 13. Open items

- **Auth:** deferred to the ChatGPT connector work. Until then, `KHARCHA_AUTH=off` stays as it is, and Ask and Receipts stay disabled behind `KHARCHA_AI=off`.
- **"Unknown ₹0" rows:** skipped SMS leaking through as transactions. Fix in kharcha-mini (do not push non-transactions). This runs in parallel.
- **NPS:** NAVs are not in AMFI data, so mfapi does not have them. NPS stays a typed-in value unless you hold it through a fund that has an AMFI code.
- **Offline and receipts:** the brief says "reading works but saving is disabled". Reading needs the server, so the boards treat "reading" as viewing saved items and photos. Read and Save are disabled offline. Confirm before building.
- **Reimbursement sync:** reimbursements are typed in. Nothing arrives from an office expense tool.
- **Sync now needs a second mini change.** The VPS cannot call the mini, so the mini polls for a sync request (§18). Without it, drop the button and keep the pill.
- **Summary strip format:** the brief shows one text line with `₹1.6L`. At 390px that line truncates, and the rules allow compact amounts on charts only. The boards use one row of stats with full figures instead.
- **Month stepper placement:** it sits in the Activity header, not in the scrolling chip row, so the month stays visible.
- **Model costs** in Settings are estimates from OpenRouter prices × a typical call (§18). The figures on the boards are placeholders.
- **Sample "today"** on every board is Thu 15 Oct 2026.

## 14. Receipt reading

Read a receipt into items, give each item a category, and split the transaction by category. Boards: `RcCapture`, `RcCrop`, `RcReading`, `RcResult`, `RcLowConf`, `RcEdit`, `RcFailed`, `RcManual`, `RcSaved`, `DeskReceipt`, `RcComponents`, and a `…Dark` board for each.

**Flow**

1. **Capture** (`RcCapture`). Detail → Add receipt opens a sheet. Camera, Gallery, Files. Up to 5 images per transaction, treated as one order. Thumbnails can be removed. Privacy line above the buttons.
   - **Crop** (`RcCrop`): every picked photo opens a crop and rotate step before it joins the strip. Drag the corners or edges; Rotate turns 90°; Reset restores the full frame. "Only the part inside the frame is uploaded." Cropping happens on the device (canvas), so the cut-off part never leaves it. Strip EXIF before upload. Retake goes back; Use photo adds it.
2. **Reading** (`RcReading`). Per-image progress and skeleton rows. 5–15 seconds. The user can leave: the job runs on the server and the items appear on the transaction.
3. **Result** (`RcResult`). Items with qty, amount and `CategoryChip`. Above them, the `SplitBar` and per-category subtotals. Below, the `ReconcileLine`.
   - Items total equals the bank amount: match tick, Save split.
   - Gap (coupon, delivery fee, rounding): "Add as adjustment" adds one line for the gap to the largest category. The user can change its category.
4. **Low confidence** (`RcLowConf`). Lines under the confidence threshold get a "?" and a `watch-soft` fill. A banner counts them. Tap a line to fix name, qty or amount inline; "Looks right" clears the flag. Save stays enabled and reads "Save anyway" while flags remain.
5. **Edit** (`RcEdit`). Select lines, then Merge (sums amounts, keeps the first name) or Delete. Swipe a line to delete it, with undo. Add a missed item: name, amount, category.
6. **Failed** (`RcFailed`). Three causes with one line each: unreadable, not a receipt, AI busy or over the daily cap. Primary action "Enter items by hand" opens `RcManual`. Retry stays available. The images are kept.
7. **AI off** (`RcManual`). Same screen as Result with manual rows only, and one quiet line: "Receipt reading is off on this server. Add items by hand." Photos can still be attached. Un-itemised money stays in the transaction's own category ("₹X not itemised · Stays in Food").
8. **Saved** (`RcSaved`, `ActFiltered`). Detail shows the split bar and item groups. Activity filtered by a category shows only that category's part of a split row ("₹210 of ₹2,340"), with a small split bar. Remove split puts the full amount back in one category.

**Rules**

- A split is saved only when splits sum to the transaction amount. Adjustment lines make that true.
- Budgets, Insights and Activity totals use splits when they exist.
- Editing the transaction amount after a split asks to re-check the split.
- **Privacy line**, on receipt capture: "Photos stay on your server. Kharcha reads the text there, removes card, account and UPI numbers, and sends only the remaining text to the AI service."
- **Offline:** saved items and photos are viewable. Read, Save, Merge and Delete are disabled, with the standard offline line from §9. See §13 on this reading of the brief.
- **Empty:** a transaction without a receipt shows only the Add receipt entry on Detail.

**Data**

- **`attachments`**: `id`, `transaction_id`, `path`, `mime`, `bytes`, `created_at`. Files live on the VPS disk, outside `public/`, served only through a server function.
- **`receipt_jobs`**: `id`, `transaction_id`, `status` (queued/reading/done/failed), `error` (unreadable/not_receipt/ai_unavailable), `model`, `started_at`, `finished_at`.
- **`transaction_items`**: `id`, `transaction_id`, `name`, `qty`, `amount`, `category`, `confidence` (0–1), `source` (ai/manual/adjustment), `sort_order`.
- **`transaction_splits`**: `transaction_id`, `category`, `amount`. Derived from items on save. Unique on `transaction_id` and `category`.
- **Model output schema:** `{ items: [{ name, qty, amount, confidence }], total, currency, isReceipt }`. Categories are assigned on the server from merchant rules and item names, then by the model only when no rule fits.

## 15. Reimbursements

Mark part or all of a spend as money coming back, track it until it does, and count only your share. Boards: `RbMark`, `RbStatus`, `RbShare`, `RbList`, `RbItems`, `RbCases`, `DeskOwed`, and a `…Dark` board for each.

**Mark** (`RbMark`, `RbItems`)

- From Detail → Mark reimbursable. Sheet with Full, Part, or Items.
  - **Part:** amount field with one quick chip, Half. The amount is all it sets: one claim, one counterparty. No splitting between several people, no contacts, no invites.
  - **Items:** only when the transaction has receipt items. Tick the items; the amount is their sum (`RbItems`).
- **From:** Office, or a person. Recent names are chips. Free text for a new one.
- Optional note.
- `ShareLedger` updates live: Paid, Back from X, Yours.

**Status** (`RbStatus`)

- Pending → Partly back → Reimbursed. Cancelled at any point.
- **Link a credit:** incoming transactions can be linked to a claim, in full or part. Suggestions rank credits by amount, date after the spend, and sender name matching From. Start with amount within 10% and date within 45 days; tune these on real data.
- **Extra back:** linked credits exceed the claim. The excess counts as income in the month it arrived.
- **Mark fully paid** closes a claim without a linked credit (cash, adjusted salary).
- Unlinking a credit or undoing Cancel moves the status back.

**Totals** (`RbShare`)

- Budgets, Today's spend, Insights and Activity day totals count **your share**: amount minus the open or settled claim.
- Ledger rows show "₹1,800 yours · ₹3,000 paid" and the `ReimbursableBadge`.
- Budget bars hatch the reimbursable part and do not count it.
- **Cancelled:** the full amount counts again.
- **Split + reimbursable:** the claim comes off the categories of the chosen items only.

**Plan › Owed** (`RbList`, mobile; `DeskOwed`, desktop)

- Header: total owed to you, by person.
- Pending / Done toggle. Pending rows sort by age. Overdue after 30 days: `over-soft` tag with "Overdue · N days".
- Done shows Reimbursed, Extra back and Cancelled.
- **Empty:** "Nothing owed to you." with "Mark a transaction" (opens Activity).
- **Offline:** list is viewable. Mark, Link, Cancel and Mark fully paid are disabled.

**Data**

- **`reimbursements`**: `id`, `transaction_id`, `amount`, `counterparty`, `note`, `status` (pending/partly/reimbursed/extra/cancelled), `item_ids` (json, nullable), `created_at`, `closed_at`.
- **`reimbursement_links`**: `reimbursement_id`, `credit_transaction_id`, `amount`. A credit can be split across claims; the sum of its links never exceeds the credit.
- `status` is derived from links on every write, never set by hand, except `cancelled` and a manual "fully paid".
- Linked credits are excluded from income, except the extra part.
- Your share = `amount − sum(open and settled claims)`, never below zero.

## 16. Activity

Boards: `History`, `ActFiltered` (filters applied, summary open), `ActCustomRange`, `ActFilter` (category), `ActFilterDate`, `ActFilterAmountError`, `ActSort`, `ActDate` (custom range calendar), `DeskHistory`, `DeskHistoryDetail`, `DeskHistoryNoRail`, with `…Dark` boards.

The model is Spinny's listing page: filters are rarely changed, so they cost one row on the list and live on their own screen.

**Header:** title, a search icon, and the `MonthStepper` chip ("October 2026", ‹ ›).
- The search icon swaps the header for a search field with Cancel. Search is not a filter pill.
- A range other than a whole month replaces the chip with the range ("12–14 Oct"), drops ‹ ›, and adds an applied pill (`ActCustomRange`). This month, Last month, removing that pill, or Clear all bring ‹ › back.

**Filter bar:** one row, sticky under the header while the list scrolls.
- `Filter` (with a count) · `Sort` · divider · applied pills, newest first, each with × · quick pills for what is not applied yet: Category, Card, Type, Needs review · `Clear all` once anything is set.
- Quick pills open the filter screen on that filter. Needs review toggles in place.
- No second row of chips: applied filters live in the same row, so the list starts higher.

**Filter screen** (`ActFilter`), full screen:
- Left rail: Sort, Date, Category, Card, Type, Trip, Amount, Status. A count shows on each one that is set.
- Right pane: the options for the selected filter, as 48px rows with a checkbox (multi) or radio (single). Category has a search field and Spending and Income groups with colour dots and counts.
- **Date:** Today, This week, Last 7 days, This month, Last month, This year, Custom range. Custom shows From and To fields and "Pick on a calendar" (`ActDate`).
- **Amount:** Under ₹500, ₹500–5K, ₹5K–25K, Over ₹25K, Custom with min and max. Min above max shows the error inline and disables Show (`ActFilterAmountError`).
- **Status:** Needs review, Has a receipt, Split, Reimbursable.
- Selected chips sit under the header, each removable. Clear all resets to This month, Newest first.
- Changes apply when you tap "Show N transactions"; N updates live. Closing with ✕ discards them.
- **Sort** also has a small sheet (`ActSort`) from the bar's Sort pill.

**State lives in the address**, so back, reload and shared links keep it: `/activity?from=2026-10-12&to=2026-10-14&cat=food,health&card=2047&type=expense&trip=odisha&min=100&max=2000&status=review&sort=amount-desc`. No saved filters.

**Summary strip:** under the filter bar; covers exactly the rows the filters select, from one SQL query with the same `WHERE`. No raw codes such as `2026-10`.

**Rows:** 12-hour time; category dot and name (Other stays `field` grey); card. Card bills (CRED, "HDFC Credit Card" payments) and self transfers: muted amount and a `Card bill` or `Transfer` tag. The first time one shows, a dismissable line under it: "Not counted as spend; the purchases already are." Split rows show the mini split bar and the first two categories ("Food, Shopping +2"). Reimbursable rows: see §15.

**Desktop** (`DeskHistory`):
- Header: title, search (`/` focuses it), month stepper.
- Left of the table, the `FilterRail`: the same filters as sections that open and close, each showing its value when closed ("Food", "Any"). Changes apply live; no Show button. The rail can hide; then a `Filters · n` pill appears in the toolbar (`DeskHistoryNoRail`).
- Above the table: result count, applied chips with ×, Clear all, and a Sort select.
- Picking a row opens a 380px detail drawer over the right side (`DeskHistoryDetail`); Esc or ✕ closes it.

**States:** empty filter result: "Nothing matches these filters." with Clear all. Error: "Couldn't load transactions." with Retry. Offline: rows already loaded stay visible; filters still work on them; Delete and swipe are disabled.

## 17. Today

Boards: `Main`, `MainDark`, `TodayHero` (four budget states, light and dark), `TodaySpec`, `DeskHome`, `DeskHomeNoBudget`, each desktop one with a dark board.

- **Budget states:** none (spend and "Set a monthly budget", no pace line, no "over"), under (`on-hero-gain` "₹18,760 left"), near (`on-hero-month` when 90% or more is spent), over (`on-hero-over` "₹3,120 over"). The hero never shows "of ₹0".
- **Spacing:** 24px between every block. Scroll content ends with `calc(138px + env(safe-area-inset-bottom))` bottom padding: 50 tab bar + 16 + 56 add button + 16, plus the safe area. The boards draw a 34px safe area, so 172px. The add button sits at `calc(66px + env(safe-area-inset-bottom))` from the bottom (100px on the boards). This applies to every screen with the add button (Today, Activity).
- **Tab bar:** `height: calc(50px + env(safe-area-inset-bottom))`, `padding-bottom: env(safe-area-inset-bottom)`. No fixed extra padding on top, which caused the empty band in the installed app. `viewport-fit=cover` in the viewport meta.
- **Chart labels:** see `TodaySpec`. Try the right of the spike, then the left. Never over the today dot or its label, never past the chart edge, always above the line. Still no room: shorten the amount (₹18.1K), then drop the merchant.
- **Review card:** "115 to review · ₹26,240 in Other". The Other figure and the Other tile read the same query: this month's Other spend, excluding card bills and transfers.

## 18. Settings

Boards: `Settings` (AI on, installed, mini online), `SettingsOff` (AI off, not installed, mini offline), `SetModel`, `SetCategories`, `SetCategoriesPicker`, `SetCatDelete`, `SetRules`, `DeskSettings`, `DeskSetCategories`, `DeskSetRules`, each with a dark board.

- **Sync:** Mac mini row with the pill state; "Last new transaction 2 h ago" as its own row. **Sync now:** requested ("Asked the mini to check for new SMS.") → waiting ("Usually under a minute.") → synced ("Synced · 3 new transactions") or mini offline ("The mini is offline. Sync runs when it's back.").
  - Server: `POST /api/sync` stores a request. The mini calls `GET /api/mini/poll` every 30 s; the call records `last_seen_at` and returns any request. Online = seen in the last 2 minutes. "Offline since" = `last_seen_at`. "Last new transaction" = newest ingested row.
- **App:** Install (Installed ✓, or Install plus the iPhone line when not installed), Theme (Light / Dark / System), Export CSV, Sign out.
- **AI off:** one quiet card: "AI is off. Ask, the weekly digest and receipt reading need the server switch." Nothing else in the section.
- **AI on:** Model (`ModelSelect` with presets: name, provider, rough cost), Daily call cap (50 / 100 / 200 / 500), usage bar "12 of 200 used today".
  - Cost per call = OpenRouter `/api/v1/models` prompt and completion prices × a typical call (1,500 tokens in, 300 out) × the day's USD→INR rate. Recompute daily; show "about".
- **Data:** two rows, "Categories 14 ›" and "Merchant rules 23 ›". Each opens a sheet on phone and a centred dialog on desktop. The lists stay off the page.
- **Categories** (sheet): Add in the header; Spending and Income groups; per row: drag handle, colour swatch (opens `SwatchPicker`), name in an editable field (dashed underline), "412 transactions", delete. Other and Other income cannot be deleted.
  - Delete asks first (`SetCatDelete`): "Its 9 transactions move to Other. Its budget and 1 merchant rule are removed."
- **Merchant rules** (sheet): search field, then rows: raw match in mono, clean name, category dot, edit.

## 19. Motion

Use `motion` springs. Every animation is off under `prefers-reduced-motion: reduce`; state changes then happen instantly.

| Element | Spec |
|---|---|
| Sheets | Enter: spring, stiffness 400, damping 36 (no visible bounce). Drag down to close past 30% or a fast flick. Scrim fades 0 → 45%. |
| Popovers (desktop) | 120 ms fade and 4px rise. Esc closes and returns focus to the chip. |
| Summary strip | Height animates with a spring; chevron turns 180° with stiffness 500, damping 18 (one small overshoot). |
| Swipe to delete | Delete is hidden at rest. While dragging, it fades in and scales from 0.8 to 1 over the first 88px. Release past 44px: springs open to 88px with about 6% overshoot (stiffness 500, damping 22). Beyond 88px the row follows at ⅓ of the finger. Release under 44px: springs shut. A full swipe past 60% of the width deletes, with an undo snackbar. |
| Pull to refresh | Threshold 72px. The ring fills with distance; past the threshold the arrow flips and a light haptic fires where supported. The list holds at 56px while refreshing, then springs back. Done or failed shows for 1.2 s. |
| Filter chips | Press scales to 0.96. A chip that gains a value cross-fades its label. |

## 20. AI look

AI gets one mark and one fill, used only where AI acts. Boards: `ActComponents` (AI section), `Main`, `DeskHome`, `Ask`, `DeskAsk`, `Insights`, `DeskInsights`, `Settings`.

- **Spark:** a four-point star with a small companion star. Filled with the AI fill below, or white on the AI fill.
- **AI fill:** `linear-gradient(120deg, #34508A, #5B3FC4 50%, #8A3FA8)`, white text (6.3:1 or better at every stop), soft `ai-glow` shadow. It is the same in both modes.
- **Ask button:** a pill with the AI fill, spark and "Ask"; on desktop it shows the `/` shortcut. The fill drifts slowly (`ai-shift`, 6 s, alternate). Reduced motion stops it.
- **Insights:** the tab bar and sidebar icons carry the spark. Insight cards stay plain: their numbers come from SQL, not the model.
- **AI-written content:** the weekly digest gets a 4px AI strip on top and a "Written by AI" tag; Ask answers get a gradient edge (4px on top, 1px elsewhere). "Ask a follow-up" uses `ai-text`.
- **Settings › AI:** the section title carries the spark.
- **Tokens:** the fill stops are fixed in `.ai-button` (same in both modes); `ai-text` light `#5B3FC4` (6.8:1 on card), dark `#B9A6F7` (7.9:1); `ai-glow` light `rgba(91,63,196,.38)`, dark `rgba(150,120,255,.42)`.


## 21. Live audit, 19 Oct 2026

Checked kharcha.chetan-vps.tech at 1512px, 1200px and 390px against the canvas. The canvas now holds only current boards, grouped by area (phone row, then desktop row) with every dark board in one section at the end.

**Taken from live into the boards:** Today wealth card (allocation bar, next SIP), Wealth SIPs schedule, Settings › Data sheets and Sign out, the Insights filter scope, desktop Add/Edit dialog, Review empty state.

**Bugs on live** (the boards are already right):

| Where | What is wrong | Fix |
|---|---|---|
| Sidebar, every desktop page | Sync pill truncates: "last new 16 h ag" | Pill reads "Mini online · 3 min ago". "Last new" lives in Settings › Sync |
| Today hero, 1200px | Month wraps to two lines; sync pill overlaps the chevrons | `DeskHome` header: month stepper left, Ask and Add right; no pill in the hero |
| Activity table, desktop | Time wraps ("7:47 / PM") | `white-space: nowrap` and a fixed time column (`DeskHistory`) |
| Activity date dialog, Merchant rules dialog | See-through surface; the page shows through | Solid `--card` surface over `--scrim` |
| Add, desktop | Phone keypad in a modal; a control shows under Save | `DeskAdd` |
| Edit | "From SMS · 2026-10-18" | "From SMS · 18 Oct, 7:47 PM" (`format.ts`) |
| Wealth hero | "−₹71,217 gain" | "−₹71,217 · −4.5%" under a "Gain" label |
| Ask answer | "Based on 1 transactions"; "SCOPE NOT RECORDED" in the meta line | Plural rule; omit the scope when it is missing |
| Detail | "Parsed by regex" on phone, "Regex" on desktop | One casing: "Regex" |
| Digest | "of your total layout"; "Keep it up with 0 rows waiting" | Prompt: say "spend"; drop the review line at 0 |
| Plan tabs | Empty states show a link and a button for the same action; empty "Coming up" card; Trips is full width, the others two-thirds | One action per empty state; hide empty cards; one column width |
| Review | Bare "Nothing needs review." | `ReviewEmpty`, `DeskReviewEmpty` |
| Activity and Insights, phone | Filter chips wrap to three rows | One-row filter bar plus the filter screen (§16) |
| Settings, phone | First paint shows "Not seen yet · Loading" | Render mini status on the server |
| Ask buttons | Dark pill on Insights, white pill on Today | Gradient Ask pill everywhere (§20) |
| Sidebar | No review count | Count beside Review |
| Merchants | "Flipkar" from the SMS shows up in the digest and links | Merchant rename (Detail rename note) applies before the digest runs |

**Open choices** (live and boards differ on purpose; decide before building):

- **Wealth freshness.** Decided: statements. Keep "Statement of 9 Oct · not live" and XIRR "—" until a NAV job exists; the boards' daily-NAV hero is the later state.
- **Where it went on phone.** Live shows a list; the boards show the treemap used on desktop.
