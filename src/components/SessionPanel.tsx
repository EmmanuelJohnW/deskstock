'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useInventory } from '@/lib/inventory/context'

// No frontend previously called POST /api/sessions or /api/sessions/[id]/finish —
// /api/ingest's "complete" handler 409s with no_open_session without one open,
// and discrepancies could never be reconciled from the dashboard. This panel is
// the missing control surface for that session lifecycle.

interface OpenSession {
  id: number
  operator: string | null
  started_at: string
  inventory_id: number
}

interface Discrepancy {
  component: string
  expected: number
  counted: number
  difference: number
}

interface FinishResult {
  discrepancy_count: number
  discrepancies: Discrepancy[]
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

const INPUT_CLS =
  'bg-white border border-gray-300 rounded px-3 py-1.5 text-gray-900 text-xs focus:outline-none focus:border-emerald-500'

export function SessionPanel() {
  const { inventories, selectedInventoryId } = useInventory()
  // undefined = still checking; null = no open session
  const [session, setSession] = useState<OpenSession | null | undefined>(undefined)
  const [operator, setOperator] = useState('')
  const [starting, setStarting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FinishResult | null>(null)

  const refresh = useCallback(async () => {
    const { data } = await getSupabaseClient()
      .from('count_sessions')
      .select('id, operator, started_at, inventory_id')
      .eq('status', 'open')
      .maybeSingle()
    setSession((data as OpenSession | null) ?? null)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleStart(e: React.FormEvent) {
    e.preventDefault()
    if (selectedInventoryId === null) return
    setStarting(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventory_id: selectedInventoryId,
          ...(operator.trim() ? { operator: operator.trim() } : {}),
        }),
      })
      const body = (await res.json()) as { success: boolean; error?: string }
      // session_already_open just means another tab beat us to it — refresh picks it up.
      if (!res.ok && body.error !== 'session_already_open') {
        setError(body.error ?? 'Failed to start session')
        return
      }
      setOperator('')
      await refresh()
    } catch {
      setError('Network error')
    } finally {
      setStarting(false)
    }
  }

  async function handleFinish() {
    if (!session) return
    setFinishing(true)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${session.id}/finish`, { method: 'POST' })
      const body = (await res.json()) as {
        success: boolean
        error?: string
        discrepancy_count?: number
        discrepancies?: Discrepancy[]
      }
      if (!res.ok || !body.success) {
        setError(body.error ?? 'Failed to finish session')
        return
      }
      setResult({ discrepancy_count: body.discrepancy_count ?? 0, discrepancies: body.discrepancies ?? [] })
      await refresh()
    } catch {
      setError('Network error')
    } finally {
      setFinishing(false)
    }
  }

  if (session === undefined) {
    return <div className="px-4 sm:px-6 py-2 text-xs text-gray-400">Checking count session…</div>
  }

  const sessionInventoryName = session
    ? inventories.find(inv => inv.id === session.inventory_id)?.name
    : undefined
  const sessionMatchesSelection = session ? session.inventory_id === selectedInventoryId : true

  return (
    <div className="px-4 sm:px-6 py-3 border-b border-gray-200 bg-white/60">
      {session ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-sm text-gray-900 font-medium">Count session #{session.id} open</span>
          <span className="text-xs text-gray-400">
            {sessionInventoryName ? `${sessionInventoryName} · ` : ''}
            {session.operator ? `${session.operator} · ` : ''}started {timeAgo(session.started_at)}
          </span>
          {!sessionMatchesSelection && (
            <span className="text-xs text-amber-600">
              (open for a different inventory than the one selected)
            </span>
          )}
          <button
            onClick={handleFinish}
            disabled={finishing}
            className="ml-auto px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            {finishing ? 'Finishing…' : 'Finish Count'}
          </button>
        </div>
      ) : (
        <form onSubmit={handleStart} className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-500">No active count session</span>
          <input
            type="text"
            placeholder="Operator (optional)"
            value={operator}
            onChange={e => setOperator(e.target.value)}
            className={`${INPUT_CLS} w-40`}
          />
          <button
            type="submit"
            disabled={starting || selectedInventoryId === null}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            {starting ? 'Starting…' : 'Start Count Session'}
          </button>
        </form>
      )}

      {error && <p className="mt-2 text-red-600 text-xs">{error}</p>}

      {result && (
        <div className="mt-3 text-xs">
          {result.discrepancy_count === 0 ? (
            <p className="text-gray-400">Reconciled — no discrepancies.</p>
          ) : (
            <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              <p className="font-medium mb-1">
                Reconciled with {result.discrepancy_count} discrepanc
                {result.discrepancy_count === 1 ? 'y' : 'ies'}:
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {result.discrepancies.map(d => (
                  <li key={d.component}>
                    {d.component}: expected {d.expected}, counted {d.counted} ({d.difference > 0 ? '+' : ''}
                    {d.difference})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
