'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

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

  const refresh = useCallback(async () => {
    const res = await fetch('/api/inventories')
    const body = (await res.json()) as { success: boolean; inventories?: InventorySummary[] }
    const list = body.inventories ?? []
    setInventories(list)
    setSelectedInventoryIdState(current => {
      const preferred = current ?? readStoredId()
      if (preferred && list.some(inv => inv.id === preferred)) return preferred
      return list[0]?.id ?? null
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  function selectInventory(id: number) {
    setSelectedInventoryIdState(id)
    window.localStorage.setItem(STORAGE_KEY, String(id))
  }

  async function createInventory(name: string): Promise<ActionResult> {
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
