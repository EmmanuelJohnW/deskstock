'use client'

import { useEffect } from 'react'
import { ForecastCard } from '@/components/forecast/ForecastCard'
import { StatusBadge } from '@/components/forecast/StatusBadge'
import {
  COVERAGE_DAYS,
  CRITICAL_DAYS,
  LEAD_TIME_DAYS,
  MIN_HISTORY_DAYS,
  MONITOR_DAYS,
  WINDOW_DAYS,
} from '@/lib/forecast/constants'
import { STATUS_LABEL } from '@/lib/forecast/format'
import type { ComponentForecast, ForecastStatus } from '@/lib/forecast/types'
import { useForecasts } from '@/lib/forecast/context'
import { useInventory } from '@/lib/inventory/context'

const SUMMARY_STATUSES: ForecastStatus[] = ['out_of_stock', 'critical', 'monitor', 'ok']
const CARD_STATUSES: ReadonlySet<ForecastStatus> = new Set(SUMMARY_STATUSES)

const SUMMARY_CLS: Record<string, string> = {
  out_of_stock: 'text-red-700',
  critical: 'text-red-600',
  monitor: 'text-orange-600',
  ok: 'text-emerald-600',
}

function SummaryTiles({ forecasts }: { forecasts: ComponentForecast[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {SUMMARY_STATUSES.map(status => (
        <div key={status} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs text-gray-500">{STATUS_LABEL[status]}</p>
          <p className={`text-2xl font-semibold ${SUMMARY_CLS[status]}`}>
            {forecasts.filter(f => f.status === status).length}
          </p>
        </div>
      ))}
    </div>
  )
}

function UnforecastList({ forecasts }: { forecasts: ComponentForecast[] }) {
  if (forecasts.length === 0) return null
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Not forecast yet</h2>
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {forecasts.map(f => (
          <li key={f.component} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="truncate font-mono text-gray-900">{f.component}</span>
            <span className="flex items-center gap-3">
              <span className="text-gray-500">{f.currentStock} pcs</span>
              <StatusBadge status={f.status} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="mt-8 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
      <h2 className="mb-2 font-semibold text-gray-900">How this is calculated</h2>
      <p className="mb-2">
        <span className="font-medium text-gray-900">Days remaining = current stock ÷ average daily usage.</span>{' '}
        Usage is net consumption over the last {WINDOW_DAYS} days: parts borrowed and not returned, plus any
        shortfall found when stock is counted by the sorter. Restocks are not counted as usage.
      </p>
      <p>
        Critical at {CRITICAL_DAYS} days or less, Monitor at {MONITOR_DAYS} days or less. Reorder dates allow{' '}
        {LEAD_TIME_DAYS} days for delivery, and suggested quantities cover {COVERAGE_DAYS} days of usage. A
        component needs {MIN_HISTORY_DAYS} days of history before it is forecast.
      </p>
    </section>
  )
}

export default function ForecastPage() {
  const { selectedInventoryId, loading: inventoryLoading } = useInventory()
  const { forecasts, loading, error, refresh } = useForecasts()

  // Always show fresh numbers when the page is opened.
  useEffect(() => {
    refresh()
  }, [refresh])

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

  if (error && forecasts.length === 0) {
    return <div className="flex-1 p-8 text-red-600">{error}</div>
  }

  const carded = forecasts.filter(f => CARD_STATUSES.has(f.status))
  const unforecast = forecasts.filter(f => !CARD_STATUSES.has(f.status))

  return (
    <div className="flex-1 p-6">
      <h1 className="text-xl font-semibold text-gray-900">Forecast</h1>
      <p className="mb-6 text-sm text-gray-500">
        When each component is likely to run out, based on the last {WINDOW_DAYS} days of usage.
      </p>

      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error} Showing the last loaded forecast.
        </p>
      )}

      <SummaryTiles forecasts={forecasts} />

      {carded.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
          No forecasts yet — components need at least {MIN_HISTORY_DAYS} days of history with some usage.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {carded.map(f => (
            <ForecastCard key={f.component} forecast={f} coverageDays={COVERAGE_DAYS} />
          ))}
        </div>
      )}

      <UnforecastList forecasts={unforecast} />
      <HowItWorks />
    </div>
  )
}
