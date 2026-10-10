import type { ComponentForecast, ForecastStatus } from './types'

export const STATUS_LABEL: Record<ForecastStatus, string> = {
  out_of_stock: 'Out of stock',
  critical: 'Critical',
  monitor: 'Monitor',
  ok: 'OK',
  no_usage: 'No recent usage',
  insufficient_data: 'Not enough data',
}

/** "<1 day", "1 day", "5 days", "12.5 days" → rounded to 1 decimal under 10. */
export function formatDays(days: number): string {
  if (days < 1) return '<1 day'
  const rounded = days < 10 ? Math.round(days * 10) / 10 : Math.round(days)
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`
}

/** Usage rate per day, e.g. "10 pcs", "0.4 pcs". */
export function formatRate(perDay: number): string {
  const rounded = perDay < 10 ? Math.round(perDay * 10) / 10 : Math.round(perDay)
  return `${rounded} pcs`
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Short phrase for alert banners: "out of stock", "5 days left". */
export function describeAlert(forecast: Pick<ComponentForecast, 'status' | 'daysRemaining'>): string {
  if (forecast.status === 'out_of_stock') return 'out of stock'
  if (forecast.daysRemaining === null) return STATUS_LABEL[forecast.status].toLowerCase()
  return `${formatDays(forecast.daysRemaining)} left`
}
