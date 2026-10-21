import { describe, expect, test } from 'vitest'
import { describeOp } from './describe'
import type { BorrowRow, Op } from './types'

const AT = '2026-10-20T12:00:00.000Z'

function op<T extends Op['type']>(type: T, payload: Extract<Op, { type: T }>['payload']): Op {
  return { id: 'x', type, inventoryId: 1, payload, createdAt: AT, status: 'pending' } as Op
}

const borrows: BorrowRow[] = [
  { id: 'b1', component: 'Buzzer', qty: 2, borrower: 'Ana', taken_at: AT, due_at: AT, returned_at: null },
]

describe('describeOp', () => {
  test.each([
    [op('create_borrow', { component: 'IR sensor', qty: 70, borrower: 'Ana', due_at: AT }), 'Borrow 70 × IR sensor (Ana)'],
    [op('add_stock', { component: '4mm coupler', qty: 40 }), 'Add 40 × 4mm coupler as new stock'],
    [op('create_component', { tempId: -1, name: 'Buzzer', weight_g: 2.5 }), 'Register component Buzzer (2.5 g)'],
    [op('update_component', { componentId: 3, name: 'Button', weight_g: 1.2 }), 'Edit component → Button (1.2 g)'],
    [op('delete_component', { componentId: 3 }), 'Delete a component'],
  ])('%#: describes the action', (action, text) => {
    expect(describeOp(action)).toBe(text)
  })

  test('names the loan when it is known', () => {
    expect(describeOp(op('return_borrow', { borrowId: 'b1' }), borrows)).toBe('Return 2 × Buzzer (Ana)')
    expect(describeOp(op('undo_return', { borrowId: 'b1' }), borrows)).toBe('Undo return of 2 × Buzzer (Ana)')
  })

  test('falls back to a generic description for an unknown loan', () => {
    expect(describeOp(op('return_borrow', { borrowId: 'zz' }), borrows)).toBe('Return a loan')
    expect(describeOp(op('undo_return', { borrowId: 'zz' }))).toBe('Undo a return')
  })
})
