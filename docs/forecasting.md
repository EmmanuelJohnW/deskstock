# Stockout Forecasting

DeskStock predicts when each component will run out and warns the lab custodian before it happens, instead of only reporting stock that is already low.

This document covers:

1. [What's new](#1-whats-new)
2. [Using it (for lab custodians)](#2-using-it-for-lab-custodians)
3. [How the forecast is calculated](#3-how-the-forecast-is-calculated)
4. [Consumable vs returnable components](#4-consumable-vs-returnable-components)
5. [Setup and deployment](#5-setup-and-deployment)
6. [Testing](#6-testing)
7. [Technical reference (for developers)](#7-technical-reference-for-developers)
8. [Known limitations](#8-known-limitations)

---

## 1. What's new

| Feature | Where | What it does |
|---|---|---|
| **Forecast page** | Nav bar → **Forecast** (`/forecast`) | One card per component: average daily usage, estimated days remaining, predicted stockout date, reorder-by date and a suggested order quantity. |
| **Alert banner** | Under the nav bar on every page (except Forecast) | Names the components that may run out soon, with days left, and links to the Forecast page. |
| **Alert badge** | Nav bar, next to the inventory dropdown | ⚠ with the number of components at risk. Red if anything is out of stock or critical, orange otherwise. |
| **Consumable flag** | Components page → **Consumable** checkbox | Marks parts that get used up (resistors, wire, LEDs) rather than returned (meters, boards). Changes how restocks and the forecast treat them. |
| **Demo inventory** | `scripts/seed-forecast-demo.mjs` | Creates a "Forecast Demo" inventory with 30 days of sample history, for demonstrations. |

How this maps to the feature brief:

| Brief | How DeskStock does it |
|---|---|
| Step 1: Smart weight detection | The existing ESP32 sorter weighs each part with the HX711 load cell and identifies it by weight. **No device changes were needed.** |
| Step 2: Automatic inventory update | Sort runs update stock through count sessions and reconciliation, as before. Borrows, returns and restocks are recorded in the same stock history (`inventory_ledger`). |
| Step 3: Usage pattern analysis | Average daily usage over the last 30 days, from borrows, returns and count shortfalls. |
| Step 4: Predictive forecasting | Days remaining = current stock ÷ average daily usage, plus a stockout date, reorder-by date and suggested quantity. |
| Step 5: Early warning notification | Alert banner and badge on every page, and the Forecast page itself. |

---

## 2. Using it (for lab custodians)

### Reading a forecast card

```
Resistor 10kΩ  (Consumable)                               [Monitor]
15 days ago: 200 pcs · Now: 50 pcs
────────────────────────────────────────────────────────────────────
Average daily usage            Estimated days remaining
10 pcs                         5 days

  Predicted stockout
  Expected to run out around Oct 15, 2026 if usage continues at the
  current rate. Reorder by Oct 12, 2026 to avoid a shortage. About
  250 pcs would cover the next 30 days.
```

- **"15 days ago: 200 pcs · Now: 50 pcs"**: stock at the start of the period the forecast is based on (up to 30 days), and now.
- **Average daily usage**: how many pieces are used up per day, on average.
- **Estimated days remaining**: how long current stock lasts at that rate.
- **Predicted stockout box**: only shown when the component needs attention.

### Statuses

Cards are sorted most urgent first.

| Status | Meaning | Counts as an alert? |
|---|---|---|
| **Out of stock** | None left on the shelf. | ✅ (red) |
| **Critical** | Runs out in **3 days or less**. | ✅ (red) |
| **Monitor** | Runs out in **10 days or less**. | ✅ (orange) |
| **OK** | More than 10 days of stock. | — |
| **No recent usage** | Nothing used in the last 30 days, so no stockout is predicted. | — |
| **Not enough data** | Less than **7 days** of history, too early to forecast. | — |

"No recent usage" and "Not enough data" components are listed under **Not forecast yet** at the bottom of the Forecast page.

### Alerts

- The **banner** shows up to three at-risk components, for example *"3 components may run out soon: LED Red (out of stock), Capacitor 100nF (2.8 days left), Resistor 10kΩ (5 days left). View forecast"*.
- Click **✕** to hide the banner for the rest of the browser session. It comes back if a different component starts needing attention, or a component's status changes.
- The **badge** stays visible until no component needs attention.
- Alerts update right after you borrow, return, undo a return, add stock or finish a count session, a few seconds after a device sort run completes, when you open the Forecast page, and when you come back to the browser tab. They also refresh every 5 minutes.

### What to do when a component is flagged

1. Open **Forecast** and read the card.
2. Order the **suggested quantity** before the **reorder-by date**. It allows 3 days for delivery.
3. When it arrives, record it with **Inventory → Add Stock**. The component moves back to OK, and the alert clears.

### Marking components as consumable

On **Components**, tick **Consumable** for parts that are used up and not brought back (resistors, capacitors, LEDs, wire). Leave it unticked for tools and boards that are borrowed and returned. See [section 4](#4-consumable-vs-returnable-components) for why this matters.

> **Note:** The inventory you pick in the dropdown is also the inventory the sorting device counts into. After a demo on "Forecast Demo", switch back to the inventory the device should use.

---

## 3. How the forecast is calculated

### The formula

```
Days remaining = Current stock ÷ Average daily usage
```

Example from the feature brief: 50 pieces ÷ 10 per day = **5 days → Monitor**.

### Average daily usage

```
Average daily usage = Usage in the last 30 days ÷ Days observed
```

- **Days observed** = 30, or fewer if the component's first stock record is newer than that. A component added 15 days ago is averaged over 15 days, not 30.
- Components with less than 7 days of history aren't forecast ("Not enough data").

### What counts as usage

Usage is **net consumption**: what left the shelf and didn't come back. Each stock record is counted by its type:

| Stock record | Returnable component | Consumable component |
|---|---|---|
| Borrow | + usage | + usage |
| Return | − usage | ignored |
| Undo of a return | + usage | ignored |
| Count shortfall (the sorter counted fewer than expected) | + usage | + usage |
| Negative manual adjustment | + usage | + usage |
| Restock / Add Stock / count surplus | ignored | ignored |
| First count (baseline) | ignored | ignored |

Total usage is never negative.

### The other numbers

| Value | Calculation |
|---|---|
| Stockout date | Today + days remaining |
| Reorder by | Stockout date − 3 days (delivery lead time) |
| Suggested quantity | (Average daily usage × 30 days, rounded up) − current stock, never below 0 |
| Stock at start of period | Current stock − net change since the period started |

### Settings

All in `src/lib/forecast/constants.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `WINDOW_DAYS` | 30 | How far back usage is averaged |
| `MIN_HISTORY_DAYS` | 7 | History needed before forecasting |
| `CRITICAL_DAYS` | 3 | Critical at or below this many days |
| `MONITOR_DAYS` | 10 | Monitor at or below this many days |
| `LEAD_TIME_DAYS` | 3 | Delivery time assumed for the reorder-by date |
| `COVERAGE_DAYS` | 30 | Days of usage a suggested order should cover |

### Where current stock comes from

The same `get_inventory` database function the Inventory page uses, so the numbers match.

---

## 4. Consumable vs returnable components

**Why the flag exists.** Add Stock was built for returnable items: when parts come in, it assumes they are returned loans and closes the oldest open loans first. Only the remainder is recorded as new stock. For consumables that's wrong. A new box of resistors isn't a student returning the ones they used. Without the flag, restocking erased usage history, and the forecast thought the parts were never used.

**What the flag changes:**

| | Returnable (default) | Consumable |
|---|---|---|
| Add Stock | Closes open loans first (oldest first), then records the rest as new stock | Records everything as new stock. Loans stay open. Picking a specific loan under **Return match** still closes that loan. |
| Forecast usage | Borrows minus returns | Every borrow counts. Returns don't reduce usage. |
| Forecast card | — | "Consumable" label next to the name |

**Database change.** Run once, already applied to production on 2026-10-11:

```sql
alter table public.components add column consumable boolean not null default false;
```

Existing components start as returnable. If the column is missing, the app treats everything as returnable instead of failing.

---

## 5. Setup and deployment

1. **Database:** run the SQL in [section 4](#4-consumable-vs-returnable-components) once. Already done on the production database.
2. **Environment:** nothing new. Uses the existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
3. **Device:** no firmware changes.
4. **Demo inventory (optional):**
   ```bash
   node --env-file=.env.local scripts/seed-forecast-demo.mjs
   ```
   Creates "Forecast Demo" with six components chosen to show every status. Resistor 10kΩ reproduces the brief's example (200 → 50 pcs at 10 per day). The script refuses to run if "Forecast Demo" already exists, so archive or delete it first to recreate it. It never touches other inventories.

---

## 6. Testing

### Automated

```bash
npm test                # 43 unit tests
npm run test:coverage   # with coverage (forecast logic ~98%)
```

The tests cover the brief's example, every usage rule in [section 3](#what-counts-as-usage), consumable handling, each status boundary, short histories, reorder dates and quantities, sort order, and the banner wording.

### Manual walkthrough

On the **Forecast Demo** inventory. The exact numbers depend on its current history.

| Step | Do | Expect |
|---|---|---|
| 1 | Open Forecast | Out of stock, Critical, Monitor and OK cards. Banner on other pages; badge in the nav bar. |
| 2 | Borrows → borrow a large quantity of an OK consumable | It moves to Monitor or Critical, and the badge count rises right away, with no reload. |
| 3 | Return that borrow | Returnable: days remaining go back up. Consumable: usage stays counted (by design). |
| 4 | Inventory → Add Stock on a Critical consumable | It moves to OK, the badge count drops, and no loans are closed. |
| 5 | Add Stock on a returnable part with an open loan | The loan is closed as a return (unchanged behaviour). |
| 6 | Dismiss the banner, then cause a new alert | The banner comes back. |

---

## 7. Technical reference (for developers)

### Files

| Path | Purpose |
|---|---|
| `src/lib/forecast/forecast.ts` | Pure forecast logic: `computeForecasts()`, `countAlerts()`, `isAlertStatus()` |
| `src/lib/forecast/constants.ts` | Thresholds and windows ([section 3](#settings)) |
| `src/lib/forecast/types.ts` | `LedgerEntry`, `ComponentForecast`, `ForecastStatus`, `ForecastOptions` |
| `src/lib/forecast/format.ts` | Labels and number/date formatting, `describeAlert()` |
| `src/lib/forecast/context.tsx` | `ForecastProvider` (loads data once for the whole app) and the `useForecasts()` hook |
| `src/app/forecast/page.tsx` | Forecast page |
| `src/components/forecast/*` | `ForecastCard`, `StatusBadge`, `ForecastAlertBadge`, `ForecastAlertBanner` |
| `src/app/layout.tsx` | Wraps the app in `ForecastProvider`; renders the banner |
| `src/app/components/page.tsx`, `src/app/api/components/route.ts` | Consumable checkbox and API field |
| `src/app/api/inventory/add/route.ts` | Consumable restocks bypass loan matching |
| `scripts/seed-forecast-demo.mjs` | Demo data |
| `*.test.ts`, `vitest.config.mts` | Unit tests |

### Data flow

```
inventory_ledger ─┐
get_inventory()  ─┼─► ForecastProvider ─► computeForecasts() ─► ForecastPage
components       ─┘   (one load, shared)                       ├► ForecastAlertBadge
(consumable flags)                                             └► ForecastAlertBanner
```

- The provider loads the selected inventory's full stock history (paged 1000 rows at a time), current stock and consumable names, then runs the pure `computeForecasts()` in the browser.
- Only the most recent load may update the screen, so switching inventories quickly can't show stale data.
- `inventory_ledger` has no realtime feed. Code that changes stock should call `refresh()` from `useForecasts()` afterwards. The Borrows, Inventory, Session and Sort pages already do.

### Using the forecast logic elsewhere

```ts
import { computeForecasts } from '@/lib/forecast/forecast'

const forecasts = computeForecasts(
  ledgerEntries,                 // { component, delta, reason, created_at }[]
  { 'Resistor 10kΩ': 50 },       // current stock by component
  new Date(),                    // "now"
  { monitorDays: 14 },           // optional: override any setting
  new Set(['Resistor 10kΩ']),    // optional: consumable component names
)
```

It's a pure function: no database access, and inputs are never modified. Results are sorted most urgent first.

### API changes

- `POST/PUT /api/components` accept an optional `consumable: boolean`.
- `POST /api/inventory/add` returns `closed_borrows: []` for consumables (unless `borrow_id` is given) and records a single `adjustment` entry.

No other endpoints, device API or database functions changed.

---

## 8. Known limitations

- **No live push.** Alerts update after actions in the same browser tab, on tab focus and every 5 minutes. A change made by another person or the device shows up on the next of those, not instantly. Live updates would need realtime turned on for `inventory_ledger` in Supabase.
- **Weight sensing is per part, not per bin.** Stock comes from the sorter's counts, not from continuously weighing a full bin. A bin-weight sensor could feed the same forecast later.
- **Consumable returns don't reduce usage.** If a consumable really is returned, use a manual adjustment instead.
- **Constant-rate assumption.** The forecast assumes recent usage continues. It doesn't model seasons, semesters or one-off spikes.
- **The dropdown sets the device's inventory.** Choosing an inventory on any open dashboard tab also changes which inventory the sorter counts into. This predates the forecast feature.
- **Whole history loaded in the browser.** Fine at prototype scale. A very large history would need a database-side summary instead.
