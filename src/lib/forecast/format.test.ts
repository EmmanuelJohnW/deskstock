import { describe, expect, test } from 'vitest'
import { describeAlert, formatDays, formatRate } from './format'

describe('formatDays', () => {
  test('under a day reads as less than one day', () => {
    expect(formatDays(0.4)).toBe('<1 day')
  })

  test('exactly one day is singular', () => {
    expect(formatDays(1)).toBe('1 day')
  })

  test('under ten days keeps one decimal', () => {
    expect(formatDays(4.96)).toBe('5 days')
    expect(formatDays(2.25)).toBe('2.3 days')
  })

  test('ten days or more is rounded to whole days', () => {
    expect(formatDays(12.6)).toBe('13 days')
  })
})

describe('formatRate', () => {
  test('small rates keep one decimal', () => {
    expect(formatRate(0.43)).toBe('0.4 pcs')
  })

  test('larger rates are whole numbers', () => {
    expect(formatRate(10.4)).toBe('10 pcs')
  })
})

describe('describeAlert', () => {
  test('out of stock reads as out of stock', () => {
    expect(describeAlert({ status: 'out_of_stock', daysRemaining: 0 })).toBe('out of stock')
  })

  test('otherwise shows days left', () => {
    expect(describeAlert({ status: 'monitor', daysRemaining: 5 })).toBe('5 days left')
  })

  test('missing days falls back to the status label', () => {
    expect(describeAlert({ status: 'critical', daysRemaining: null })).toBe('critical')
  })
})
