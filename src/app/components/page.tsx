'use client'

import { useState } from 'react'
import { useInventory } from '@/lib/inventory/context'
import { useInventoryData } from '@/lib/offline/data'
import { ActionNotice, PendingTag } from '@/components/offline/PendingTag'
import type { ComponentRow } from '@/lib/offline/types'

const EMPTY_FORM = { name: '', weight_g: '' }

const INPUT_CLS =
  'bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-emerald-500'

export default function ComponentsPage() {
  const { selectedInventoryId, loading: inventoryLoading } = useInventory()
  const { view, loading, error: loadError, createComponent, updateComponent, deleteComponent } = useInventoryData()
  const [editing, setEditing] = useState<ComponentRow | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ message: string; queued: boolean } | null>(null)

  const components = view?.components ?? []

  function startEdit(c: ComponentRow) {
    setEditing(c)
    setForm({ name: c.name, weight_g: String(c.weight_g) })
    setFormError(null)
  }

  function cancelEdit() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (selectedInventoryId === null) return
    setSubmitting(true)
    setFormError(null)
    setNotice(null)

    const fields = { name: form.name.trim(), weight_g: parseFloat(form.weight_g) }
    const result = editing
      ? await updateComponent({ componentId: editing.id, ...fields })
      : await createComponent(fields)
    setSubmitting(false)

    if (!result.ok) {
      setFormError(result.error ?? 'Save failed')
      return
    }
    setNotice({ message: `${editing ? 'Updated' : 'Registered'} ${fields.name}.`, queued: !!result.queued })
    cancelEdit()
  }

  async function handleDelete(c: ComponentRow) {
    if (selectedInventoryId === null) return
    setDeleteError(null)
    const result = await deleteComponent(c.id)
    if (!result.ok) {
      setDeleteError(result.error ?? 'Delete failed')
      return
    }
    if (editing?.id === c.id) cancelEdit()
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

  if (loadError) {
    return <div className="flex-1 p-8 text-red-600">{loadError}</div>
  }

  return (
    <div className="flex-1 p-6 space-y-10">

      {/* ── Register / Edit form ── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {editing ? `Edit "${editing.name}"` : 'Register Component'}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
              placeholder="e.g. 10kΩ"
              className={`${INPUT_CLS} w-40`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Weight (g)</label>
            <input
              type="number"
              step="0.001"
              min="0.001"
              value={form.weight_g}
              onChange={e => setForm(f => ({ ...f, weight_g: e.target.value }))}
              required
              placeholder="e.g. 0.240"
              className={`${INPUT_CLS} w-32`}
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Saving…' : editing ? 'Update' : 'Register'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={cancelEdit}
                className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {formError && <p className="mt-2 text-red-600 text-sm">{formError}</p>}
        {notice && <ActionNotice queued={notice.queued} message={notice.message} />}
      </section>

      {/* ── Component list ── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Registered Components{' '}
          <span className="text-gray-400 font-normal text-base">({components.length})</span>
        </h2>
        {deleteError && <p className="mb-3 text-red-600 text-sm">{deleteError}</p>}

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                {['Name', 'Weight (g)', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {components.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                    No components registered yet.
                  </td>
                </tr>
              ) : (
                components.map(c => (
                  <tr
                    key={c.id}
                    className={`hover:bg-gray-50 ${editing?.id === c.id ? 'bg-emerald-50' : ''}`}
                  >
                    <td className="px-4 py-3 text-gray-900 font-mono">
                      {c.name}
                      {c.pending && <PendingTag />}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-700 font-mono">
                      {Number(c.weight_g).toFixed(3)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => startEdit(c)}
                          className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          className="px-3 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
