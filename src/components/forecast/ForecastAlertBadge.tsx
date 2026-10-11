'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { countAlerts } from '@/lib/forecast/forecast'
import { useForecasts } from '@/lib/forecast/context'

/** Nav-bar early warning: how many components are out, critical or need monitoring. */
export function ForecastAlertBadge() {
  const { forecasts, error } = useForecasts()
  const alertCount = countAlerts(forecasts)
  if (error || alertCount === 0) return null

  const isUrgent = forecasts.some(f => f.status === 'out_of_stock' || f.status === 'critical')
  const colorCls = isUrgent ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
  const label = `${alertCount} component${alertCount === 1 ? '' : 's'} predicted to run out soon`

  return (
    <Link
      href="/forecast"
      title={label}
      aria-label={label}
      className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${colorCls}`}
    >
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      {alertCount}
    </Link>
  )
}
