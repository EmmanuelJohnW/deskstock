import { getSupabaseClient } from '@/lib/supabase/client'
import type {
  BorrowRow,
  ComponentRow,
  CountSessionRow,
  LedgerRow,
  ReconciliationRow,
  Snapshot,
  StockRow,
} from './types'

// Fetches everything the dashboard pages show for one inventory, in one go,
// so it can be saved on the laptop and used while offline.

// Supabase caps a single select at 1000 rows; page through the ledger so older
// history (which sets each component's first-seen date) isn't cut off.
const LEDGER_PAGE_SIZE = 1000

interface QueryResult<T> {
  data: T[] | null
  error: { message: string } | null
}

function rowsOrThrow<T>({ data, error }: QueryResult<T>): T[] {
  if (error) throw error
  return data ?? []
}

async function fetchLedger(inventoryId: number): Promise<LedgerRow[]> {
  const supabase = getSupabaseClient()
  const fetchPage = async (from: number, acc: LedgerRow[]): Promise<LedgerRow[]> => {
    const page = rowsOrThrow<LedgerRow>(
      await supabase
        .from('inventory_ledger')
        .select('id, component, delta, reason, session_id, created_at, client_op_id')
        .eq('inventory_id', inventoryId)
        .order('id', { ascending: true })
        .range(from, from + LEDGER_PAGE_SIZE - 1),
    )
    const rows = [...acc, ...page]
    return page.length < LEDGER_PAGE_SIZE ? rows : fetchPage(from + LEDGER_PAGE_SIZE, rows)
  }
  return fetchPage(0, [])
}

/**
 * Throws the Supabase error (or a fetch TypeError) on failure; use
 * isNetworkError() to tell "offline" apart from a real server error.
 */
export async function fetchSnapshot(inventoryId: number): Promise<Snapshot> {
  // Taken before fetching: anything the server confirmed before this moment is
  // included in what we're about to read.
  const fetchedAt = new Date().toISOString()
  const supabase = getSupabaseClient()

  const [components, borrows, ledger, stock, reconciliations, countSessions] = await Promise.all([
    supabase.from('components').select('id, name, weight_g, created_at').eq('inventory_id', inventoryId).order('name'),
    supabase.from('borrows').select('*').eq('inventory_id', inventoryId).order('taken_at', { ascending: false }),
    fetchLedger(inventoryId),
    supabase.rpc('get_inventory', { p_inventory_id: inventoryId }),
    supabase
      .from('reconciliations')
      .select('session_id, component, expected, counted, difference')
      .eq('inventory_id', inventoryId)
      .neq('difference', 0)
      .order('session_id', { ascending: false })
      .order('component', { ascending: true }),
    supabase.from('count_sessions').select('id, finished_at').eq('status', 'reconciled').eq('inventory_id', inventoryId),
  ])

  return {
    inventoryId,
    components: rowsOrThrow<ComponentRow>(components),
    borrows: rowsOrThrow<BorrowRow>(borrows),
    ledger,
    stock: rowsOrThrow<StockRow>(stock).map(s => ({ component: s.component, qty: Number(s.qty) })),
    reconciliations: rowsOrThrow<ReconciliationRow>(reconciliations),
    countSessions: rowsOrThrow<CountSessionRow>(countSessions),
    fetchedAt,
  }
}
