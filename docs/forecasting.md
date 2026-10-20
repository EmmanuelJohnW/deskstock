# Stockout Forecasting

DeskStock predicts when each component will run out and warns the lab custodian before it happens, instead of only reporting stock that is already low.

This document covers:

1. [What's new](#1-whats-new)
2. [Using it (for lab custodians)](#2-using-it-for-lab-custodians)
3. [How the forecast is calculated](#3-how-the-forecast-is-calculated)
4. [Returns and restocks](#4-returns-and-restocks)
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
| **Returns via the Return button** | Borrows page → **Return** | The Return button is the only way to record a borrowed item coming back. **Add Stock** always means new stock. |
| **Demo inventory** | `scripts/seed-forecast-demo.mjs` | Creates a "Forecast Demo" inventory with sample history, for demonstrations. |

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
Button                                                    [Monitor]
15 days ago: 200 pcs · Now: 50 pcs
────────────────────────────────────────────────────────────────────
Average daily usage            Estimated days remaining
10 pcs                         5 days

  Predicted stockout
  Expected to run out around Oct 25, 2026 if usage continues at the
  current rate. Reorder by Oct 22, 2026 to avoid a shortage. About
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

- The **banner** shows up to three at-risk components, for example *"3 components may run out soon: Buzzer (out of stock), 4mm coupler (2.5 days left), Button (5 days left). View forecast"*.
- Click **✕** to hide the banner for the rest of the browser session. It comes back if a different component starts needing attention, or a component's status changes.
- The **badge** stays visible until no component needs attention.
- Alerts update right after you borrow, return, undo a return, add stock or finish a count session, a few seconds after a device sort run completes, when you open the Forecast page, and when you come back to the browser tab. They also refresh every 5 minutes.

### What to do when a component is flagged

1. Open **Forecast** and read the card.
2. Order the **suggested quantity** before the **reorder-by date**. It allows 3 days for delivery.
3. When it arrives, record it with **Inventory → Add Stock**. The component moves back to OK, and the alert clears.

### Recording returns

When a student brings a borrowed item back, click **Return** on that loan in the **Borrows** page. Don't use Add Stock for returns; Add Stock is only for new stock. See [section 4](#4-returns-and-restocks) for why.

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

| Stock record | Effect on usage |
|---|---|
| Borrow | + usage |
| Return (Return button) | − usage |
| Undo of a return | + usage |
| Count shortfall (the sorter counted fewer than expected) | + usage |
| Negative manual adjustment | + usage |
| Restock / Add Stock / count surplus | ignored |
| First count (baseline) | ignored |

So a borrow that's **never returned** counts as used up, and one returned with the Return button doesn't. Total usage is never negative.

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

## 4. Returns and restocks

**The rule:** the **Return button** on the Borrows page is the only way to record a borrowed item coming back. **Add Stock** always records new stock.

**Why.** Add Stock used to guess: when parts came in, it assumed they were borrowed items being returned and closed the oldest open loans first. That's wrong for a new box of buttons or resistors. Those aren't students returning what they used. The guess made restocks look like returns, which erased usage history, so the forecast thought parts were never used.

With the Return button as the only source of returns, the data stays clear:

| Action | Recorded as | Forecast |
|---|---|---|
| Borrow | A loan | Counts as usage |
| Return button | Loan closed, stock back | Usage removed |
| Add Stock | New stock | Not usage |
| Borrowed, never returned | Loan stays open | Stays counted as used up |

This works the same for every component, so there's nothing to set up per part.

**Earlier version.** A previous version used a per-component **Consumable** checkbox to work around the guessing. It was removed. The `components.consumable` column still exists in the database but isn't used.

---

## 5. Setup and deployment

1. **Database:** no changes needed.
2. **Environment:** nothing new. Uses the existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
3. **Device:** no firmware changes.
4. **Demo inventory (optional):**
   ```bash
   node --env-file=.env.local scripts/seed-forecast-demo.mjs
   ```
   Creates "Forecast Demo" with four components, one per alert status:

   | Component | History | Status |
   |---|---|---|
   | Buzzer | 40 → 0 at 2 per day | Out of stock |
   | 4mm coupler | 90 → 10 at 4 per day | Critical (2.5 days) |
   | Button | 200 → 50 at 10 per day | Monitor (5 days, the brief's example) |
   | IR sensor | 120 → 95 at 1 per day, plus loans returned with the Return button | OK (95 days) |

   The script refuses to run if "Forecast Demo" already exists, so archive or rename it first to recreate it. It never touches other inventories.

---

## 6. Testing

### Automated

```bash
npm test                # unit tests
npm run test:coverage   # with coverage (forecast logic ~98%)
```

The tests cover the brief's example, every usage rule in [section 3](#what-counts-as-usage), returns versus restocks, each status boundary, short histories, reorder dates and quantities, sort order, and the banner wording.

### Manual walkthrough

On a freshly seeded **Forecast Demo** inventory:

| Step | Do | Expect |
|---|---|---|
| 1 | Open Forecast | Buzzer out of stock, 4mm coupler critical, Button monitor, IR sensor OK. Banner on other pages; badge shows 3. |
| 2 | Borrows → borrow **70 IR sensor** | IR sensor moves to Monitor (about 6.6 days). The badge rises to 4 right away, with no reload. |
| 3 | Click **Return** on that loan | IR sensor goes back to OK. The badge drops to 3. |
| 4 | Inventory → Add Stock **40 4mm coupler** | 4mm coupler moves to OK (12.5 days). The badge drops by 1, and no loans are closed. |
| 5 | Dismiss the banner, then cause a new alert | The banner comes back. |

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
| `src/app/api/inventory/add/route.ts` | Add Stock: records new stock only |
| `scripts/seed-forecast-demo.mjs` | Demo data |
| `*.test.ts`, `vitest.config.mts` | Unit tests |

### Data flow

```
inventory_ledger ─┐
                  ├─► ForecastProvider ─► computeForecasts() ─► ForecastPage
get_inventory()  ─┘   (one load, shared)                       ├► ForecastAlertBadge
                                                               └► ForecastAlertBanner
```

- The provider loads the selected inventory's full stock history (paged 1000 rows at a time) and current stock, then runs the pure `computeForecasts()` in the browser.
- Only the most recent load may update the screen, so switching inventories quickly can't show stale data.
- `inventory_ledger` has no realtime feed. Code that changes stock should call `refresh()` from `useForecasts()` afterwards. The Borrows, Inventory, Session and Sort pages already do.

### Using the forecast logic elsewhere

```ts
import { computeForecasts } from '@/lib/forecast/forecast'

const forecasts = computeForecasts(
  ledgerEntries,                 // { component, delta, reason, created_at }[]
  { Button: 50 },                // current stock by component
  new Date(),                    // "now"
  { monitorDays: 14 },           // optional: override any setting
)
```

It's a pure function: no database access, and inputs are never modified. Results are sorted most urgent first.

### API changes

- `POST /api/inventory/add` records a single `adjustment` ledger entry and returns `{ success: true }`. It no longer accepts `borrow_id` or returns `closed_borrows`, and no longer calls the `add_stock()` database function (which still exists but is unused).

No other endpoints, device API or database functions changed.

---

## 8. Known limitations

- **Returns must use the Return button.** If a borrowed item is put back on the shelf without clicking Return, its loan stays open and the forecast counts it as used up. The forecast then predicts a stockout earlier than needed, which errs on the safe side.
- **Older history may skew forecasts for up to 30 days.** Before this change, Add Stock sometimes recorded restocks as automatic "returns". Those old records still reduce usage until they age out of the 30-day window.
- **No live push.** Alerts update after actions in the same browser tab, on tab focus and every 5 minutes. A change made by another person or the device shows up on the next of those, not instantly. Live updates would need realtime turned on for `inventory_ledger` in Supabase.
- **Weight sensing is per part, not per bin.** Stock comes from the sorter's counts, not from continuously weighing a full bin. A bin-weight sensor could feed the same forecast later.
- **Constant-rate assumption.** The forecast assumes recent usage continues. It doesn't model seasons, semesters or one-off spikes.
- **The dropdown sets the device's inventory.** Choosing an inventory on any open dashboard tab also changes which inventory the sorter counts into. This predates the forecast feature.
- **Whole history loaded in the browser.** Fine at prototype scale. A very large history would need a database-side summary instead.
