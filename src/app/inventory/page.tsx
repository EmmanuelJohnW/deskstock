'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useInventory } from '@/lib/inventory/context'

// ─── get_inventory — run in Supabase SQL editor ──────────────────────────────
//
// FIX: the version of this function currently deployed sums inventory_ledger
// while excluding 'borrow'/'return' reasons (mirroring reconcile_session's
// "physical count" balance). That makes the qty shown here — and in the
// Borrows page's "available" dropdown — read HIGHER than what's actually
// free to lend, because outstanding borrows already reduced availability but
// never get subtracted here. borrow_component's own guard sums ALL deltas
// including borrow/return ("net ledger balance is the authoritative available
// quantity" — see api/borrows/route.ts) and rejects with insufficient_stock
// against that lower true number, even though the dropdown just told the
// user there was plenty. Re-running this definition to sum every reason
// makes both numbers agree.
//
// p_inventory_id scopes the aggregate — component names are only unique per
// inventory now (see api/components/route.ts), so summing across all
// inventories would blend unrelated stock together.
//
// CREATE OR REPLACE FUNCTION public.get_inventory(p_inventory_id bigint)
// RETURNS TABLE(component text, qty bigint)
// LANGUAGE sql
// STABLE
// AS $$
//   SELECT component, SUM(delta) AS qty
//   FROM   inventory_ledger
//   WHERE  inventory_id = p_inventory_id
//   GROUP  BY component
//   ORDER  BY component;
// $$;
//
// ─────────────────────────────────────────────────────────────────────────────

interface InventoryRow {
  component: string
  qty: number
  borrowed: number
}

interface ClosedBorrow {
  borrow_id: string
  borrower: string
  qty: number
  taken_at: string
}

interface OpenBorrowRow {
  id: string
  borrower: string
  qty: number
  taken_at: string
}

type SortKey = 'component' | 'qty' | 'borrowed'

type DBBorrowRow = { component: string; qty: number }

const COLS: { key: SortKey; label: string }[] = [
  { key: 'component', label: 'Component' },
  { key: 'qty',       label: 'In Stock'  },
  { key: 'borrowed',  label: 'On Loan'   },
]

const EMPTY_ADD_FORM = { component: '', qty: '1' }

