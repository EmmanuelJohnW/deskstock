import { describe, expect, test } from 'vitest'
import { computeForecasts, countAlerts, isAlertStatus } from './forecast'
import type { ComponentForecast, LedgerEntry } from './types'

const NOW = new Date('2026-10-10T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString()
}

function entry(component: string, delta: number, reason: string, ageDays: number): LedgerEntry {
  return { component, delta, reason, created_at: daysAgo(ageDays) }
}

/** Baseline long ago, then one borrow per day for `days` days. */
function dailyBorrows(component: string, perDay: number, days: number, baseline: number): LedgerEntry[] {
  return [
    entry(component, baseline, 'baseline', 60),
    ...Array.from({ length: days }, (_, i) => entry(component, -perDay, 'borrow', i + 0.5)),
  ]
}

function forecastFor(
  component: string,
  entries: LedgerEntry[],
  stock: Record<string, number>,
): ComponentForecast {
  const result = computeForecasts(entries, stock, NOW).find(f => f.component === component)
  if (!result) throw new Error(`no forecast for ${component}`)
  return result
}

describe('computeForecasts — spec example', () => {
  test('50 in stock at 10 per day gives 5 days remaining and Monitor', () => {
    // Arrange: 200 → 50 over 30 days is not 10/day, so model it directly:
    // 10 borrowed every day for the 30-day window, 50 left now.
    const entries = dailyBorrows('Resistors', 10, 30, 350)

    // Act
    const f = forecastFor('Resistors', entries, { Resistors: 50 })

    // Assert
    expect(f.avgDailyUsage).toBeCloseTo(10)
    expect(f.daysRemaining).toBeCloseTo(5)
    expect(f.status).toBe('monitor')
    expect(f.stockoutDate?.getTime()).toBeCloseTo(NOW.getTime() + 5 * DAY, -3)
  })

  test('starting stock is current stock minus net change over the period', () => {
    const entries = dailyBorrows('Resistors', 5, 30, 300)

    const f = forecastFor('Resistors', entries, { Resistors: 50 })

    expect(f.stockAtPeriodStart).toBe(200)
  })

  test('starting stock of a component first stocked inside the window includes that first stocking', () => {
    // Arrange: the mockup example — 200 added 15 days ago, 10 used per day since.
    const entries = [
      entry('Resistors', 200, 'adjustment', 15),
      ...Array.from({ length: 15 }, (_, i) => entry('Resistors', -10, 'borrow', i + 0.5)),
    ]

    // Act
    const f = forecastFor('Resistors', entries, { Resistors: 50 })

    // Assert
    expect(f.stockAtPeriodStart).toBe(200)
    expect(f.avgDailyUsage).toBeCloseTo(10)
    expect(f.daysRemaining).toBeCloseTo(5)
  })
})

