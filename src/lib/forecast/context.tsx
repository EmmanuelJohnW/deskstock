'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useInventory } from '@/lib/inventory/context'
import { computeForecasts } from './forecast'
import type { ComponentForecast, LedgerEntry } from './types'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000
// Supabase caps a single select at 1000 rows; page through the ledger so
// older history (which sets each component's first-seen date) isn't cut off.
const LEDGER_PAGE_SIZE = 1000

interface ForecastContextValue {
  forecasts: ComponentForecast[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

// Postgres "undefined column": the consumable migration hasn't been run yet.
const UNDEFINED_COLUMN = '42703'

const ForecastContext = createContext<ForecastContextValue | null>(null)

async function fetchLedger(inventoryId: number): Promise<LedgerEntry[]> {
  const supabase = getSupabaseClient()
  const fetchPage = async (from: number, acc: LedgerEntry[]): Promise<LedgerEntry[]> => {
    const { data, error } = await supabase
      .from('inventory_ledger')
      .select('component, delta, reason, created_at')
      .eq('inventory_id', inventoryId)
      .order('id', { ascending: true })
      .range(from, from + LEDGER_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = [...acc, ...((data ?? []) as LedgerEntry[])]
    return (data ?? []).length < LEDGER_PAGE_SIZE ? rows : fetchPage(from + LEDGER_PAGE_SIZE, rows)
  }
  return fetchPage(0, [])
}

async function fetchStock(inventoryId: number): Promise<Record<string, number>> {
  const { data, error } = await getSupabaseClient().rpc('get_inventory', { p_inventory_id: inventoryId })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { component: string; qty: number }[]
  return Object.fromEntries(rows.map(r => [r.component, Number(r.qty)]))
}

async function fetchConsumables(inventoryId: number): Promise<Set<string>> {
  const { data, error } = await getSupabaseClient()
    .from('components')
    .select('name')
    .eq('inventory_id', inventoryId)
    .eq('consumable', true)
  if (error?.code === UNDEFINED_COLUMN) return new Set()
  if (error) throw new Error(error.message)
  return new Set(((data ?? []) as { name: string }[]).map(r => r.name))
}

interface ForecastProviderProps {
  children: React.ReactNode
}

/**
 * Loads stockout forecasts for the inventory selected in the nav dropdown,
 * once, for everything below it (nav badge and Forecast page share it).
 * inventory_ledger has no realtime feed, so anything that changes stock
 * should call `refresh()` from useForecasts() afterwards.
 */
export function ForecastProvider({ children }: ForecastProviderProps) {
  const { selectedInventoryId } = useInventory()
  const [forecasts, setForecasts] = useState<ComponentForecast[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Each load gets an id; only the latest one may update state, so a slow
  // response for a previously selected inventory can't overwrite the current one.
  const latestRequest = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    const isCurrent = () => latestRequest.current === requestId

    if (selectedInventoryId === null) {
      setForecasts([])
      setError(null)
      setLoading(false)
      return
    }
    try {
      const [ledger, stock, consumables] = await Promise.all([
        fetchLedger(selectedInventoryId),
        fetchStock(selectedInventoryId),
        fetchConsumables(selectedInventoryId),
      ])
      if (!isCurrent()) return
      setForecasts(computeForecasts(ledger, stock, new Date(), {}, consumables))
      setError(null)
    } catch (err: unknown) {
      if (!isCurrent()) return
      console.error('[ForecastProvider] load failed:', err)
      setError('Could not load forecast data. Check your connection and try again.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [selectedInventoryId])

  useEffect(() => {
    setLoading(true)
    setForecasts([])
    refresh()
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    // Stock can change elsewhere (device runs, other users); catch up when
    // the user returns to this tab.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      latestRequest.current += 1 // invalidate any load still in flight
    }
  }, [refresh])

  return (
    <ForecastContext.Provider value={{ forecasts, loading, error, refresh }}>{children}</ForecastContext.Provider>
  )
}

export function useForecasts(): ForecastContextValue {
  const ctx = useContext(ForecastContext)
  if (!ctx) throw new Error('useForecasts must be used within a ForecastProvider')
  return ctx
}
