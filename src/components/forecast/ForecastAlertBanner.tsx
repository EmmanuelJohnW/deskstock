'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AlertTriangle, X } from 'lucide-react'
import { useForecasts } from '@/lib/forecast/context'
import { isAlertStatus } from '@/lib/forecast/forecast'
import { describeAlert } from '@/lib/forecast/format'
import type { ComponentForecast } from '@/lib/forecast/types'

const MAX_NAMED = 3
const DISMISS_KEY = 'deskstock.forecastBannerDismissed'

/** Identifies the current set of alerts, so a dismissal only hides this set. */
function alertSignature(alerts: readonly ComponentForecast[]): string {
  return alerts.map(f => `${f.component}:${f.status}`).join('|')
}

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

function writeDismissed(signature: string): void {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, signature)
  } catch {
    // Storage unavailable (private mode) — dismissal just won't persist.
  }
}

/**
 * Early-warning banner: shown on every page (except /forecast) while any
 * component is out of stock, critical or needs monitoring.
 */
export function ForecastAlertBanner() {
  const pathname = usePathname()
  const { forecasts } = useForecasts()
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    setDismissed(readDismissed())
  }, [])

  const alerts = forecasts.filter(f => isAlertStatus(f.status))
  const signature = alertSignature(alerts)
  if (alerts.length === 0 || pathname === '/forecast' || dismissed === signature) return null

  const isUrgent = alerts.some(f => f.status === 'out_of_stock' || f.status === 'critical')
  const toneCls = isUrgent
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-orange-50 border-orange-200 text-orange-800'
  const named = alerts.slice(0, MAX_NAMED)
  const remaining = alerts.length - named.length

  function dismiss() {
    writeDismissed(signature)
    setDismissed(signature)
  }

  return (
    <div role="alert" className={`flex items-start gap-3 border-b px-4 py-2.5 text-sm sm:px-6 ${toneCls}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">
          {alerts.length} component{alerts.length === 1 ? '' : 's'} may run out soon:
        </span>{' '}
        {named.map((f, i) => (
          <span key={f.component}>
            {i > 0 && ', '}
            {f.component} ({describeAlert(f)})
          </span>
        ))}
        {remaining > 0 && ` and ${remaining} more`}.{' '}
        <Link href="/forecast" className="font-semibold underline underline-offset-2">
          View forecast
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss stock alert"
        className="shrink-0 rounded p-0.5 hover:bg-black/5"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}
