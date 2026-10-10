// Seeds a separate "Forecast Demo" inventory with ~30 days of backdated
// history so the Forecast page has something to show. Real inventories are
// never touched. Refuses to run if the demo inventory already exists.
//
// Usage (from the repo root):
//   node --env-file=.env.local scripts/seed-forecast-demo.mjs
//
// Each component is designed to land in one forecast status:
//   Resistor 10kΩ    200 → 50 at 10/day          → Monitor (5 days, the spec example)
//   Jumper wire       90 → 10 at 4/day            → Critical (2.5 days)
//   LED Red           40 → 0 at 2/day             → Out of stock
//   Capacitor 100nF  300 at 3/day + a count shortfall → OK
//   Multimeter       borrowed and returned        → No recent usage
//   Arduino Uno      added 3 days ago             → Not enough data

import { createClient } from '@supabase/supabase-js'

const INVENTORY_NAME = 'Forecast Demo'
const BORROWER = 'Demo student'
const MS_PER_DAY = 24 * 60 * 60 * 1000
const LOAN_DAYS = 7

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
if (!url || !secretKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY — run with --env-file=.env.local')
  process.exit(1)
}

const supabase = createClient(url, secretKey, { auth: { persistSession: false } })
const now = Date.now()
const at = daysAgo => new Date(now - daysAgo * MS_PER_DAY).toISOString()

// ── Scenario builders ────────────────────────────────────────────────────────
// Each returns { ledger: [...], borrows: [...] } rows without inventory_id.

function restock(component, qty, daysAgo) {
  return { ledger: [{ component, delta: qty, reason: 'adjustment', created_at: at(daysAgo) }], borrows: [] }
}

function consumedBorrow(component, qty, daysAgo) {
  return {
    ledger: [{ component, delta: -qty, reason: 'borrow', created_at: at(daysAgo) }],
    borrows: [
      { component, qty, borrower: BORROWER, taken_at: at(daysAgo), due_at: at(daysAgo - LOAN_DAYS), returned_at: null },
    ],
  }
}

function returnedBorrow(component, qty, takenDaysAgo, returnedDaysAgo) {
  return {
    ledger: [
      { component, delta: -qty, reason: 'borrow', created_at: at(takenDaysAgo) },
      { component, delta: qty, reason: 'return', created_at: at(returnedDaysAgo) },
    ],
    borrows: [
      {
        component,
        qty,
        borrower: BORROWER,
        taken_at: at(takenDaysAgo),
        due_at: at(takenDaysAgo - LOAN_DAYS),
        returned_at: at(returnedDaysAgo),
      },
    ],
  }
}

function countShortfall(component, qty, daysAgo) {
  return { ledger: [{ component, delta: -qty, reason: 'sort_session', created_at: at(daysAgo) }], borrows: [] }
}

/** One consumed borrow per day, starting `days` days ago. */
function dailyUsage(component, perDay, days) {
  return Array.from({ length: days }, (_, i) => consumedBorrow(component, perDay, days - i - 0.5))
}

const COMPONENTS = [
  { name: 'Resistor 10kΩ', weight_g: 0.24 },
  { name: 'Jumper wire', weight_g: 0.5 },
  { name: 'LED Red', weight_g: 0.09 },
  { name: 'Capacitor 100nF', weight_g: 0.06 },
  { name: 'Multimeter', weight_g: 250 },
  { name: 'Arduino Uno', weight_g: 25 },
]

const SCENARIOS = [
  restock('Resistor 10kΩ', 200, 15),
  ...dailyUsage('Resistor 10kΩ', 10, 15),

  restock('Jumper wire', 90, 20),
  ...dailyUsage('Jumper wire', 4, 20),

  restock('LED Red', 40, 20),
  ...dailyUsage('LED Red', 2, 20),

  restock('Capacitor 100nF', 300, 25),
  ...dailyUsage('Capacitor 100nF', 3, 25),
  countShortfall('Capacitor 100nF', 5, 10),

  restock('Multimeter', 5, 25),
  ...[24, 18, 12, 6].map(d => returnedBorrow('Multimeter', 1, d, d - 1)),

  restock('Arduino Uno', 10, 3),
  consumedBorrow('Arduino Uno', 2, 1),
]

// ── Run ──────────────────────────────────────────────────────────────────────

async function insertOrFail(table, rows) {
  const { error } = await supabase.from(table).insert(rows)
  if (error) throw new Error(`insert into ${table} failed: ${error.message}`)
}

async function main() {
  const { data: existing, error: lookupError } = await supabase
    .from('inventories')
    .select('id')
    .eq('name', INVENTORY_NAME)
    .maybeSingle()
  if (lookupError) throw new Error(`inventory lookup failed: ${lookupError.message}`)
  if (existing) {
    throw new Error(`"${INVENTORY_NAME}" already exists (id ${existing.id}) — archive or delete it first.`)
  }

  const { data: inventory, error: createError } = await supabase
    .from('inventories')
    .insert({ name: INVENTORY_NAME })
    .select('id')
    .single()
  if (createError) throw new Error(`create inventory failed: ${createError.message}`)
  const inventoryId = inventory.id

  const withInventory = row => ({ ...row, inventory_id: inventoryId })
  const ledger = SCENARIOS.flatMap(s => s.ledger).map(withInventory)
  const borrows = SCENARIOS.flatMap(s => s.borrows).map(withInventory)

  await insertOrFail('components', COMPONENTS.map(withInventory))
  await insertOrFail('inventory_ledger', ledger)
  await insertOrFail('borrows', borrows)

  console.log(`Created "${INVENTORY_NAME}" (id ${inventoryId}):`)
  console.log(`  ${COMPONENTS.length} components, ${ledger.length} ledger entries, ${borrows.length} borrows`)
  console.log('Select it in the dashboard dropdown and open /forecast.')
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
