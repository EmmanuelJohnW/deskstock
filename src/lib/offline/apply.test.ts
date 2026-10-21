import { describe, expect, test } from 'vitest'
import { mergeSnapshot } from './apply'
import type { Op, Snapshot } from './types'

const T0 = '2026-10-20T10:00:00.000Z'
const LATER = '2026-10-20T12:00:00.000Z'

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    inventoryId: 1,
    components: [{ id: 1, name: 'Button', weight_g: 1.2, created_at: T0 }],
    borrows: [
      {
        id: 'b-open',
        component: 'Button',
        qty: 5,
        borrower: 'Ana',
        taken_at: T0,
        due_at: LATER,
        returned_at: null,
      },
      {
        id: 'b-returned',
        component: 'Button',
        qty: 2,
        borrower: 'Ben',
        taken_at: T0,
        due_at: LATER,
        returned_at: T0,
      },
    ],
    ledger: [{ id: 1, component: 'Button', delta: 50, reason: 'adjustment', created_at: T0 }],
    stock: [{ component: 'Button', qty: 50 }],
    reconciliations: [],
    countSessions: [],
    fetchedAt: T0,
    ...overrides,
  }
}

let seq = 0
function op<T extends Op['type']>(type: T, payload: Extract<Op, { type: T }>['payload'], extra: Partial<Op> = {}): Op {
  seq += 1
  return {
    id: `op-${seq}`,
    type,
    inventoryId: 1,
    payload,
    createdAt: LATER,
    status: 'pending',
    ...extra,
  } as Op
}

function stockOf(view: ReturnType<typeof mergeSnapshot>, component: string): number | undefined {
  return view.stock.find(s => s.component === component)?.qty
}

