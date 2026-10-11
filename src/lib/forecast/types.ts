export interface LedgerEntry {
  component: string
  delta: number
  /** baseline | sort_session | adjustment | borrow | return | return_reversal */
  reason: string
  created_at: string
}

export type ForecastStatus =
  | 'out_of_stock'
  | 'critical'
  | 'monitor'
  | 'ok'
  | 'no_usage'
  | 'insufficient_data'

export interface ForecastOptions {
  windowDays: number
  minHistoryDays: number
  leadTimeDays: number
  criticalDays: number
  monitorDays: number
  coverageDays: number
}

export interface ComponentForecast {
  component: string
  currentStock: number
  /**
   * Stock at the start of the observed period — the "initial inventory".
   * For a component first stocked inside the window, that first stocking
   * is included.
   */
  stockAtPeriodStart: number
  /** Net consumption inside the window (never negative). */
  usageInWindow: number
  /** Days of history actually averaged over: min(window, age of first entry). */
  observedDays: number
  avgDailyUsage: number
  /** null when there's no usage to divide by. */
  daysRemaining: number | null
  stockoutDate: Date | null
  /** Latest date to order so stock arrives before the stockout. */
  reorderBy: Date | null
  /** Units to order to cover the coverage period at the current rate. */
  recommendedQty: number
  status: ForecastStatus
  /** Consumables are used up: returns don't offset their borrows. */
  isConsumable: boolean
}
