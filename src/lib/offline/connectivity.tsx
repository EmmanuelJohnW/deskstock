'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { discardOp, enqueue, mergeProgress, retryOp } from './outbox'
import { isForcedOffline, FORCE_OFFLINE_KEY } from './network'
import { loadOutbox, saveOutbox } from './store'
import { runSync, sendOp } from './sync'
import type { Op } from './types'

// Tracks whether the dashboard can reach the server, owns the queue of actions
// made offline, and syncs that queue when the connection is back.

const PING_INTERVAL_MS = 10_000
const AUTO_SYNC_INTERVAL_MS = 60_000
const SYNC_LOCK = 'deskstock-sync'
const OUTBOX_LOCK = 'deskstock-outbox'
const CHANNEL = 'deskstock-outbox'

interface ConnectivityValue {
  isOffline: boolean
  isSyncing: boolean
  ops: Op[]
  /** Bumped after a sync run that changed something, so data providers refetch. */
  syncVersion: number
  lastSyncAt: string | null
  reportNetworkFailure: () => void
  /** Saves an action to the queue. Throws if the laptop's storage refuses it. */
  addOp: (op: Op) => Promise<void>
  /** Drops confirmed actions that a fresh snapshot already includes. */
  pruneConfirmed: (inventoryId: number, fetchedAt: string) => void
  syncNow: () => Promise<void>
  retry: (opId: string) => Promise<void>
  discard: (opId: string) => Promise<void>
  /** Simulate being offline on this browser (for testing and demos). */
  isForcedOffline: boolean
  setForcedOffline: (on: boolean) => void
}

const ConnectivityContext = createContext<ConnectivityValue | null>(null)