describe('mergeSnapshot', () => {
  test('with no queued actions the view equals the snapshot', () => {
    const snap = snapshot()

    const view = mergeSnapshot(snap, [])

    expect(view.stock).toEqual(snap.stock)
    expect(view.borrows).toEqual(snap.borrows)
    expect(view.ledger).toEqual(snap.ledger)
    expect(view.components).toEqual(snap.components)
  })

  test('a queued borrow adds a pending loan, a ledger row and lowers stock', () => {
    // Arrange
    const borrow = op('create_borrow', { component: 'Button', qty: 10, borrower: 'Cy', due_at: LATER })

    // Act
    const view = mergeSnapshot(snapshot(), [borrow])

    // Assert
    expect(stockOf(view, 'Button')).toBe(40)
    expect(view.borrows[0]).toMatchObject({ id: borrow.id, qty: 10, borrower: 'Cy', returned_at: null, pending: true })
    expect(view.ledger.at(-1)).toMatchObject({ delta: -10, reason: 'borrow', created_at: LATER, pending: true })
  })

  test('a queued return closes the loan and raises stock', () => {
    const view = mergeSnapshot(snapshot(), [op('return_borrow', { borrowId: 'b-open' })])

    expect(view.borrows.find(b => b.id === 'b-open')).toMatchObject({ returned_at: LATER, pending: true })
    expect(stockOf(view, 'Button')).toBe(55)
    expect(view.ledger.at(-1)).toMatchObject({ delta: 5, reason: 'return' })
  })

  test('a queued undo reopens a returned loan and lowers stock', () => {
    const view = mergeSnapshot(snapshot(), [op('undo_return', { borrowId: 'b-returned' })])

    expect(view.borrows.find(b => b.id === 'b-returned')).toMatchObject({ returned_at: null, pending: true })
    expect(stockOf(view, 'Button')).toBe(48)
    expect(view.ledger.at(-1)).toMatchObject({ delta: -2, reason: 'return_reversal' })
  })

  test('returning a loan borrowed offline works on the pending loan', () => {
    const borrow = op('create_borrow', { component: 'Button', qty: 3, borrower: 'Cy', due_at: LATER })

    const view = mergeSnapshot(snapshot(), [borrow, op('return_borrow', { borrowId: borrow.id })])

    expect(view.borrows.find(b => b.id === borrow.id)?.returned_at).toBe(LATER)
    expect(stockOf(view, 'Button')).toBe(50)
  })

  test('returning an already returned or unknown loan changes nothing', () => {
    const view = mergeSnapshot(snapshot(), [
      op('return_borrow', { borrowId: 'b-returned' }),
      op('return_borrow', { borrowId: 'missing' }),
    ])

    expect(stockOf(view, 'Button')).toBe(50)
    expect(view.ledger).toHaveLength(1)
  })

  test('a queued restock raises stock with an adjustment row', () => {
    const view = mergeSnapshot(snapshot(), [op('add_stock', { component: 'Button', qty: 20 })])

    expect(stockOf(view, 'Button')).toBe(70)
    expect(view.ledger.at(-1)).toMatchObject({ delta: 20, reason: 'adjustment', pending: true })
  })

  test('restocking a component with no stock row adds one, kept in name order', () => {
    const view = mergeSnapshot(snapshot(), [op('add_stock', { component: 'Alpha', qty: 4 })])

    expect(view.stock.map(s => s.component)).toEqual(['Alpha', 'Button'])
    expect(stockOf(view, 'Alpha')).toBe(4)
  })

  test('components can be created, edited and deleted offline', () => {
    const view = mergeSnapshot(snapshot(), [
      op('create_component', { tempId: -1, name: 'Buzzer', weight_g: 2.5 }),
      op('update_component', { componentId: 1, name: 'Push button', weight_g: 1.3 }),
    ])

    expect(view.components).toEqual([
      { id: -1, name: 'Buzzer', weight_g: 2.5, created_at: LATER, pending: true },
      { id: 1, name: 'Push button', weight_g: 1.3, created_at: T0, pending: true },
    ])

    const deleted = mergeSnapshot(snapshot(), [op('delete_component', { componentId: 1 })])
    expect(deleted.components).toEqual([])
  })

  test('failed actions are not applied', () => {
    const view = mergeSnapshot(snapshot(), [
      op('add_stock', { component: 'Button', qty: 20 }, { status: 'failed', error: 'x' }),
    ])

    expect(stockOf(view, 'Button')).toBe(50)
  })

  test('actions for another inventory are ignored', () => {
    const view = mergeSnapshot(snapshot(), [op('add_stock', { component: 'Button', qty: 20 }, { inventoryId: 2 })])

    expect(stockOf(view, 'Button')).toBe(50)
  })

  test('confirmed actions already included in the snapshot are not applied twice', () => {
    const confirmedBefore = op('add_stock', { component: 'Button', qty: 20 }, {
      status: 'confirmed',
      confirmedAt: '2026-10-20T09:00:00.000Z',
    })
    const confirmedAfter = op('add_stock', { component: 'Button', qty: 5 }, {
      status: 'confirmed',
      confirmedAt: '2026-10-20T11:00:00.000Z',
    })

    const view = mergeSnapshot(snapshot(), [confirmedBefore, confirmedAfter])

    expect(stockOf(view, 'Button')).toBe(55)
  })

  test('a borrow the server already has is not added again', () => {
    const borrow = op('create_borrow', { component: 'Button', qty: 5, borrower: 'Ana', due_at: LATER })
    const snap = snapshot({
      borrows: [{ id: borrow.id, component: 'Button', qty: 5, borrower: 'Ana', taken_at: LATER, due_at: LATER, returned_at: null }],
      stock: [{ component: 'Button', qty: 45 }],
    })

    const view = mergeSnapshot(snap, [borrow])

    expect(view.borrows).toHaveLength(1)
    expect(stockOf(view, 'Button')).toBe(45)
  })

  test('a restock the server already has is not added again', () => {
    const add = op('add_stock', { component: 'Button', qty: 20 })
    const snap = snapshot({
      ledger: [{ id: 2, component: 'Button', delta: 20, reason: 'adjustment', created_at: LATER, client_op_id: add.id }],
      stock: [{ component: 'Button', qty: 70 }],
    })

    expect(stockOf(mergeSnapshot(snap, [add]), 'Button')).toBe(70)
  })

  test('does not modify the snapshot', () => {
    const snap = snapshot()
    const before = JSON.stringify(snap)

    mergeSnapshot(snap, [
      op('create_borrow', { component: 'Button', qty: 1, borrower: 'Cy', due_at: LATER }),
      op('return_borrow', { borrowId: 'b-open' }),
      op('update_component', { componentId: 1, name: 'X', weight_g: 1 }),
    ])

    expect(JSON.stringify(snap)).toBe(before)
  })
})
