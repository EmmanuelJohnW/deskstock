'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'

interface Borrow {
  id: string
  component: string
  qty: number
  borrower: string
  taken_at: string
  due_at: string
  returned_at: string | null
}

interface InventoryItem {
  component: string
  qty: number
}

const EMPTY_FORM = { component: '', qty: '1', borrower: '', due_at: '' }

function isOverdue(due_at: string): boolean {
  return new Date(due_at) < new Date()
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const INPUT_CLS =
  'bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-600'

export default function BorrowsPage() {
  const [borrows, setBorrows] = useState<Borrow[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [returnError, setReturnError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async () => {
    const supabase = getSupabaseClient()
    const [{ data: borrowData }, { data: invData }] = await Promise.all([
      supabase.from('borrows').select('*').order('taken_at', { ascending: false }),
      supabase.rpc('get_inventory'),
    ])
    setBorrows((borrowData ?? []) as unknown as Borrow[])
    setInventory((invData ?? []) as unknown as InventoryItem[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleBorrow(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      const res = await fetch('/api/borrows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component: form.component,
          qty: Number(form.qty),
          borrower: form.borrower,
          due_at: new Date(`${form.due_at}T23:59:59`).toISOString(),
        }),
      })
      if (!res.ok) {
        const body = (await res.json()) as { error: string | Record<string, unknown> }
        setFormError(
          body.error === 'insufficient_stock'
            ? 'Not enough in stock'
            : JSON.stringify(body.error)
        )
      } else {
        setForm(EMPTY_FORM)
        await load()
      }
    } catch {
      setFormError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReturn(borrowId: string) {
    setReturnError(null)
    const res = await fetch('/api/borrows/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrow_id: borrowId }),
    })
    if (!res.ok) {
      const body = (await res.json()) as { error: string }
      setReturnError(body.error ?? 'Return failed')
    } else {
      await load()
    }
  }

  const open = borrows.filter(b => !b.returned_at)
  const returned = borrows.filter(b => b.returned_at)

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-500">Loading…</div>
  }

  return (
    <div className="flex-1 p-6 space-y-10">

      {/* ── New Borrow form ── */}
      <section>
        <h2 className="text-lg font-semibold text-slate-200 mb-4">New Borrow</h2>
        <form onSubmit={handleBorrow} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 uppercase tracking-wider">Component</label>
            <select
              value={form.component}
              onChange={e => setForm(f => ({ ...f, component: e.target.value }))}
              required
              className={`${INPUT_CLS} min-w-[180px]`}
            >
              <option value="">Select…</option>
              {inventory.map(item => (
                <option key={item.component} value={item.component}>
                  {item.component} ({item.qty} available)
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 uppercase tracking-wider">Qty</label>
            <input
              type="number"
              min={1}
              value={form.qty}
              onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
              required
              className={`${INPUT_CLS} w-24`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 uppercase tracking-wider">Borrower</label>
            <input
              type="text"
              placeholder="Name"
              value={form.borrower}
              onChange={e => setForm(f => ({ ...f, borrower: e.target.value }))}
              required
              className={`${INPUT_CLS} w-40`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 uppercase tracking-wider">Due</label>
            <input
              type="date"
              value={form.due_at}
              onChange={e => setForm(f => ({ ...f, due_at: e.target.value }))}
              required
              className={INPUT_CLS}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Borrowing…' : 'Borrow'}
          </button>
        </form>
        {formError && <p className="mt-2 text-red-400 text-sm">{formError}</p>}
      </section>

      {/* ── Open borrows ── */}
      <section>
        <h2 className="text-lg font-semibold text-slate-200 mb-4">
          Open Borrows{' '}
          <span className="text-slate-500 font-normal text-base">({open.length})</span>
        </h2>
        {returnError && <p className="mb-3 text-red-400 text-sm">{returnError}</p>}
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left">
              <tr>
                {['Component', 'Qty', 'Borrower', 'Taken', 'Due', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-slate-400 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {open.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-600">
                    No open borrows.
                  </td>
                </tr>
              ) : (
                open.map(b => {
                  const overdue = isOverdue(b.due_at)
                  return (
                    <tr key={b.id} className="hover:bg-slate-900/50">
                      <td className="px-4 py-3 text-white font-mono">{b.component}</td>
                      <td className="px-4 py-3 text-cyan-400 tabular-nums font-semibold">
                        {b.qty}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{b.borrower}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                        {fmtDate(b.taken_at)}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">
                        <span className={overdue ? 'text-red-400' : 'text-slate-400'}>
                          {fmtDate(b.due_at)}
                          {overdue ? ' ⚠' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleReturn(b.id)}
                          className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium transition-colors"
                        >
                          Return
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Returned history ── */}
      <section>
        <button
          onClick={() => setShowHistory(h => !h)}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-300 text-sm transition-colors"
        >
          <span>{showHistory ? '▼' : '▶'}</span>
          Returned history ({returned.length})
        </button>
        {showHistory && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-left">
                <tr>
                  {['Component', 'Qty', 'Borrower', 'Taken', 'Returned'].map(h => (
                    <th key={h} className="px-4 py-3 text-slate-400 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {returned.map(b => (
                  <tr key={b.id} className="opacity-60 hover:opacity-80">
                    <td className="px-4 py-3 text-slate-300 font-mono">{b.component}</td>
                    <td className="px-4 py-3 text-slate-400 tabular-nums">{b.qty}</td>
                    <td className="px-4 py-3 text-slate-400">{b.borrower}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                      {fmtDate(b.taken_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                      {fmtDate(b.returned_at!)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
