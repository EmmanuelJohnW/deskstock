import { AlertTriangle, Package } from 'lucide-react'
import { isAlertStatus } from '@/lib/forecast/forecast'
import { formatDate, formatDays, formatRate } from '@/lib/forecast/format'
import type { ComponentForecast, ForecastStatus } from '@/lib/forecast/types'
import { StatusBadge } from './StatusBadge'

const DAYS_CLS: Record<ForecastStatus, string> = {
  out_of_stock: 'text-red-600',
  critical: 'text-red-600',
  monitor: 'text-orange-600',
  ok: 'text-emerald-600',
  no_usage: 'text-gray-400',
  insufficient_data: 'text-gray-400',
}

interface ForecastCardProps {
  forecast: ComponentForecast
  coverageDays: number
}

function Recommendation({ forecast, coverageDays }: ForecastCardProps) {
  const { status, stockoutDate, reorderBy, recommendedQty } = forecast
  const orderText =
    recommendedQty > 0 ? ` About ${recommendedQty} pcs would cover the next ${coverageDays} days.` : ''

  if (status === 'out_of_stock') {
    return <>None left on the shelf. Replenish now.{orderText}</>
  }
  if (!stockoutDate || !reorderBy) return null

  const reorderText =
    reorderBy.getTime() <= Date.now() ? 'Reorder now' : `Reorder by ${formatDate(reorderBy)}`
  return (
    <>
      Expected to run out around {formatDate(stockoutDate)} if usage continues at the current rate.{' '}
      {reorderText} to avoid a shortage.{orderText}
    </>
  )
}

export function ForecastCard({ forecast, coverageDays }: ForecastCardProps) {
  const { component, currentStock, stockAtPeriodStart, observedDays, avgDailyUsage, daysRemaining, status } = forecast
  const periodDays = Math.round(observedDays)
  const isAlert = isAlertStatus(status)

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4">
      <header className="flex items-start gap-3">
        <Package className="mt-0.5 h-5 w-5 shrink-0 text-gray-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-gray-900">{component}</h3>
          <p className="text-sm text-gray-500">
            {periodDays} days ago: {stockAtPeriodStart} pcs · Now: {currentStock} pcs
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4">
        <div>
          <dt className="text-xs text-gray-500">Average daily usage</dt>
          <dd className="text-lg font-semibold text-gray-900">{formatRate(avgDailyUsage)}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Estimated days remaining</dt>
          <dd className={`text-lg font-semibold ${DAYS_CLS[status]}`}>
            {status === 'out_of_stock' ? '0 days' : daysRemaining === null ? '—' : formatDays(daysRemaining)}
          </dd>
        </div>
      </dl>

      {isAlert && (
        <div className="mt-4 rounded-md bg-gray-50 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <AlertTriangle className={`h-4 w-4 ${DAYS_CLS[status]}`} aria-hidden />
            {status === 'out_of_stock' ? 'Out of stock' : 'Predicted stockout'}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            <Recommendation forecast={forecast} coverageDays={coverageDays} />
          </p>
        </div>
      )}
    </article>
  )
}