describe('computeForecasts — what counts as usage', () => {
  test('returns offset borrows', () => {
    const entries = [
      entry('Multimeter', 10, 'baseline', 60),
      ...Array.from({ length: 30 }, (_, i) => entry('Multimeter', -2, 'borrow', i + 0.5)),
      ...Array.from({ length: 30 }, (_, i) => entry('Multimeter', 1, 'return', i + 0.25)),
    ]

    const f = forecastFor('Multimeter', entries, { Multimeter: 10 })

    expect(f.usageInWindow).toBe(30)
    expect(f.avgDailyUsage).toBeCloseTo(1)
  })

  test('a borrow fully returned is no usage', () => {
    const entries = [
      entry('Oscilloscope', 4, 'baseline', 60),
      entry('Oscilloscope', -1, 'borrow', 10),
      entry('Oscilloscope', 1, 'return', 9),
    ]

    const f = forecastFor('Oscilloscope', entries, { Oscilloscope: 4 })

    expect(f.usageInWindow).toBe(0)
    expect(f.status).toBe('no_usage')
    expect(f.daysRemaining).toBeNull()
  })

  test('a return reversal counts as usage again', () => {
    const entries = [
      entry('LED', 100, 'baseline', 60),
      entry('LED', -10, 'borrow', 10),
      entry('LED', 10, 'return', 9),
      entry('LED', -10, 'return_reversal', 8),
    ]

    const f = forecastFor('LED', entries, { LED: 90 })

    expect(f.usageInWindow).toBe(10)
  })

  test('a shortfall found by a count counts as usage', () => {
    const entries = [
      entry('Capacitor', 100, 'baseline', 60),
      entry('Capacitor', -30, 'sort_session', 5),
    ]

    const f = forecastFor('Capacitor', entries, { Capacitor: 70 })

    expect(f.usageInWindow).toBe(30)
  })

  test('a negative adjustment counts as usage', () => {
    const entries = [entry('Diode', 100, 'baseline', 60), entry('Diode', -6, 'adjustment', 5)]

    const f = forecastFor('Diode', entries, { Diode: 94 })

    expect(f.usageInWindow).toBe(6)
  })

  test('restocks and baselines are not usage', () => {
    const entries = [
      entry('Buzzer', 10, 'baseline', 20),
      entry('Buzzer', 50, 'adjustment', 10),
      entry('Buzzer', 5, 'sort_session', 5),
    ]

    const f = forecastFor('Buzzer', entries, { Buzzer: 65 })

    expect(f.usageInWindow).toBe(0)
  })

  test('usage is clamped at zero when returns exceed borrows in the window', () => {
    const entries = [
      entry('Probe', 5, 'baseline', 90),
      entry('Probe', -3, 'borrow', 45),
      entry('Probe', 3, 'return', 5),
    ]

    const f = forecastFor('Probe', entries, { Probe: 5 })

    expect(f.usageInWindow).toBe(0)
  })

  test('entries older than the window are ignored', () => {
    const entries = [
      entry('Switch', 100, 'baseline', 90),
      entry('Switch', -60, 'borrow', 45),
      entry('Switch', -3, 'borrow', 2),
    ]

    const f = forecastFor('Switch', entries, { Switch: 37 })

    expect(f.usageInWindow).toBe(3)
    expect(f.observedDays).toBe(30)
  })
})

describe('computeForecasts — status', () => {
  function statusFor(daysOfStock: number): string {
    // 1 per day over the full window, so days remaining == stock.
    const entries = dailyBorrows('Part', 1, 30, 100)
    return forecastFor('Part', entries, { Part: daysOfStock }).status
  }

  test('zero stock is out of stock', () => {
    expect(statusFor(0)).toBe('out_of_stock')
  })

  test('negative stock is out of stock', () => {
    expect(statusFor(-2)).toBe('out_of_stock')
  })

  test('at the critical threshold is critical', () => {
    expect(statusFor(3)).toBe('critical')
  })

  test('just above critical is monitor', () => {
    expect(statusFor(4)).toBe('monitor')
  })

  test('at the monitor threshold is monitor', () => {
    expect(statusFor(10)).toBe('monitor')
  })

  test('above the monitor threshold is ok', () => {
    expect(statusFor(11)).toBe('ok')
  })

  test('less history than the minimum is insufficient data', () => {
    const entries = [entry('New', 20, 'baseline', 3), entry('New', -5, 'borrow', 1)]

    const f = forecastFor('New', entries, { New: 15 })

    expect(f.status).toBe('insufficient_data')
    expect(f.daysRemaining).toBeNull()
    expect(f.stockoutDate).toBeNull()
  })

  test('out of stock wins over insufficient data', () => {
    const entries = [entry('New', 5, 'baseline', 3), entry('New', -5, 'borrow', 1)]

    expect(forecastFor('New', entries, { New: 0 }).status).toBe('out_of_stock')
  })

  test('history between minimum and window averages over its actual age', () => {
    const entries = [
      entry('Young', 100, 'baseline', 10),
      ...Array.from({ length: 10 }, (_, i) => entry('Young', -2, 'borrow', i + 0.5)),
    ]

    const f = forecastFor('Young', entries, { Young: 80 })

    expect(f.observedDays).toBeCloseTo(10)
    expect(f.avgDailyUsage).toBeCloseTo(2)
    expect(f.daysRemaining).toBeCloseTo(40)
  })
})

