'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'

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
  baseline:     'text-slate-400',
  sort_session: 'text-cyan-400',
  borrow:       'text-amber-400',
  return:       'text-green-400',
  adjustment:   'text-purple-400',
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
    <h2 className="text-base font-semibold text-slate-200 mb-4 pb-2 border-b border-slate-800">
      {children}
    </h2>
  )
}

function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-4 py-3 text-slate-400 font-medium text-left">{children}</th>
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-slate-600">{message}</td>
    </tr>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [inventory,  setInventory]  = useState<InvRow[]>([])
  const [discSessions, setDiscSessions] = useState<DiscrepancySession[]>([])
  const [borrows,    setBorrows]    = useState<BorrowRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const [selectedComponent, setSelectedComponent] = useState('')
  const [ledger,       setLedger]       = useState<LedgerRow[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)

  // Load inventory, discrepancies, borrows once on mount
  useEffect(() => {
    async function load() {
      try {
        const supabase = getSupabaseClient()
        const [
          { data: invData,    error: invErr    },
          { data: reconcData, error: reconcErr },
          { data: sessData,   error: sessErr   },
          { data: borrowData, error: borrowErr },
        ] = await Promise.all([
          supabase.rpc('get_inventory'),
          supabase
            .from('reconciliations')
            .select('session_id, component, expected, counted, difference')
            .neq('difference', 0)
            .order('session_id', { ascending: false })
            .order('component',  { ascending: true }),
          supabase
            .from('count_sessions')
            .select('id, finished_at')
            .eq('status', 'reconciled'),
          supabase
            .from('borrows')
            .select('*')
            .order('taken_at', { ascending: false }),
        ])

        if (invErr)    throw invErr
        if (reconcErr) throw reconcErr
        if (sessErr)   throw sessErr
        if (borrowErr) throw borrowErr

        setInventory((invData ?? []) as unknown as InvRow[])
        setBorrows((borrowData ?? []) as unknown as BorrowRow[])

        // Index sessions by id for O(1) lookup
        const sessById = new Map<number, string | null>(
          ((sessData ?? []) as { id: number; finished_at: string | null }[])
            .map(s => [s.id, s.finished_at])
        )

        // Group discrepancy rows by session, preserving session_id DESC order
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
  }, [])

  // Load ledger trail whenever the selected component changes
  const loadLedger = useCallback(async (component: string) => {
    if (!component) { setLedger([]); return }
    setLedgerLoading(true)
    const { data, error: err } = await getSupabaseClient()
      .from('inventory_ledger')
      .select('id, component, delta, reason, session_id, created_at')
      .eq('component', component)
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
  }, [])

  useEffect(() => { loadLedger(selectedComponent) }, [selectedComponent, loadLedger])

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-500">Loading…</div>
  }
  if (error) {
    return <div className="flex-1 p-8 text-red-400">{error}</div>
  }

  return (
    <div className="flex-1 p-6 space-y-12">

      {/* ── 1. Current Inventory ─────────────────────────────────────────── */}
      <section>
        <SectionHeading>Current Inventory</SectionHeading>
        <TableWrap>
          <thead className="bg-slate-900 text-left">
            <tr><Th>Component</Th><Th>Qty</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {inventory.length === 0
              ? <EmptyRow cols={2} message="No inventory yet." />
              : inventory.map(r => (
                  <tr key={r.component} className="hover:bg-slate-900/50">
                    <td className="px-4 py-3 font-mono text-white">{r.component}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-cyan-400">{r.qty}</td>
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
          <p className="text-sm text-slate-600">No discrepancies recorded across any reconciled session.</p>
        ) : (
          <div className="space-y-6">
            {discSessions.map(s => (
              <div key={s.session_id}>
                <p className="text-xs text-slate-500 mb-2 font-mono">
                  Session #{s.session_id} · finished {fmtDateTime(s.finished_at)}
                </p>
                <TableWrap>
                  <thead className="bg-slate-900 text-left">
                    <tr>
                      <Th>Component</Th><Th>Expected</Th><Th>Counted</Th><Th>Difference</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {s.rows.map(r => (
                      <tr key={r.component} className="hover:bg-slate-900/50">
                        <td className="px-4 py-3 font-mono text-white">{r.component}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-300">{r.expected}</td>
                        <td className="px-4 py-3 tabular-nums text-slate-300">{r.counted}</td>
                        <td className="px-4 py-3 tabular-nums font-semibold">
                          <span className={r.difference > 0 ? 'text-cyan-400' : 'text-red-400'}>
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
          <thead className="bg-slate-900 text-left">
            <tr>
              <Th>Component</Th><Th>Qty</Th><Th>Borrower</Th>
              <Th>Taken</Th><Th>Due</Th><Th>Returned</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {borrows.length === 0
              ? <EmptyRow cols={6} message="No borrows yet." />
              : borrows.map(b => {
                  const outstanding = b.returned_at === null
                  const overdue = outstanding && new Date(b.due_at) < new Date()
                  return (
                    <tr
                      key={b.id}
                      className={`hover:bg-slate-900/50 ${outstanding ? '' : 'opacity-50'}`}
                    >
                      <td className="px-4 py-3 font-mono text-white">{b.component}</td>
                      <td className={`px-4 py-3 tabular-nums font-semibold ${outstanding ? 'text-amber-400' : 'text-slate-500'}`}>
                        {b.qty}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{b.borrower}</td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">{fmtDate(b.taken_at)}</td>
                      <td className="px-4 py-3 text-xs font-mono">
                        <span className={overdue ? 'text-red-400' : 'text-slate-500'}>
                          {fmtDate(b.due_at)}{overdue ? ' ⚠' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">
                        {b.returned_at
                          ? <span className="text-slate-500">{fmtDate(b.returned_at)}</span>
                          : <span className="text-amber-400">Outstanding</span>}
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
          <label className="text-xs text-slate-500 uppercase tracking-wider shrink-0">
            Component
          </label>
          <select
            value={selectedComponent}
            onChange={e => setSelectedComponent(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-600 min-w-[180px]"
          >
            <option value="">Select…</option>
            {inventory.map(r => (
              <option key={r.component} value={r.component}>{r.component}</option>
            ))}
          </select>
        </div>

        {!selectedComponent ? (
          <p className="text-sm text-slate-600">Select a component above to trace its ledger history.</p>
        ) : ledgerLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <TableWrap>
            <thead className="bg-slate-900 text-left">
              <tr><Th>Date</Th><Th>Reason</Th><Th>Delta</Th><Th>Balance</Th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {ledger.length === 0
                ? <EmptyRow cols={4} message="No ledger entries." />
                : ledger.map(row => (
                    <tr key={row.id} className="hover:bg-slate-900/50">
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">
                        {fmtDateTime(row.created_at)}
                      </td>
                      <td className={`px-4 py-3 font-mono text-xs ${REASON_CLS[row.reason] ?? 'text-slate-400'}`}>
                        {row.reason}
                      </td>
                      <td className="px-4 py-3 tabular-nums font-semibold">
                        <span className={row.delta >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {row.delta >= 0 ? '+' : ''}{row.delta}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-200 font-semibold">
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
