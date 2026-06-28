'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'

interface ComponentRow {
  id: number
  name: string
  weight_mg: number
  tolerance_mg: number
  bin_idx: number
  created_at: string
}

const ALL_BINS = [0, 1, 2, 3, 4, 5] as const
const EMPTY_FORM = { name: '', weight_mg: '', tolerance_mg: '50', bin_idx: '' }

const INPUT_CLS =
  'bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-600'

function findOverlap(
  components: ComponentRow[],
  weight: number,
  tolerance: number,
  excludeId?: number,
): ComponentRow | undefined {
  const lo = weight - tolerance
  const hi = weight + tolerance
  return components.find(c => {
    if (excludeId !== undefined && c.id === excludeId) return false
    return lo <= c.weight_mg + c.tolerance_mg && c.weight_mg - c.tolerance_mg <= hi
  })
}

export default function ComponentsPage() {
  const [components, setComponents] = useState<ComponentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ComponentRow | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await getSupabaseClient()
      .from('components')
      .select('*')
      .order('bin_idx', { ascending: true })
    setComponents((data ?? []) as unknown as ComponentRow[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Live overlap warning — recomputes whenever weight/tolerance or the list changes
  useEffect(() => {
    const w = Number(form.weight_mg)
    const t = Number(form.tolerance_mg)
    if (!form.weight_mg || !form.tolerance_mg || w <= 0 || t <= 0) {
      setOverlapWarning(null)
      return
    }
    const clash = findOverlap(components, w, t, editing?.id)
    setOverlapWarning(
      clash
        ? `Weight window [${w - t}–${w + t}] mg overlaps "${clash.name}" ` +
          `([${clash.weight_mg - clash.tolerance_mg}–${clash.weight_mg + clash.tolerance_mg}] mg) ` +
          `— sorter cannot distinguish them by weight.`
        : null,
    )
  }, [form.weight_mg, form.tolerance_mg, components, editing?.id])

  // Bins used by all components except the one currently being edited
  const takenBins = new Set(
    components.filter(c => !editing || c.id !== editing.id).map(c => c.bin_idx),
  )
  const availableBins = ALL_BINS.filter(b => !takenBins.has(b))

  function startEdit(c: ComponentRow) {
    setEditing(c)
    setForm({
      name: c.name,
      weight_mg: String(c.weight_mg),
      tolerance_mg: String(c.tolerance_mg),
      bin_idx: String(c.bin_idx),
    })
    setFormError(null)
  }

  function cancelEdit() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setOverlapWarning(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)

    const payload = {
      name: form.name.trim(),
      weight_mg: Number(form.weight_mg),
      tolerance_mg: Number(form.tolerance_mg),
      bin_idx: Number(form.bin_idx),
      ...(editing ? { id: editing.id } : {}),
    }

    const res = await fetch('/api/components', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const body = (await res.json()) as { error: string | object }
      setFormError(
        body.error === 'bin_taken'
          ? 'That bin is already assigned to another component.'
          : typeof body.error === 'string'
          ? body.error
          : JSON.stringify(body.error),
      )
      setSubmitting(false)
      return
    }

    cancelEdit()
    await load()
    setSubmitting(false)
  }

  async function handleDelete(c: ComponentRow) {
    setDeleteError(null)
    const res = await fetch('/api/components', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id }),
    })
    if (!res.ok) {
      const body = (await res.json()) as { error: string }
      setDeleteError(body.error ?? 'Delete failed')
    } else {
      if (editing?.id === c.id) cancelEdit()
      await load()
    }
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-slate-500">Loading…</div>
  }

  return (
    <div className="flex-1 p-6 space-y-10">

      {/* ── Register / Edit form ── */}
      <section>
        <h2 className="text-lg font-semibold text-slate-200 mb-4">
          {editing ? `Edit "${editing.name}"` : 'Register Component'}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 uppercase tracking-wider">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
              placeholder="e.g. 10kΩ"
              className={`${INPUT_CLS} w-36`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 uppercase tracking-wider">Weight (mg)</label>
            <input
              type="number"
              min={1}
              value={form.weight_mg}
              onChange={e => setForm(f => ({ ...f, weight_mg: e.target.value }))}
              required
              className={`${INPUT_CLS} w-28`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 uppercase tracking-wider">Tolerance (mg)</label>
            <input
              type="number"
              min={1}
              value={form.tolerance_mg}
              onChange={e => setForm(f => ({ ...f, tolerance_mg: e.target.value }))}
              required
              className={`${INPUT_CLS} w-28`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 uppercase tracking-wider">Bin</label>
            <select
              value={form.bin_idx}
              onChange={e => setForm(f => ({ ...f, bin_idx: e.target.value }))}
              required
              className={`${INPUT_CLS} w-24`}
            >
              <option value="">—</option>
              {availableBins.map(b => (
                <option key={b} value={b}>Bin {b}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Saving…' : editing ? 'Update' : 'Register'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={cancelEdit}
                className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {overlapWarning && (
          <p className="mt-3 text-amber-400 text-sm">⚠ {overlapWarning}</p>
        )}
        {formError && <p className="mt-2 text-red-400 text-sm">{formError}</p>}
      </section>

      {/* ── Registered components table ── */}
      <section>
        <h2 className="text-lg font-semibold text-slate-200 mb-4">
          Registered Components{' '}
          <span className="text-slate-500 font-normal text-base">
            ({components.length} / 6 bins)
          </span>
        </h2>
        {deleteError && <p className="mb-3 text-red-400 text-sm">{deleteError}</p>}

        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left">
              <tr>
                {['Bin', 'Name', 'Weight (mg)', 'Tolerance (mg)', 'Window (mg)', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-slate-400 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {components.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-600">
                    No components registered yet.
                  </td>
                </tr>
              ) : (
                components.map(c => (
                  <tr
                    key={c.id}
                    className={`hover:bg-slate-900/50 ${editing?.id === c.id ? 'bg-slate-900/80' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-700 text-cyan-400 font-bold text-xs">
                        {c.bin_idx}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white font-mono">{c.name}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-300">{c.weight_mg}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">±{c.tolerance_mg}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-500 font-mono text-xs">
                      {c.weight_mg - c.tolerance_mg}–{c.weight_mg + c.tolerance_mg}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => startEdit(c)}
                          className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          className="px-3 py-1 rounded bg-red-900/40 hover:bg-red-800/60 text-red-400 text-xs font-medium transition-colors"
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