describe('computeForecasts — replenishment', () => {
  test('reorder by is the stockout date minus the lead time', () => {
    const entries = dailyBorrows('Resistors', 10, 30, 350)

    const f = forecastFor('Resistors', entries, { Resistors: 50 })

    expect(f.reorderBy?.getTime()).toBeCloseTo(NOW.getTime() + 2 * DAY, -3)
  })

  test('recommended quantity covers the coverage period minus current stock', () => {
    const entries = dailyBorrows('Resistors', 10, 30, 350)

    const f = forecastFor('Resistors', entries, { Resistors: 50 })

    expect(f.recommendedQty).toBe(250)
  })

  test('recommended quantity is never negative', () => {
    const entries = dailyBorrows('Resistors', 1, 30, 1000)

    const f = forecastFor('Resistors', entries, { Resistors: 500 })

    expect(f.recommendedQty).toBe(0)
  })

  test('options override the defaults', () => {
    const entries = dailyBorrows('Resistors', 10, 30, 350)

    const [f] = computeForecasts(entries, { Resistors: 50 }, NOW, { monitorDays: 4, leadTimeDays: 1 })

    expect(f.status).toBe('ok')
    expect(f.reorderBy?.getTime()).toBeCloseTo(NOW.getTime() + 4 * DAY, -3)
  })
})

describe('computeForecasts — components and ordering', () => {
  test('includes components in stock with no ledger history', () => {
    const forecasts = computeForecasts([], { Orphan: 5 }, NOW)

    expect(forecasts).toHaveLength(1)
    expect(forecasts[0]).toMatchObject({ component: 'Orphan', status: 'insufficient_data', observedDays: 0 })
  })

  test('includes components with ledger history but no stock row as zero stock', () => {
    const entries = dailyBorrows('Gone', 1, 30, 30)

    const f = forecastFor('Gone', entries, {})

    expect(f.currentStock).toBe(0)
    expect(f.status).toBe('out_of_stock')
  })

  test('sorts by urgency, then by days remaining', () => {
    const entries = [
      ...dailyBorrows('Fine', 1, 30, 100),
      ...dailyBorrows('Soon', 1, 30, 100),
      ...dailyBorrows('Sooner', 1, 30, 100),
      ...dailyBorrows('Empty', 1, 30, 100),
      entry('Idle', 10, 'baseline', 60),
      entry('Fresh', 10, 'baseline', 1),
    ]
    const stock = { Fine: 50, Soon: 9, Sooner: 5, Empty: 0, Idle: 10, Fresh: 10 }

    const order = computeForecasts(entries, stock, NOW).map(f => f.component)

    expect(order).toEqual(['Empty', 'Sooner', 'Soon', 'Fine', 'Idle', 'Fresh'])
  })

  test('does not mutate its inputs', () => {
    const entries = Object.freeze(dailyBorrows('Part', 1, 30, 100).map(e => Object.freeze(e)))
    const stock = Object.freeze({ Part: 5 })

    expect(() => computeForecasts(entries, stock, NOW)).not.toThrow()
  })
})

describe('alerts', () => {
  test('out of stock, critical and monitor are alert statuses', () => {
    expect(isAlertStatus('out_of_stock')).toBe(true)
    expect(isAlertStatus('critical')).toBe(true)
    expect(isAlertStatus('monitor')).toBe(true)
    expect(isAlertStatus('ok')).toBe(false)
    expect(isAlertStatus('no_usage')).toBe(false)
    expect(isAlertStatus('insufficient_data')).toBe(false)
  })

  test('countAlerts counts only alert statuses', () => {
    const entries = [...dailyBorrows('A', 1, 30, 100), ...dailyBorrows('B', 1, 30, 100)]

    const forecasts = computeForecasts(entries, { A: 2, B: 50 }, NOW)

    expect(countAlerts(forecasts)).toBe(1)
  })
})

describe('computeForecasts — Return button is the only return', () => {
  test('borrows never returned stay counted as used after a restock', () => {
    // Arrange: 2 borrowed per day and never returned, then a new box arrives.
    const entries = [
      entry('Wire', 100, 'baseline', 60),
      ...Array.from({ length: 30 }, (_, i) => entry('Wire', -2, 'borrow', i + 0.5)),
      entry('Wire', 30, 'adjustment', 1),
    ]

    // Act
    const f = forecastFor('Wire', entries, { Wire: 70 })

    // Assert
    expect(f.usageInWindow).toBe(60)
    expect(f.avgDailyUsage).toBeCloseTo(2)
  })

  test('items returned with the Return button are not counted as used', () => {
    const entries = [
      entry('Wire', 100, 'baseline', 60),
      ...Array.from({ length: 30 }, (_, i) => entry('Wire', -2, 'borrow', i + 0.5)),
      entry('Wire', 20, 'return', 1),
    ]

    const f = forecastFor('Wire', entries, { Wire: 60 })

    expect(f.usageInWindow).toBe(40)
  })
})
