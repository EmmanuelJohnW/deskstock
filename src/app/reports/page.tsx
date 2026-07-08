'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { exportReportsPdf, exportReportsExcel } from '@/lib/reports/export'
import { useInventory } from '@/lib/inventory/context'

// ── Types ────────────────────────────────────────────────────────────────────

interface InvRow {
  component: string
  qty: number
}

interface DiscrepancyRow {
  component: string
  expected: number
  counted: number
  difference: number
}

interface DiscrepancySession {
  session_id: number
  finished_at: string | null
  rows: DiscrepancyRow[]
}

interface BorrowRow {
  id: string
  component: string
  qty: number
  borrower: string
  taken_at: string
  due_at: string
  returned_at: string | null
}

interface LedgerRow {
  id: number
  component: string
  delta: number
  reason: string
  session_id: number | null
  created_at: string
  running_balance: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const REASON_CLS: Record<string, string> = {
  baseline:        'text-gray-400',
  sort_session:    'text-emerald-600',
  borrow:          'text-amber-600',
  return:          'text-green-600',
  return_reversal: 'text-red-600',
  adjustment:      'text-purple-600',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Presentational atoms ─────────────────────────────────────────────────────

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-200">
      {children}
    </h2>
  )
}

function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-4 py-3 text-gray-500 font-medium text-left">{children}</th>
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-gray-400">{message}</td>
    </tr>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { selectedInventoryId, loading: inventoryLoading } = useInventory()
  const [inventory,    setInventory]    = useState<InvRow[]>([])
  const [discSessions, setDiscSessions] = useState<DiscrepancySession[]>([])
  const [borrows,      setBorrows]      = useState<BorrowRow[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)

  const [selectedComponent, setSelectedComponent] = useState('')
  const [ledger,            setLedger]            = useState<LedgerRow[]>([])
  const [ledgerLoading,     setLedgerLoading]     = useState(false)

  const [exporting,   setExporting]   = useState<'pdf' | 'excel' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    if (selectedInventoryId === null) {
      setInventory([])
      setDiscSessions([])
      setBorrows([])
      setLoading(false)
      return
    }
    async function load() {
      if (selectedInventoryId === null) return
      try {
        const supabase = getSupabaseClient()
        const [
          { data: invData,    error: invErr    },
          { data: reconcData, error: reconcErr },
          { data: sessData,   error: sessErr   },
          { data: borrowData, error: borrowErr },
        ] = await Promise.all([
          supabase.rpc('get_inventory', { p_inventory_id: selectedInventoryId }),
          supabase
            .from('reconciliations')
            .select('session_id, component, expected, counted, difference')
            .eq('inventory_id', selectedInventoryId)
            .neq('difference', 0)
            .order('session_id', { ascending: false })
            .order('component',  { ascending: true }),
          supabase
            .from('count_sessions')
            .select('id, finished_at')
            .eq('status', 'reconciled')
            .eq('inventory_id', selectedInventoryId),
          supabase
            .from('borrows')
            .select('*')
            .eq('inventory_id', selectedInventoryId)
            .order('taken_at', { ascending: false }),
        ])

        if (invErr)    throw invErr
        if (reconcErr) throw reconcErr
        if (sessErr)   throw sessErr
        if (borrowErr) throw borrowErr

        setInventory((invData ?? []) as unknown as InvRow[])
        setBorrows((borrowData ?? []) as unknown as BorrowRow[])

        const sessById = new Map<number, string | null>(
          ((sessData ?? []) as { id: number; finished_at: string | null }[])
            .map(s => [s.id, s.finished_at])
        )

        const grouped = new Map<number, DiscrepancySession>()
        for (const r of (reconcData ?? []) as (DiscrepancyRow & { session_id: number })[]) {
          if (!grouped.has(r.session_id)) {
            grouped.set(r.session_id, {
              session_id: r.session_id,
              finished_at: sessById.get(r.session_id) ?? null,
              rows: [],
            })
          }
          grouped.get(r.session_id)!.rows.push({
            component: r.component, expected: r.expected,
            counted: r.counted,     difference: r.difference,
          })
        }
        setDiscSessions(Array.from(grouped.values()))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Load failed')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [selectedInventoryId])

  const loadLedger = useCallback(async (component: string) => {
    if (!component || selectedInventoryId === null) { setLedger([]); return }
    setLedgerLoading(true)
    const { data, error: err } = await getSupabaseClient()
      .from('inventory_ledger')
      .select('id, component, delta, reason, session_id, created_at')
      .eq('component', component)
      .eq('inventory_id', selectedInventoryId)
      .order('created_at', { ascending: true })
    setLedgerLoading(false)
    if (err) return
    let balance = 0
    setLedger(
      ((data ?? []) as Omit<LedgerRow, 'running_balance'>[]).map(row => {
        balance += row.delta
        return { ...row, running_balance: balance }
      })
    )
  }, [selectedInventoryId])

  useEffect(() => { loadLedger(selectedComponent) }, [selectedComponent, loadLedger])

  async function handleExport(format: 'pdf' | 'excel') {
    setExporting(format)
    setExportError(null)
    try {
      const reportData = {
        inventory,
        discSessions,
        borrows,
        ledger: selectedComponent ? { component: selectedComponent, rows: ledger } : undefined,
      }
      if (format === 'pdf') {
        await exportReportsPdf(reportData)
      } else {
        await exportReportsExcel(reportData)
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }

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
  if (error) {
    return <div className="flex-1 p-8 text-red-600">{error}</div>
  }

  return (
    <div className="flex-1 p-6 space-y-12">

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
        <div className="flex items-center gap-3">
          {exportError && <p className="text-red-600 text-sm">{exportError}</p>}
          <button
            onClick={() => handleExport('pdf')}
            disabled={exporting !== null}
            className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {exporting === 'pdf' ? 'Generating…' : 'Download PDF'}
          </button>
          <button
            onClick={() => handleExport('excel')}
            disabled={exporting !== null}
            className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {exporting === 'excel' ? 'Generating…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {/* ── 1. Current Inventory ─────────────────────────────────────────── */}
      <section>
        <SectionHeading>Current Inventory</SectionHeading>
        <TableWrap>
          <thead className="bg-gray-50 text-left">
            <tr><Th>Component</Th><Th>Qty</Th></tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {inventory.length === 0
              ? <EmptyRow cols={2} message="No inventory yet." />
              : inventory.map(r => (
                  <tr key={r.component} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-900">{r.component}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-emerald-600">{r.qty}</td>
                  </tr>
                ))
            }
          </tbody>
        </TableWrap>
      </section>

      {/* ── 2. Discrepancy Report ────────────────────────────────────────── */}
      <section>
        <SectionHeading>Discrepancy Report</SectionHeading>
        {discSessions.length === 0 ? (
          <p className="text-sm text-gray-400">No discrepancies recorded across any reconciled session.</p>
        ) : (
          <div className="space-y-6">
            {discSessions.map(s => (
              <div key={s.session_id}>
                <p className="text-xs text-gray-400 mb-2 font-mono">
                  Session #{s.session_id} · finished {fmtDateTime(s.finished_at)}
                </p>
                <TableWrap>
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <Th>Component</Th><Th>Expected</Th><Th>Counted</Th><Th>Difference</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {s.rows.map(r => (
                      <tr key={r.component} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-gray-900">{r.component}</td>
                        <td className="px-4 py-3 tabular-nums text-gray-700">{r.expected}</td>
                        <td className="px-4 py-3 tabular-nums text-gray-700">{r.counted}</td>
                        <td className="px-4 py-3 tabular-nums font-semibold">
                          <span className={r.difference > 0 ? 'text-emerald-600' : 'text-red-600'}>
                            {r.difference > 0 ? '+' : ''}{r.difference}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 3. Borrow History ────────────────────────────────────────────── */}
      <section>
        <SectionHeading>Borrow History</SectionHeading>
        <TableWrap>
          <thead className="bg-gray-50 text-left">
            <tr>
              <Th>Component</Th><Th>Qty</Th><Th>Borrower</Th>
              <Th>Taken</Th><Th>Due</Th><Th>Returned</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {borrows.length === 0
              ? <EmptyRow cols={6} message="No borrows yet." />
              : borrows.map(b => {
                  const outstanding = b.returned_at === null
                  const overdue = outstanding && new Date(b.due_at) < new Date()
                  return (
                    <tr
                      key={b.id}
                      className={`hover:bg-gray-50 ${outstanding ? '' : 'opacity-50'}`}
                    >
                      <td className="px-4 py-3 font-mono text-gray-900">{b.component}</td>
                      <td className={`px-4 py-3 tabular-nums font-semibold ${outstanding ? 'text-amber-600' : 'text-gray-400'}`}>
                        {b.qty}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{b.borrower}</td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-400">{fmtDate(b.taken_at)}</td>
                      <td className="px-4 py-3 text-xs font-mono">
                        <span className={overdue ? 'text-red-600' : 'text-gray-400'}>
                          {fmtDate(b.due_at)}{overdue ? ' ⚠' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">
                        {b.returned_at
                          ? <span className="text-gray-400">{fmtDate(b.returned_at)}</span>
                          : <span className="text-amber-600">Outstanding</span>}
                      </td>
                    </tr>
                  )
                })
            }
          </tbody>
        </TableWrap>
      </section>

      {/* ── 4. Ledger Trail ──────────────────────────────────────────────── */}
      <section>
        <SectionHeading>Ledger Trail</SectionHeading>
        <div className="mb-4 flex items-center gap-3">
          <label className="text-xs text-gray-500 uppercase tracking-wider shrink-0">
            Component
          </label>
          <select
            value={selectedComponent}
            onChange={e => setSelectedComponent(e.target.value)}
            className="bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-emerald-500 min-w-[180px]"
          >
            <option value="">Select…</option>
            {inventory.map(r => (
              <option key={r.component} value={r.component}>{r.component}</option>
            ))}
          </select>
        </div>

        {!selectedComponent ? (
          <p className="text-sm text-gray-400">Select a component above to trace its ledger history.</p>
        ) : ledgerLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <TableWrap>
            <thead className="bg-gray-50 text-left">
              <tr><Th>Date</Th><Th>Reason</Th><Th>Delta</Th><Th>Balance</Th></tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {ledger.length === 0
                ? <EmptyRow cols={4} message="No ledger entries." />
                : ledger.map(row => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-mono text-gray-400">
                        {fmtDateTime(row.created_at)}
                      </td>
                      <td className={`px-4 py-3 font-mono text-xs ${REASON_CLS[row.reason] ?? 'text-gray-400'}`}>
                        {row.reason}
                      </td>
                      <td className="px-4 py-3 tabular-nums font-semibold">
                        <span className={row.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                          {row.delta >= 0 ? '+' : ''}{row.delta}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-900 font-semibold">
                        {row.running_balance}
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </TableWrap>
        )}
      </section>

    </div>
  )
}
