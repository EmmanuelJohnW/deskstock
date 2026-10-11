import {
  COVERAGE_DAYS,
  CRITICAL_DAYS,
  LEAD_TIME_DAYS,
  MIN_HISTORY_DAYS,
  MONITOR_DAYS,
  MS_PER_DAY,
  WINDOW_DAYS,
} from './constants'
import type { ComponentForecast, ForecastOptions, ForecastStatus, LedgerEntry } from './types'

// Predicts when each component runs out:
//   days remaining = current stock ÷ average daily usage
// where usage is net consumption over the last WINDOW_DAYS — what left the
// shelf and didn't come back. Pure: no I/O, inputs are never mutated.

export const DEFAULT_FORECAST_OPTIONS: ForecastOptions = {
  windowDays: WINDOW_DAYS,
  minHistoryDays: MIN_HISTORY_DAYS,
  leadTimeDays: LEAD_TIME_DAYS,
  criticalDays: CRITICAL_DAYS,
  monitorDays: MONITOR_DAYS,
  coverageDays: COVERAGE_DAYS,
}

const ALERT_STATUSES: ReadonlySet<ForecastStatus> = new Set(['out_of_stock', 'critical', 'monitor'])

const STATUS_RANK: Record<ForecastStatus, number> = {
  out_of_stock: 0,
  critical: 1,
  monitor: 2,
  ok: 3,
  no_usage: 4,
  insufficient_data: 5,
}

export function isAlertStatus(status: ForecastStatus): boolean {
  return ALERT_STATUSES.has(status)
}

export function countAlerts(forecasts: readonly ComponentForecast[]): number {
  return forecasts.filter(f => isAlertStatus(f.status)).length
}

/**
 * How much a ledger entry contributes to consumption. Borrows, return
 * reversals and shortfalls (negative counts/adjustments) add; returns
 * subtract; baselines and restocks don't count. For consumables, returns
 * and their reversals are ignored: a "return" of a consumable is really a
 * restock (Add Stock matches incoming units against open loans).
 */
function usageOf(entry: LedgerEntry, isConsumable: boolean): number {
  switch (entry.reason) {
    case 'borrow':
      return Math.max(0, -entry.delta)
    case 'return_reversal':
      return isConsumable ? 0 : Math.max(0, -entry.delta)
    case 'return':
      return isConsumable ? 0 : -Math.max(0, entry.delta)
    case 'sort_session':
    case 'adjustment':
      return entry.delta < 0 ? -entry.delta : 0
    default:
      return 0
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

function groupByComponent(entries: readonly LedgerEntry[]): Map<string, LedgerEntry[]> {
  // Builds a fresh map (inputs untouched); local mutation keeps this linear
  // for large ledgers.
  const groups = new Map<string, LedgerEntry[]>()
  for (const entry of entries) {
    const existing = groups.get(entry.component)
    if (existing) existing.push(entry)
    else groups.set(entry.component, [entry])
  }
  return groups
}

function classify(
  stock: number,
  observedDays: number,
  avgDailyUsage: number,
  daysRemaining: number | null,
  options: ForecastOptions,
): ForecastStatus {
  if (stock <= 0) return 'out_of_stock'
  if (observedDays < options.minHistoryDays) return 'insufficient_data'
  if (avgDailyUsage <= 0 || daysRemaining === null) return 'no_usage'
  if (daysRemaining <= options.criticalDays) return 'critical'
  if (daysRemaining <= options.monitorDays) return 'monitor'
  return 'ok'
}

function forecastComponent(
  component: string,
  entries: readonly LedgerEntry[],
  currentStock: number,
  now: Date,
  options: ForecastOptions,
  isConsumable: boolean,
): ComponentForecast {
  const nowMs = now.getTime()
  const windowStartMs = nowMs - options.windowDays * MS_PER_DAY
  const times = entries.map(e => new Date(e.created_at).getTime())
  const firstEntryMs = times.length > 0 ? Math.min(...times) : nowMs
  const inWindow = entries.filter((_, i) => times[i] >= windowStartMs && times[i] <= nowMs)
  // Entries at the very start of the period (e.g. the first stocking of a
  // young component) count as already applied to the starting stock.
  const periodStartMs = Math.max(windowStartMs, firstEntryMs)
  const afterPeriodStart = entries.filter((_, i) => times[i] > periodStartMs && times[i] <= nowMs)

  const observedDays = Math.min(options.windowDays, (nowMs - firstEntryMs) / MS_PER_DAY)
  const usageInWindow = Math.max(0, inWindow.reduce((sum, e) => sum + usageOf(e, isConsumable), 0))
  const netChangeInPeriod = afterPeriodStart.reduce((sum, e) => sum + e.delta, 0)

  const hasEnoughHistory = observedDays >= options.minHistoryDays
  const avgDailyUsage = hasEnoughHistory && observedDays > 0 ? usageInWindow / observedDays : 0
  const canProject = hasEnoughHistory && avgDailyUsage > 0
  const daysRemaining = canProject ? Math.max(0, currentStock) / avgDailyUsage : null
  const stockoutDate = daysRemaining === null ? null : addDays(now, daysRemaining)

  return {
    component,
    currentStock,
    stockAtPeriodStart: currentStock - netChangeInPeriod,
    usageInWindow,
    observedDays,
    avgDailyUsage,
    daysRemaining,
    stockoutDate,
    reorderBy: stockoutDate === null ? null : addDays(stockoutDate, -options.leadTimeDays),
    recommendedQty: Math.max(0, Math.ceil(avgDailyUsage * options.coverageDays) - currentStock),
    status: classify(currentStock, observedDays, avgDailyUsage, daysRemaining, options),
    isConsumable,
  }
}

function byUrgency(a: ComponentForecast, b: ComponentForecast): number {
  const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
  if (rank !== 0) return rank
  const aDays = a.daysRemaining ?? Number.POSITIVE_INFINITY
  const bDays = b.daysRemaining ?? Number.POSITIVE_INFINITY
  if (aDays !== bDays) return aDays - bDays
  return a.component.localeCompare(b.component)
}

/**
 * Forecast every component that has stock or ledger history, most urgent
 * first. A component missing from `currentStock` is treated as 0 in stock.
 * `consumables` names the components that get used up rather than returned.
 */
export function computeForecasts(
  entries: readonly LedgerEntry[],
  currentStock: Readonly<Record<string, number>>,
  now: Date,
  overrides: Partial<ForecastOptions> = {},
  consumables: ReadonlySet<string> = new Set(),
): ComponentForecast[] {
  const options = { ...DEFAULT_FORECAST_OPTIONS, ...overrides }
  const grouped = groupByComponent(entries)
  const components = new Set([...Object.keys(currentStock), ...grouped.keys()])

  return [...components]
    .map(component =>
      forecastComponent(
        component,
        grouped.get(component) ?? [],
        currentStock[component] ?? 0,
        now,
        options,
        consumables.has(component),
      ),
    )
    .sort(byUrgency)
}
