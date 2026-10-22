# Offline Mode and Sync

DeskStock keeps working on the laptop when the internet drops. The dashboard uses a copy of the data saved in the browser, records changes on the laptop, and sends them to the online database automatically when the connection comes back.

## What works offline

| Works offline | Needs internet |
|---|---|
| Inventory, Forecast, Reports (viewing and PDF/Excel export) | **Sorting** (the device talks directly to the online site) |
| Borrows: Borrow, Return, Undo | Device page (live device status and traffic) |
| Add Stock | Count sessions (start / finish) |
| Components: register, edit, delete | Creating or archiving inventories |

**Each inventory must be opened once while online** so the laptop has a saved copy of it. Opening DeskStock online also saves every page, so pages open without internet later (production site only, see [Pages without internet](#pages-without-internet)).

## How it looks

- **Status pill** in the nav bar:
  - **Online**: everything is synced.
  - **Offline · 3 pending**: no connection; 3 changes are saved on the laptop.
  - **3 to sync / Syncing…**: back online and sending changes.
  - **2 need attention**: some changes were rejected when syncing (see below).
- Changes made offline appear on screen **immediately** (stock, open loans, components, forecast and alerts), with an amber **Pending sync** tag until they reach the online database.
- After an action, a message confirms it was saved on the laptop and will sync later.
- The **Sync** page (click the pill) lists:
  - **Waiting to sync**: changes not sent yet.
  - **Needs attention**: changes the server rejected, with the reason, and **Retry** or **Discard** buttons.
  - When this inventory's copy was saved, and when the last sync ran.
  - A **Work offline** switch to simulate having no internet on this browser (for testing or demos).

## Syncing

- Sync starts on its own when the connection returns, every minute while changes are waiting, and when you come back to the tab. **Sync now** on the Sync page runs it straight away.
- Changes are sent **in the order they were made**, through the same API the dashboard uses online.
- Each change carries a unique id and the time it was made:
  - **No duplicates.** If the connection drops mid-sync, sending the same change again doesn't apply it twice.
  - **Real times.** Borrows and restocks keep the time they happened offline, so the forecast stays accurate.
- If the server **rejects** a change, it moves to *Needs attention* and anything that depends on it fails too. For example, if a borrow fails, a later return of that loan can't sync either. Common reasons:
  - *Not enough in stock*: someone else, or the sorting device, used the stock online in the meantime.
  - *A component with that name already exists*.
  - *Loan not found*.
- Only one browser tab syncs at a time; other tabs see the updates.

### Changes that combine automatically

- **Editing or deleting a component registered offline** updates or removes the queued registration, instead of sending both.
- **Undoing a return that hasn't synced yet** cancels the queued return.

## Database change (already required)

Run once in the Supabase SQL editor. It's backward compatible: older code keeps working.

```sql
alter table public.inventory_ledger
  add column if not exists client_op_id uuid unique;

drop function if exists public.borrow_component(text, integer, text, timestamptz, bigint);
-- then the new borrow_component(..., p_id uuid default null, p_at timestamptz default null)
-- exactly as written in the comment at the top of src/app/api/borrows/route.ts
```

## Pages without internet

A service worker (`public/sw.js`) saves the pages and their files while online:
- Page loads try the network first, then fall back to the saved page.
- Static files (`/_next/static/…`) are served from the cache once saved.
- API requests and Next.js data requests are never cached; data always comes from the laptop copy or the live database.

It only runs on the production build (the live site or `npm run build && npm start`), not with `npm run dev`. Each deploy gets a fresh page cache.

## Testing it

1. Open the dashboard online and visit the inventory you'll use.
2. Turn on **Work offline** on the Sync page, or turn off Wi-Fi.
3. Borrow, return, add stock, or register a component. The screens update with **Pending sync** tags, and the pill shows the count.
4. Turn **Work offline** off, or reconnect. The pill shows *Syncing…*, then *Online*, and the tags disappear.

## Technical overview

| File | Purpose |
|---|---|
| `src/lib/offline/types.ts` | Snapshot and queued-action (`Op`) types |
| `src/lib/offline/snapshot.ts` | Fetches everything one inventory's pages need |
| `src/lib/offline/store.ts` | IndexedDB storage (`idb`): snapshots, inventories list, queue |
| `src/lib/offline/apply.ts` | Applies queued actions on top of a snapshot (what the screens show) |
| `src/lib/offline/outbox.ts` | Queue rules: ordering, combining, dependencies, retry/discard |
| `src/lib/offline/sync.ts` | Sends queued actions to the API and classifies the answers |
| `src/lib/offline/connectivity.tsx` | Online/offline detection, the queue, automatic sync |
| `src/lib/offline/data.tsx` | `InventoryDataProvider` / `useInventoryData()`: the data and actions pages use |
| `src/components/offline/*` | Status pill, Pending sync tag, needs-internet notice, service worker registration |
| `src/app/sync/page.tsx` | The Sync page |
| `public/sw.js` | Service worker |

API additions (all optional, for sync):
- `POST /api/borrows` accepts `id` and `occurred_at`.
- `POST /api/inventory/add` accepts `op_id` and `occurred_at`.
- `POST /api/components` returns the new `id`.
- `POST /api/borrows/return` answers 404 for an unknown loan.

## Limitations

- **Sorting and live device data need internet.**
- **Return and Undo record the sync time**, not the time they were done offline. Borrows and restocks keep their real time.
- **Stock checks offline use the saved copy.** A borrow accepted offline can still be rejected at sync if stock changed online.
- **Registering a component offline whose name was meanwhile registered online** links to the existing component instead of failing; the same name is treated as the same component.
- **The saved copy is per browser.** Another laptop or browser has its own copy and queue.
