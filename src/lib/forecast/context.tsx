'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useInventoryData } from '@/lib/offline/data'
import { computeForecasts } from './forecast'
import type { ComponentForecast } from './types'

// Forecasts are derived from the shared inventory data (src/lib/offline/data),
// so they reflect actions queued offline and update the moment stock changes.

/** Re-evaluate "today" periodically so days-remaining stays current on an open tab. */
const CLOCK_TICK_MS = 5 * 60 * 1000

interface ForecastContextValue {
  forecasts: ComponentForecast[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const ForecastContext = createContext<ForecastContextValue | null>(null)

interface ForecastProviderProps {
  children: React.ReactNode
}

export function ForecastProvider({ children }: ForecastProviderProps) {
  const { view, loading, error, refresh } = useInventoryData()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  // "Now" is read whenever the data changes (or the clock ticks), so actions
  // made a moment ago count as usage rather than as future entries.
  const forecasts = useMemo(() => {
    if (!view) return []
    const stock = Object.fromEntries(view.stock.map(s => [s.component, s.qty]))
    return computeForecasts(view.ledger, stock, new Date())
  }, [view, tick])

  const value = useMemo(() => ({ forecasts, loading, error, refresh }), [forecasts, loading, error, refresh])

  return <ForecastContext.Provider value={value}>{children}</ForecastContext.Provider>
}

export function useForecasts(): ForecastContextValue {
  const ctx = useContext(ForecastContext)
  if (!ctx) throw new Error('useForecasts must be used within a ForecastProvider')
  return ctx
}