async function canReachServer(): Promise<boolean> {
  try {
    const res = await fetch('/api/inventories', { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Runs `fn` while holding a browser-wide lock (shared by all tabs). With
 * `ifAvailable`, skips instead of waiting when another tab holds it.
 */
async function withLock(name: string, fn: () => Promise<void>, ifAvailable = false): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    await fn()
    return
  }
  await navigator.locks.request(name, { ifAvailable }, async lock => {
    if (lock) await fn()
  })
}

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const [ops, setOps] = useState<Op[]>([])
  const [isOffline, setIsOffline] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncVersion, setSyncVersion] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [forced, setForced] = useState(false)
  const opsRef = useRef<Op[]>([])
  const isOfflineRef = useRef(false)
  const isSyncingRef = useRef(false)
  const channelRef = useRef<BroadcastChannel | null>(null)

  const show = useCallback((next: Op[]) => {
    opsRef.current = next
    setOps(next)
  }, [])

  /**
   * Every queue change reads the saved queue, applies `update` and writes it
   * back under one cross-tab lock, so tabs never overwrite each other's actions.
   */
  const updateOps = useCallback(
    (update: (current: Op[]) => Op[]) =>
      withLock(OUTBOX_LOCK, async () => {
        const next = update(await loadOutbox())
        await saveOutbox(next)
        show(next)
        channelRef.current?.postMessage('changed')
      }),
    [show],
  )

  const reloadOps = useCallback(
    () =>
      withLock(OUTBOX_LOCK, async () => {
        show(await loadOutbox())
      }).catch(err => console.error('[connectivity] could not load the offline queue:', err)),
    [show],
  )

  // Load the saved queue, keep it in step with other tabs, and ask the browser
  // not to evict the laptop's offline data.
  useEffect(() => {
    reloadOps()
    navigator.storage?.persist?.().catch(() => {})
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = () => reloadOps()
    channelRef.current = channel
    return () => channel.close()
  }, [reloadOps])

  const setOffline = useCallback((offline: boolean) => {
    isOfflineRef.current = offline
    setIsOffline(offline)
  }, [])

  // Online / offline detection: browser events, a forced-offline switch for
  // testing, and a ping while we think we're offline.
  const check = useCallback(async () => {
    setForced(isForcedOffline())
    if (isForcedOffline() || !navigator.onLine) {
      setOffline(true)
      return
    }
    setOffline(!(await canReachServer()))
  }, [setOffline])

  const setForcedOffline = useCallback(
    (on: boolean) => {
      try {
        if (on) window.localStorage.setItem(FORCE_OFFLINE_KEY, 'true')
        else window.localStorage.removeItem(FORCE_OFFLINE_KEY)
      } catch {
        // Storage unavailable: the switch just won't stick.
      }
      check()
    },
    [check],
  )

  useEffect(() => {
    check()
    const onStorage = (e: StorageEvent) => {
      if (e.key === FORCE_OFFLINE_KEY) check()
    }
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('online', check)
      window.removeEventListener('offline', check)
      window.removeEventListener('storage', onStorage)
    }
  }, [check])

  useEffect(() => {
    if (!isOffline) return
    const timer = setInterval(async () => {
      if (!isForcedOffline() && navigator.onLine && (await canReachServer())) setOffline(false)
    }, PING_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [isOffline, setOffline])

  const reportNetworkFailure = useCallback(() => setOffline(true), [setOffline])

  // Stable identity (reads state through refs), so finishing a sync doesn't
  // re-trigger the auto-sync effect. Failed sends wait for the next interval.
  const syncNow = useCallback(async () => {
    if (isOfflineRef.current || isSyncingRef.current || isForcedOffline()) return
    if (!opsRef.current.some(o => o.status === 'pending')) return
    isSyncingRef.current = true
    setIsSyncing(true)
    let changed = false
    try {
      await withLock(
        SYNC_LOCK,
        async () => {
          const start = await loadOutbox()
          const startStatus = new Map(start.map(o => [o.id, o.status]))
          const outcome = await runSync(start, op => sendOp(op), undefined, progressed =>
            updateOps(latest => mergeProgress(latest, progressed, startStatus)),
          )
          changed = outcome.changed
          if (outcome.stoppedOnNetwork) reportNetworkFailure()
        },
        true,
      )
      setLastSyncAt(new Date().toISOString())
    } catch (err) {
      console.error('[connectivity] sync failed:', err)
    } finally {
      isSyncingRef.current = false
      setIsSyncing(false)
      if (changed) setSyncVersion(v => v + 1)
    }
  }, [updateOps, reportNetworkFailure])

  // Sync when the connection comes back, periodically, and when the tab is shown.
  useEffect(() => {
    if (isOffline) return
    syncNow()
    const timer = setInterval(syncNow, AUTO_SYNC_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isOffline, syncNow])

  const addOp = useCallback((op: Op) => updateOps(current => enqueue(current, op)), [updateOps])

  const pruneConfirmed = useCallback(
    (inventoryId: number, fetchedAt: string) => {
      const isIncluded = (o: Op) =>
        o.status === 'confirmed' && o.inventoryId === inventoryId && (o.confirmedAt ?? '') <= fetchedAt
      if (!opsRef.current.some(isIncluded)) return
      updateOps(current => current.filter(o => !isIncluded(o))).catch(err =>
        console.error('[connectivity] could not tidy the offline queue:', err),
      )
    },
    [updateOps],
  )

  const retry = useCallback(
    async (opId: string) => {
      await updateOps(current => retryOp(current, opId))
      await syncNow()
    },
    [updateOps, syncNow],
  )

  const discard = useCallback((opId: string) => updateOps(current => discardOp(current, opId)), [updateOps])

  const value = useMemo(
    () => ({
      isOffline,
      isSyncing,
      ops,
      syncVersion,
      lastSyncAt,
      reportNetworkFailure,
      addOp,
      pruneConfirmed,
      syncNow,
      retry,
      discard,
      isForcedOffline: forced,
      setForcedOffline,
    }),
    [
      isOffline,
      isSyncing,
      ops,
      syncVersion,
      lastSyncAt,
      reportNetworkFailure,
      addOp,
      pruneConfirmed,
      syncNow,
      retry,
      discard,
      forced,
      setForcedOffline,
    ],
  )

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>
}

export function useConnectivity(): ConnectivityValue {
  const ctx = useContext(ConnectivityContext)
  if (!ctx) throw new Error('useConnectivity must be used within a ConnectivityProvider')
  return ctx
}
