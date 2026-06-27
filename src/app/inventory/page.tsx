'use client'

import { useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'

interface InventoryRow {
  component: string
  in_stock: number
  location: string | null
  updated_at: string | null
  borrowed: number
}

type SortKey = 'component' | 'in_stock' | 'borrowed' | 'location' | 'updated_at'

type DBInvRow = { component: string; in_stock: number; location: string | null; updated_at: string | null }
type DBBorrowRow = { component: string; qty: number }

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const COLS: { key: SortKey; label: string }[] = [
  { key: 'component', label: 'Component' },
  { key: 'in_stock', label: 'In Stock' },
  { key: 'borrowed', label: 'On Loan' },
  { key: 'location', label: 'Location' },
  { key: 'updated_at', label: 'Last Updated' },
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
            supabase.from('inventory').select('component, in_stock, location, updated_at'),
            supabase.from('borrows').select('component, qty').is('returned_at', null),
          ])

        if (invErr) throw new Error(invErr.message)
        if (borrowErr) throw new Error(borrowErr.message)

        const loanedMap = ((borrows ?? []) as unknown as DBBorrowRow[]).reduce<
          Record<string, number>
        >((acc, b) => ({ ...acc, [b.component]: (acc[b.component] ?? 0) + b.qty }), {})

        setRows(
          ((inv ?? []) as unknown as DBInvRow[]).map(r => ({
            ...r,
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
    return <div className="flex-1 flex items-center justify-center text-slate-500">Loading…</div>
  }

  if (loadError) {
    return <div className="flex-1 p-8 text-red-400">{loadError}</div>
  }

  return (
    <div className="flex-1 p-6">
      <h1 className="text-xl font-semibold text-slate-200 mb-6">Inventory</h1>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left">
            <tr>
              {COLS.map(({ key, label }) => (
                <th
                  key={key}
                  onClick={() => onSort(key)}
                  className="px-4 py-3 text-slate-400 font-medium cursor-pointer hover:text-white select-none whitespace-nowrap"
                >
                  {label}{' '}
                  <span className={sortKey === key ? 'text-cyan-400' : 'text-slate-700'}>
                    {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-600">
                  No inventory yet — complete a sort run to populate.
                </td>
              </tr>
            ) : (
              sorted.map(row => (
                <tr key={row.component} className="hover:bg-slate-900/50">
                  <td className="px-4 py-3 text-white font-mono">{row.component}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-cyan-400">
                    {row.in_stock}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {row.borrowed > 0 ? (
                      <span className="text-amber-400">{row.borrowed}</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{row.location ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                    {fmtDate(row.updated_at)}
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
