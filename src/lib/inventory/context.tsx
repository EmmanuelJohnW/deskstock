'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useConnectivity } from '@/lib/offline/connectivity'
import { loadInventories, saveInventories } from '@/lib/offline/store'

export interface InventorySummary {
  id: number
  name: string
  created_at: string
}

interface ActionResult {
  success: boolean
  error?: string
}

interface InventoryContextValue {
  inventories: InventorySummary[]
  selectedInventoryId: number | null
  loading: boolean
  selectInventory: (id: number) => void
  createInventory: (name: string) => Promise<ActionResult>
  archiveInventory: (id: number) => Promise<ActionResult>
}

const STORAGE_KEY = 'deskstock.selectedInventoryId'

const InventoryContext = createContext<InventoryContextValue | null>(null)

function readStoredId(): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isNaN(parsed) ? null : parsed
}

interface InventoryProviderProps {
  children: React.ReactNode
}

export function InventoryProvider({ children }: InventoryProviderProps) {
  const [inventories, setInventories] = useState<InventorySummary[]>([])
  const [selectedInventoryId, setSelectedInventoryIdState] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const { isOffline, reportNetworkFailure } = useConnectivity()

  // Online: fetch the list and keep a copy on the laptop. Offline (or if the
  // request fails): use that copy.
  const fetchList = useCallback(async (): Promise<InventorySummary[]> => {
    if (!isOffline) {
      try {
        const res = await fetch('/api/inventories', { cache: 'no-store' })
        const body = (await res.json()) as { success: boolean; inventories?: InventorySummary[] }
        if (res.ok && body.inventories) {
          await saveInventories(body.inventories)
          return body.inventories
        }
      } catch {
        reportNetworkFailure()
      }
    }
    return loadInventories()
  }, [isOffline, reportNetworkFailure])

  const refresh = useCallback(async () => {
    const list = await fetchList()
    setInventories(list)
    setSelectedInventoryIdState(current => {
      const preferred = current ?? readStoredId()
      if (preferred && list.some(inv => inv.id === preferred)) return preferred
      return list[0]?.id ?? null
    })
    setLoading(false)
  }, [fetchList])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Push the current selection to the server as the device's active
  // inventory — this is what lets /api/run-config auto-open a session for
  // the right lab when the physical device is started, with no manual
  // "Start Count Session" click. Fires on manual switches and on the
  // initial auto-pick alike, so the device always has *some* active
  // inventory as soon as the dashboard has loaded one.
  // Skipped while offline (re-sent when the connection comes back), except on
  // the laptop hub, whose local server records it for the device's runs.
  useEffect(() => {
    if (selectedInventoryId === null || (isOffline && process.env.NEXT_PUBLIC_LOCAL_HUB !== 'true')) return
    fetch('/api/active-inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory_id: selectedInventoryId }),
    }).catch(() => {
      // Best-effort — a failed sync here just means the device falls back to
      // whatever active inventory was last set, or 409s with no_active_inventory.
    })
  }, [selectedInventoryId, isOffline])

  function selectInventory(id: number) {
    setSelectedInventoryIdState(id)
    window.localStorage.setItem(STORAGE_KEY, String(id))
  }

  async function createInventory(name: string): Promise<ActionResult> {
    if (isOffline) return { success: false, error: 'Creating an inventory needs an internet connection.' }
    const res = await fetch('/api/inventories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const body = (await res.json()) as { success: boolean; error?: string; inventory?: InventorySummary }
    if (!res.ok || !body.success) {
      return { success: false, error: body.error === 'name_taken' ? 'An inventory with that name already exists.' : 'Failed to create inventory' }
    }
    await refresh()
    if (body.inventory) selectInventory(body.inventory.id)
    return { success: true }
  }

  async function archiveInventory(id: number): Promise<ActionResult> {
    if (isOffline) return { success: false, error: 'Archiving an inventory needs an internet connection.' }
    const res = await fetch('/api/inventories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const body = (await res.json()) as { success: boolean; error?: string }
    if (!res.ok || !body.success) {
      return { success: false, error: 'Failed to archive inventory' }
    }
    if (selectedInventoryId === id) {
      setSelectedInventoryIdState(null)
      window.localStorage.removeItem(STORAGE_KEY)
    }
    await refresh()
    return { success: true }
  }

  return (
    <InventoryContext.Provider
      value={{ inventories, selectedInventoryId, loading, selectInventory, createInventory, archiveInventory }}
    >
      {children}
    </InventoryContext.Provider>
  )
}

export function useInventory(): InventoryContextValue {
  const ctx = useContext(InventoryContext)
  if (!ctx) throw new Error('useInventory must be used within an InventoryProvider')
  return ctx
}
