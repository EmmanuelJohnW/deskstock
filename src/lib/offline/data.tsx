'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useInventory } from '@/lib/inventory/context'
import { mergeSnapshot } from './apply'
import { useConnectivity } from './connectivity'
import { isNetworkError } from './network'
import { validateBorrow } from './outbox'
import { fetchSnapshot } from './snapshot'
import { loadSnapshot, saveSnapshot } from './store'
import { sendOp } from './sync'
import type { InventoryView, Op, Snapshot } from './types'

// The one place pages and the forecast get inventory data from. Online it
// fetches fresh data and saves a copy on the laptop; offline it uses that copy.
// Either way, actions not yet synced are applied on top (mergeSnapshot), so
// the screens always show the latest state.

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

export interface ActionResult {
  ok: boolean
  /** Saved on the laptop, will sync later. */
  queued?: boolean
  error?: string
}

interface InventoryDataValue {
  view: InventoryView | null
  loading: boolean
  /** Set when there's nothing to show: no saved copy and no connection. */
  error: string | null
  refresh: () => Promise<void>
  borrow: (input: { component: string; qty: number; borrower: string; due_at: string }) => Promise<ActionResult>
  returnBorrow: (borrowId: string) => Promise<ActionResult>
  undoReturn: (borrowId: string) => Promise<ActionResult>
  addStock: (input: { component: string; qty: number }) => Promise<ActionResult>
  createComponent: (input: { name: string; weight_g: number }) => Promise<ActionResult>
  updateComponent: (input: { componentId: number; name: string; weight_g: number }) => Promise<ActionResult>
  deleteComponent: (componentId: number) => Promise<ActionResult>
}

const InventoryDataContext = createContext<InventoryDataValue | null>(null)

type OpInput = Pick<Op, 'type' | 'payload'>

function newOp(inventoryId: number, input: OpInput): Op {
  return {
    ...input,
    id: crypto.randomUUID(),
    inventoryId,
    createdAt: new Date().toISOString(),
    status: 'pending',
  } as Op
}

/** Temporary ids for components created offline are negative, so they never clash. */
function nextTempId(view: InventoryView | null): number {
  const lowest = Math.min(0, ...(view?.components.map(c => c.id) ?? []))
  return lowest - 1
}

function isNameTaken(view: InventoryView | null, name: string, exceptId?: number): boolean {
  const wanted = name.trim().toLowerCase()
  return !!view?.components.some(c => c.id !== exceptId && c.name.trim().toLowerCase() === wanted)
}

export function InventoryDataProvider({ children }: { children: React.ReactNode }) {
  const { selectedInventoryId } = useInventory()
  const { isOffline, ops, syncVersion, reportNetworkFailure, addOp, pruneConfirmed, syncNow } = useConnectivity()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const latestRequest = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current
    const isCurrent = () => latestRequest.current === requestId
    if (selectedInventoryId === null) {
      setSnapshot(null)
      setLoading(false)
      return
    }

    const saved = await loadSnapshot(selectedInventoryId).catch(() => undefined)
    if (!isCurrent()) return
    if (saved) {
      setSnapshot(saved)
      setLoading(false)
    }

    if (isOffline) {
      setError(saved ? null : 'This inventory has no saved copy on this laptop yet. Open it once while online.')
      setLoading(false)
      return
    }

    try {
      const fresh = await fetchSnapshot(selectedInventoryId)
      if (!isCurrent()) return
      setSnapshot(fresh)
      setError(null)
      try {
        await saveSnapshot(fresh)
      } catch (saveErr) {
        // Still show fresh data; it just won't be available offline.
        console.error('[InventoryData] could not save the offline copy:', saveErr)
        return
      }
      if (isCurrent()) pruneConfirmed(selectedInventoryId, fresh.fetchedAt)
    } catch (err) {
      if (!isCurrent()) return
      if (isNetworkError(err)) {
        reportNetworkFailure()
        setError(saved ? null : 'No connection, and no saved copy of this inventory yet.')
      } else {
        console.error('[InventoryData] load failed:', err)
        setError(saved ? null : 'Could not load inventory data.')
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [selectedInventoryId, isOffline, reportNetworkFailure, pruneConfirmed])

  // Show the saved copy for a newly selected inventory straight away.
  useEffect(() => {
    setLoading(true)
    setSnapshot(null)
    setError(null)
  }, [selectedInventoryId])

  useEffect(() => {
    refresh()
  }, [refresh, syncVersion])

  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const view = useMemo(() => (snapshot ? mergeSnapshot(snapshot, ops) : null), [snapshot, ops])

  /**
   * Online: send straight to the server (errors show in the form). Offline, or
   * if the connection drops mid-request: save the action to sync later.
   */
  const submit = useCallback(
    async (input: OpInput, validate?: () => string | null): Promise<ActionResult> => {
      if (selectedInventoryId === null) return { ok: false, error: 'No inventory selected' }
      const op = newOp(selectedInventoryId, input)

      const queue = async (): Promise<ActionResult> => {
        const problem = validate?.()
        if (problem) return { ok: false, error: problem }
        try {
          await addOp(op)
        } catch (err) {
          console.error('[InventoryData] could not save the action on this laptop:', err)
          return { ok: false, error: 'Could not save this change on the laptop. Check browser storage and try again.' }
        }
        return { ok: true, queued: true }
      }

      if (isOffline) return queue()

      // Older changes are still waiting: queue behind them so the order is kept.
      if (ops.some(o => o.status === 'pending')) {
        const result = await queue()
        if (result.ok) syncNow()
        return result
      }

      const result = await sendOp(op)
      if (result.kind === 'ok') {
        await refresh()
        return { ok: true }
      }
      if (result.kind === 'network') {
        reportNetworkFailure()
        return queue()
      }
      return { ok: false, error: result.error }
    },
    [selectedInventoryId, isOffline, ops, addOp, refresh, reportNetworkFailure, syncNow],
  )

  const value = useMemo<InventoryDataValue>(
    () => ({
      view,
      loading,
      error,
      refresh,
      borrow: input =>
        submit({ type: 'create_borrow', payload: input }, () =>
          view ? validateBorrow(view, input.component, input.qty) : null,
        ),
      returnBorrow: borrowId => submit({ type: 'return_borrow', payload: { borrowId } }),
      undoReturn: borrowId => submit({ type: 'undo_return', payload: { borrowId } }),
      addStock: input => submit({ type: 'add_stock', payload: input }),
      createComponent: input =>
        submit({ type: 'create_component', payload: { ...input, tempId: nextTempId(view) } }, () =>
          isNameTaken(view, input.name) ? 'A component with that name already exists' : null,
        ),
      updateComponent: input =>
        submit({ type: 'update_component', payload: input }, () =>
          isNameTaken(view, input.name, input.componentId) ? 'A component with that name already exists' : null,
        ),
      deleteComponent: componentId => submit({ type: 'delete_component', payload: { componentId } }),
    }),
    [view, loading, error, refresh, submit],
  )

  return <InventoryDataContext.Provider value={value}>{children}</InventoryDataContext.Provider>
}

export function useInventoryData(): InventoryDataValue {
  const ctx = useContext(InventoryDataContext)
  if (!ctx) throw new Error('useInventoryData must be used within an InventoryDataProvider')
  return ctx
}
