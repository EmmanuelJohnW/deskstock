import { describe, expect, test } from 'vitest'
import { LiveRunTracker, type LiveRunRow } from './LiveRunTracker'
import type { DeviceMessage } from './types'

const STALE_MS = 60_000

function row(runId: string, elapsed: number, counts: Record<number, number>, updatedAt = '2026-10-22T10:00:00Z'): LiveRunRow {
  return {
    run_id: runId,
    status: 'running',
    elapsed_ms: elapsed,
    est_remaining_ms: null,
    bins: Object.entries(counts).map(([bin, count]) => ({ name: `C${bin}`, weight_g: 1, bin: Number(bin), count })),
    updated_at: updatedAt,
  }
}

function setup() {
  const messages: DeviceMessage[] = []
  const tracker = new LiveRunTracker(m => messages.push(m), STALE_MS)
  const topics = () => messages.map(m => m.topic)
  const binEvents = () =>
    messages.flatMap(m => (m.topic === 'bin/event' ? [[m.payload.bin, m.payload.count]] : []))
  return { tracker, messages, topics, binEvents }
}

describe('LiveRunTracker', () => {
  test('the first snapshot starts the run and emits current counts', () => {
    const { tracker, topics, binEvents } = setup()

    tracker.apply(row('r1', 1000, { 5: 2, 4: 1 }))

    expect(topics()).toEqual(['sort/start', 'bin/event', 'bin/event', 'sort/progress'])
    expect(binEvents()).toEqual([
      [4, 1],
      [5, 2],
    ])
    expect(tracker.currentRunId).toBe('r1')
  })

  test('later snapshots emit only what changed', () => {
    const { tracker, binEvents } = setup()

    tracker.apply(row('r1', 1000, { 5: 2 }))
    tracker.apply(row('r1', 2000, { 5: 3, 4: 1 }))

    expect(binEvents()).toEqual([
      [5, 2],
      [4, 1],
      [5, 1],
    ])
  })

  test('an older snapshot (from the slower of two sources) is ignored', () => {
    const { tracker, binEvents } = setup()

    tracker.apply(row('r1', 3000, { 5: 4 }))
    tracker.apply(row('r1', 2000, { 5: 3 }))
    tracker.apply(row('r1', 3000, { 5: 4 }))

    expect(binEvents()).toEqual([[5, 4]])
  })

  test('completes a run once, with the final counts', () => {
    const { tracker, messages } = setup()
    tracker.apply(row('r1', 5000, { 5: 3, 4: 2 }))

    tracker.complete('r1')
    tracker.complete('r1')

    const completes = messages.filter(m => m.topic === 'sort/complete')
    expect(completes).toHaveLength(1)
    expect(completes[0].payload).toEqual({ run_id: 'r1', total: 5, duration_ms: 5000 })
    expect(tracker.currentRunId).toBeNull()
  })

  test('uses the hub summary when given', () => {
    const { tracker, messages } = setup()
    tracker.apply(row('r1', 5000, { 5: 3 }))

    tracker.complete('r1', { total: 9, duration_ms: 7000 })

    expect(messages.at(-1)?.payload).toEqual({ run_id: 'r1', total: 9, duration_ms: 7000 })
  })

  test('ignores completion of a different run', () => {
    const { tracker, topics } = setup()
    tracker.apply(row('r1', 1000, { 5: 1 }))

    tracker.complete('other')

    expect(topics()).not.toContain('sort/complete')
  })

  test('a finished run is not started again by a late snapshot', () => {
    const { tracker, topics } = setup()
    tracker.apply(row('r1', 1000, { 5: 1 }))
    tracker.complete('r1')
    const before = topics().length

    tracker.apply(row('r1', 2000, { 5: 2 }))

    expect(topics()).toHaveLength(before)
  })

  test('a new run replaces the previous one', () => {
    const { tracker, messages } = setup()
    tracker.apply(row('r1', 1000, { 5: 1 }))

    tracker.apply(row('r2', 1000, { 5: 1 }))

    expect(messages.filter(m => m.topic === 'sort/start')).toHaveLength(2)
    expect(tracker.currentRunId).toBe('r2')
  })

  test('a run with no updates for too long is cancelled', () => {
    const { tracker, topics } = setup()
    tracker.apply(row('r1', 1000, { 5: 1 }, '2026-10-22T10:00:00Z'))

    tracker.checkStaleness(Date.parse('2026-10-22T10:00:30Z'))
    expect(topics()).not.toContain('sort/cancelled')

    tracker.checkStaleness(Date.parse('2026-10-22T10:01:01Z'))
    expect(topics().at(-1)).toBe('sort/cancelled')
    expect(tracker.currentRunId).toBeNull()
  })
})
