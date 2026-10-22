import { describe, expect, test } from 'vitest'
import {
  dependencyOf,
  discardOp,
  enqueue,
  failOp,
  insertByTime,
  mergeProgress,
  remapComponentId,
  retryOp,
  validateBorrow,
} from './outbox'
import type { InventoryView, Op } from './types'

const AT = '2026-10-20T12:00:00.000Z'

let seq = 0
function op<T extends Op['type']>(type: T, payload: Extract<Op, { type: T }>['payload'], extra: Partial<Op> = {}): Op {
  seq += 1
  return { id: `op-${seq}`, type, inventoryId: 1, payload, createdAt: AT, status: 'pending', ...extra } as Op
}

describe('enqueue', () => {
  test('appends actions in order', () => {
    const a = op('add_stock', { component: 'Button', qty: 1 })
    const b = op('add_stock', { component: 'Button', qty: 2 })

    expect(enqueue(enqueue([], a), b).map(o => o.id)).toEqual([a.id, b.id])
  })

  test('editing a component created offline rewrites the create instead of queueing an edit', () => {
    const create = op('create_component', { tempId: -1, name: 'Buzer', weight_g: 2 })

    const ops = enqueue([create], op('update_component', { componentId: -1, name: 'Buzzer', weight_g: 2.5 }))

    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ id: create.id, payload: { tempId: -1, name: 'Buzzer', weight_g: 2.5 } })
  })

  test('deleting a component created offline removes the create', () => {
    const create = op('create_component', { tempId: -1, name: 'Buzzer', weight_g: 2 })

    expect(enqueue([create], op('delete_component', { componentId: -1 }))).toEqual([])
  })

  test('deleting a synced component drops its queued edits', () => {
    const edit = op('update_component', { componentId: 7, name: 'X', weight_g: 1 })

    const ops = enqueue([edit], op('delete_component', { componentId: 7 }))

    expect(ops.map(o => o.type)).toEqual(['delete_component'])
  })

  test('undoing a return that has not synced yet cancels the return', () => {
    const ret = op('return_borrow', { borrowId: 'b1' })

    expect(enqueue([ret], op('undo_return', { borrowId: 'b1' }))).toEqual([])
  })

  test('undoing a return that already synced is queued normally', () => {
    const ret = op('return_borrow', { borrowId: 'b1' }, { status: 'confirmed', confirmedAt: AT })

    expect(enqueue([ret], op('undo_return', { borrowId: 'b1' }))).toHaveLength(2)
  })
})

describe('dependencies', () => {
  test('a return of an offline borrow depends on that borrow', () => {
    const borrow = op('create_borrow', { component: 'Button', qty: 1, borrower: 'A', due_at: AT })
    const ret = op('return_borrow', { borrowId: borrow.id })

    expect(dependencyOf(ret, [borrow, ret])?.id).toBe(borrow.id)
    expect(dependencyOf(borrow, [borrow, ret])).toBeUndefined()
  })

  test('an edit of an offline component depends on its create', () => {
    const create = op('create_component', { tempId: -3, name: 'A', weight_g: 1 })
    const borrowLater = op('add_stock', { component: 'A', qty: 1 })
    const edit = op('update_component', { componentId: -3, name: 'B', weight_g: 1 })

    expect(dependencyOf(edit, [create, borrowLater, edit])?.id).toBe(create.id)
  })

  test('failing an action also fails the actions that depend on it', () => {
    const borrow = op('create_borrow', { component: 'Button', qty: 1, borrower: 'A', due_at: AT })
    const ret = op('return_borrow', { borrowId: borrow.id })
    const other = op('add_stock', { component: 'Button', qty: 1 })

    const ops = failOp([borrow, ret, other], borrow.id, 'insufficient_stock')

    expect(ops.map(o => [o.status, o.error])).toEqual([
      ['failed', 'insufficient_stock'],
      ['failed', 'Depends on an action that failed'],
      ['pending', undefined],
    ])
  })

  test('discarding an action also discards the actions that depend on it', () => {
    const borrow = op('create_borrow', { component: 'Button', qty: 1, borrower: 'A', due_at: AT })
    const ret = op('return_borrow', { borrowId: borrow.id })
    const undo = op('undo_return', { borrowId: borrow.id })
    const other = op('add_stock', { component: 'Button', qty: 1 })

    expect(discardOp([borrow, ret, undo, other], borrow.id).map(o => o.id)).toEqual([other.id])
  })

  test('retrying an action resets it and its dependants to pending', () => {
    const borrow = op('create_borrow', { component: 'Button', qty: 1, borrower: 'A', due_at: AT })
    const ret = op('return_borrow', { borrowId: borrow.id })
    const failed = failOp([borrow, ret], borrow.id, 'insufficient_stock')

    const ops = retryOp(failed, borrow.id)

    expect(ops.map(o => [o.status, o.error, o.attempts])).toEqual([
      ['pending', undefined, 0],
      ['pending', undefined, 0],
    ])
  })
})

