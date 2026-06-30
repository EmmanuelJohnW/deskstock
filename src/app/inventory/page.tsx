'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'

interface InventoryRow {
  component: string
  qty: number
  borrowed: number
}

type SortKey = 'component' | 'qty' | 'borrowed'

type DBBorrowRow = { component: string; qty: number }

const COLS: { key: SortKey; label: string }[] = [
  { key: 'component', label: 'Component' },
  { key: 'qty',       label: 'In Stock'  },
  { key: 'borrowed',  label: 'On Loan'   },
]

export default function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('component')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    async function load() {
      try {
        const supabase = getSupabaseClient()
        const [{ data: inv, error: invErr }, { data: borrows, error: borrowErr }] =
          await Promise.all([
            supabase.rpc('get_inventory'),
            supabase.from('borrows').select('component, qty').is('returned_at', null),
          ])

        if (invErr)    throw new Error(invErr.message)
        if (borrowErr) throw new Error(borrowErr.message)

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
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Load failed')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

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

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-gray-400">Loading…</div>
  }

  if (loadError) {
    return <div className="flex-1 p-8 text-red-600">{loadError}</div>
  }

  return (
    <div className="flex-1 p-6">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Inventory</h1>
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
