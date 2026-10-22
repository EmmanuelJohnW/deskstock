'use client'

import { useState } from 'react'
import { useInventory } from '@/lib/inventory/context'
import { useInventoryData } from '@/lib/offline/data'
import { ActionNotice, PendingTag } from '@/components/offline/PendingTag'

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
  'bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-emerald-500'

export default function BorrowsPage() {
  const { selectedInventoryId, loading: inventoryLoading } = useInventory()
  const { view, loading, error: loadError, borrow, returnBorrow, undoReturn } = useInventoryData()
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [returnError, setReturnError] = useState<string | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [notice, setNotice] = useState<{ message: string; queued: boolean } | null>(null)

  const borrows = view?.borrows ?? []
  const inventory = view?.stock ?? []

  async function handleBorrow(e: React.FormEvent) {
    e.preventDefault()
    if (selectedInventoryId === null) return
    setSubmitting(true)
    setFormError(null)
    setNotice(null)
    const result = await borrow({
      component: form.component,
      qty: Number(form.qty),
      borrower: form.borrower,
      due_at: new Date(`${form.due_at}T23:59:59`).toISOString(),
    })
    setSubmitting(false)
    if (!result.ok) {
      setFormError(result.error ?? 'Borrow failed')
      return
    }
    setNotice({ message: `${form.borrower} borrowed ${form.qty} × ${form.component}.`, queued: !!result.queued })
    setForm(EMPTY_FORM)
  }

  async function handleReturn(borrowId: string) {
    setReturnError(null)
    const result = await returnBorrow(borrowId)
    if (!result.ok) setReturnError(result.error ?? 'Return failed')
  }

  async function handleUndoReturn(borrowId: string) {
    setUndoError(null)
    const result = await undoReturn(borrowId)
    if (!result.ok) setUndoError(result.error ?? 'Undo failed')
  }

  const open = borrows.filter(b => !b.returned_at)
  const returned = borrows.filter(b => b.returned_at)

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
    <div className="flex-1 p-6 space-y-10">

      {/* ── New Borrow form ── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">New Borrow</h2>
        <form onSubmit={handleBorrow} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Component</label>
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
            <label className="text-xs text-gray-500 uppercase tracking-wider">Qty</label>
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
            <label className="text-xs text-gray-500 uppercase tracking-wider">Borrower</label>
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
            <label className="text-xs text-gray-500 uppercase tracking-wider">Due</label>
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
            className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Borrowing…' : 'Borrow'}
          </button>
        </form>
        {formError && <p className="mt-2 text-red-600 text-sm">{formError}</p>}
        {notice && <ActionNotice queued={notice.queued} message={notice.message} />}
      </section>

      {/* ── Open borrows ── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Open Borrows{' '}
          <span className="text-gray-400 font-normal text-base">({open.length})</span>
        </h2>
        {returnError && <p className="mb-3 text-red-600 text-sm">{returnError}</p>}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                {['Component', 'Qty', 'Borrower', 'Taken', 'Due', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-gray-500 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {open.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No open borrows.
                  </td>
                </tr>
              ) : (
                open.map(b => {
                  const overdue = isOverdue(b.due_at)
                  return (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900 font-mono">
                        {b.component}
                        {b.pending && <PendingTag />}
                      </td>
                      <td className="px-4 py-3 text-emerald-600 tabular-nums font-semibold">
                        {b.qty}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{b.borrower}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                        {fmtDate(b.taken_at)}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">
                        <span className={overdue ? 'text-red-600' : 'text-gray-400'}>
                          {fmtDate(b.due_at)}
                          {overdue ? ' ⚠' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleReturn(b.id)}
                          className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition-colors"
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
          className="flex items-center gap-2 text-gray-400 hover:text-gray-700 text-sm transition-colors"
        >
          <span>{showHistory ? '▼' : '▶'}</span>
          Returned history ({returned.length})
        </button>
        {undoError && <p className="mt-3 text-red-600 text-sm">{undoError}</p>}
        {showHistory && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  {['Component', 'Qty', 'Borrower', 'Taken', 'Returned', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-gray-500 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {returned.map(b => (
                  <tr key={b.id} className="opacity-60 hover:opacity-80">
                    <td className="px-4 py-3 text-gray-700 font-mono">
                      {b.component}
                      {b.pending && <PendingTag />}
                    </td>
                    <td className="px-4 py-3 text-gray-500 tabular-nums">{b.qty}</td>
                    <td className="px-4 py-3 text-gray-500">{b.borrower}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                      {fmtDate(b.taken_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                      {fmtDate(b.returned_at!)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleUndoReturn(b.id)}
                        className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition-colors"
                      >
                        Undo
                      </button>
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