describe('remapComponentId', () => {
  test('swaps a temporary component id for the real one in later actions', () => {
    const edit = op('update_component', { componentId: -1, name: 'A', weight_g: 1 })
    const del = op('delete_component', { componentId: -1 })
    const other = op('update_component', { componentId: 9, name: 'B', weight_g: 1 })

    const ops = remapComponentId([edit, del, other], -1, 42)

    expect(ops.map(o => (o.payload as { componentId: number }).componentId)).toEqual([42, 42, 9])
  })
})

describe('validateBorrow', () => {
  const view = { stock: [{ component: 'Button', qty: 5 }] } as InventoryView

  test('accepts a quantity within stock', () => {
    expect(validateBorrow(view, 'Button', 5)).toBeNull()
  })

  test('rejects more than is in stock', () => {
    expect(validateBorrow(view, 'Button', 6)).toBe('Not enough in stock')
  })

  test('rejects a component with no stock', () => {
    expect(validateBorrow(view, 'Buzzer', 1)).toBe('Not enough in stock')
  })
})

describe('mergeProgress', () => {
  test('takes sync results without overwriting newer user changes', () => {
    // Arrange: during a sync, the user edited a pending create and retried a failure.
    const create = op('create_component', { tempId: -1, name: 'Renamed', weight_g: 3 })
    const failed = op('add_stock', { component: 'B', qty: 1 }, { status: 'pending' })
    const added = op('add_stock', { component: 'C', qty: 1 })
    const latest = [create, failed, added]
    const progressed = [
      { ...create, payload: { tempId: -1, name: 'Old', weight_g: 1 }, status: 'confirmed', confirmedAt: AT },
      { ...failed, status: 'failed', error: 'old failure' },
    ] as Op[]
    const startStatus = new Map([
      [create.id, 'pending'],
      [failed.id, 'failed'],
    ] as const)

    // Act
    const merged = mergeProgress(latest, progressed, startStatus)

    // Assert
    expect(merged[0]).toMatchObject({ status: 'confirmed', confirmedAt: AT, payload: { name: 'Renamed', weight_g: 3 } })
    expect(merged[1]).toMatchObject({ status: 'pending' })
    expect(merged[2]).toBe(added)
  })

  test('carries over a real component id assigned during the sync', () => {
    const edit = op('update_component', { componentId: -1, name: 'A', weight_g: 1 })
    const progressed = [{ ...edit, payload: { componentId: 42, name: 'A', weight_g: 1 } }] as Op[]

    const merged = mergeProgress([edit], progressed, new Map([[edit.id, 'pending']]))

    expect((merged[0].payload as { componentId: number }).componentId).toBe(42)
  })
})

describe('insertByTime', () => {
  test('places an imported action before later pending actions', () => {
    const early = op('add_stock', { component: 'A', qty: 1 }, { createdAt: '2026-10-22T10:00:00Z' })
    const late = op('add_stock', { component: 'B', qty: 1 }, { createdAt: '2026-10-22T10:10:00Z' })
    const sort = op(
      'sort_run',
      { run_id: 'run-1', started_at: 'x', duration_ms: 1, bins: [] },
      { createdAt: '2026-10-22T10:05:00Z' },
    )

    expect(insertByTime([early, late], sort).map(o => o.id)).toEqual([early.id, sort.id, late.id])
  })

  test('goes last when nothing pending is newer', () => {
    const done = op('add_stock', { component: 'A', qty: 1 }, { createdAt: '2026-10-22T11:00:00Z', status: 'confirmed' })
    const sort = op('sort_run', { run_id: 'run-1', started_at: 'x', duration_ms: 1, bins: [] }, { createdAt: '2026-10-22T10:05:00Z' })

    expect(insertByTime([done], sort).map(o => o.id)).toEqual([done.id, sort.id])
  })
})
