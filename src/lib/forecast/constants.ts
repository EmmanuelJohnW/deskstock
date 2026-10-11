// Tunables for stockout forecasting. Days are calendar days.

/** How far back usage is averaged. */
export const WINDOW_DAYS = 30
/** A component needs this much ledger history before it gets a forecast. */
export const MIN_HISTORY_DAYS = 7
/** Assumed time between placing a replenishment order and stock arriving. */
export const LEAD_TIME_DAYS = 3
/** Days remaining at or below which a component is Critical. */
export const CRITICAL_DAYS = 3
/** Days remaining at or below which a component is flagged to Monitor. */
export const MONITOR_DAYS = 10
/** A replenishment order should cover this many days of usage. */
export const COVERAGE_DAYS = 30

export const MS_PER_DAY = 24 * 60 * 60 * 1000