const INPUT_CLS =
  'bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-emerald-500'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function InventoryPage() {
  const { selectedInventoryId, loading: inventoryLoading } = useInventory()
  const [rows, setRows] = useState<InventoryRow[]>([])
  const [componentNames, setComponentNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('component')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [closedBorrows, setClosedBorrows] = useState<ClosedBorrow[] | null>(null)

  const [openBorrows, setOpenBorrows] = useState<OpenBorrowRow[]>([])
  const [overrideBorrowId, setOverrideBorrowId] = useState('')

  const load = useCallback(async () => {
    if (selectedInventoryId === null) {
      setRows([])
      setComponentNames([])
      setLoading(false)
      return
    }
    try {
      const supabase = getSupabaseClient()
      const [
        { data: inv, error: invErr },
        { data: borrows, error: borrowErr },
        { data: catalog, error: catalogErr },
      ] = await Promise.all([
        supabase.rpc('get_inventory', { p_inventory_id: selectedInventoryId }),
        supabase
          .from('borrows')
          .select('component, qty')
          .eq('inventory_id', selectedInventoryId)
          .is('returned_at', null),
        supabase
          .from('components')
          .select('name')
          .eq('inventory_id', selectedInventoryId)
          .order('name', { ascending: true }),
      ])

      if (invErr)     throw new Error(invErr.message)
      if (borrowErr)  throw new Error(borrowErr.message)
      if (catalogErr) throw new Error(catalogErr.message)

      const loanedMap = ((borrows ?? []) as unknown as DBBorrowRow[]).reduce<
        Record<string, number>
      >((acc, b) => ({ ...acc, [b.component]: (acc[b.component] ?? 0) + b.qty }), {})

      setRows(
        ((inv ?? []) as { component: string; qty: number }[]).map(r => ({
          component: r.component,
          qty: r.qty,
          borrowed: loanedMap[r.component] ?? 0,
        }))
      )
      setComponentNames(((catalog ?? []) as { name: string }[]).map(c => c.name))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [selectedInventoryId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setOverrideBorrowId('')
    if (!addForm.component || selectedInventoryId === null) {
      setOpenBorrows([])
      return
    }
    let cancelled = false
    getSupabaseClient()
      .from('borrows')
      .select('id, borrower, qty, taken_at')
      .eq('component', addForm.component)
      .eq('inventory_id', selectedInventoryId)
      .is('returned_at', null)
      .order('taken_at', { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setOpenBorrows((data ?? []) as unknown as OpenBorrowRow[])
      })
    return () => { cancelled = true }
  }, [addForm.component, selectedInventoryId])

  async function handleAddStock(e: React.FormEvent) {
    e.preventDefault()
    if (selectedInventoryId === null) return
    setSubmitting(true)
    setAddError(null)
    setClosedBorrows(null)
    try {
      const res = await fetch('/api/inventory/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component: addForm.component,
          qty: Number(addForm.qty),
          inventory_id: selectedInventoryId,
          ...(overrideBorrowId ? { borrow_id: overrideBorrowId } : {}),
        }),
      })
      const body = (await res.json()) as {
        success: boolean
        error?: string | Record<string, unknown>
        closed_borrows?: ClosedBorrow[]
      }
      if (!res.ok || !body.success) {
        setAddError(
          body.error === 'qty_below_selected_borrow'
            ? 'Qty must fully cover the selected loan — no partial returns.'
            : body.error === 'borrow_not_found_or_already_returned'
            ? 'That loan was already returned — refresh and try again.'
            : typeof body.error === 'string'
            ? body.error
            : JSON.stringify(body.error)
        )
        return
      }
      setClosedBorrows(body.closed_borrows ?? [])
      setAddForm(EMPTY_ADD_FORM)
      await load()
    } catch {
      setAddError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  })

  if (inventoryLoading || loading) {
    return <div className="flex-1 flex items-center justify-center text-gray-400">Loading…</div>
  }

  if (selectedInventoryId === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        No inventory selected — create one from the dropdown above.
      </div>
    )
  }

  if (loadError) {
    return <div className="flex-1 p-8 text-red-600">{loadError}</div>
  }

  return (
    <div className="flex-1 p-6">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Inventory</h1>

      {/* ── Add Stock ── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Add Stock</h2>
        <form onSubmit={handleAddStock} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Component</label>
            <select
              value={addForm.component}
              onChange={e => setAddForm(f => ({ ...f, component: e.target.value }))}
              required
              className={`${INPUT_CLS} min-w-[180px]`}
            >
              <option value="">Select…</option>
              {componentNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Qty</label>
            <input
              type="number"
              min={1}
              value={addForm.qty}
              onChange={e => setAddForm(f => ({ ...f, qty: e.target.value }))}
              required
              className={`${INPUT_CLS} w-24`}
            />
          </div>

          {openBorrows.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 uppercase tracking-wider">Return match</label>
              <select
                value={overrideBorrowId}
                onChange={e => setOverrideBorrowId(e.target.value)}
                className={`${INPUT_CLS} min-w-[220px]`}
              >
                <option value="">Auto (earliest first)</option>
                {openBorrows.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.borrower} — {b.qty} (taken {fmtDate(b.taken_at)})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Adding…' : 'Add Stock'}
          </button>
        </form>

        {addError && <p className="mt-2 text-red-600 text-sm">{addError}</p>}

        {closedBorrows && closedBorrows.length > 0 && (
          <div className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Matched against {closedBorrows.length} outstanding loan
            {closedBorrows.length > 1 ? 's' : ''} — marked returned:
            <ul className="mt-1 list-disc list-inside">
              {closedBorrows.map(b => (
                <li key={b.borrow_id}>
                  {b.qty} × {b.borrower} (taken {fmtDate(b.taken_at)})
                </li>
              ))}
            </ul>
          </div>
        )}
        {closedBorrows && closedBorrows.length === 0 && (
          <p className="mt-3 text-sm text-gray-400">
            No outstanding loans to match — recorded as new stock.
          </p>
        )}
      </section>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              {COLS.map(({ key, label }) => (
                <th
                  key={key}
                  onClick={() => onSort(key)}
                  className="px-4 py-3 text-gray-500 font-medium cursor-pointer hover:text-gray-900 select-none whitespace-nowrap"
                >
                  {label}{' '}
                  <span className={sortKey === key ? 'text-emerald-600' : 'text-gray-300'}>
                    {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                  No inventory yet — complete a sort run and reconcile to populate.
                </td>
              </tr>
            ) : (
              sorted.map(row => (
                <tr key={row.component} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 font-mono">{row.component}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-emerald-600">
                    {row.qty}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {row.borrowed > 0 ? (
                      <span className="text-amber-600">{row.borrowed}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
