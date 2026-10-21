import type { BorrowRow, Op } from './types'

function loanText(borrowId: string, borrows: readonly BorrowRow[]): string | null {
  const loan = borrows.find(b => b.id === borrowId)
  return loan ? `${loan.qty} × ${loan.component} (${loan.borrower})` : null
}

/** One-line, human-readable description of a queued action. */
export function describeOp(op: Op, borrows: readonly BorrowRow[] = []): string {
  switch (op.type) {
    case 'create_borrow': {
      const { qty, component, borrower } = op.payload
      return `Borrow ${qty} × ${component} (${borrower})`
    }
    case 'return_borrow': {
      const loan = loanText(op.payload.borrowId, borrows)
      return loan ? `Return ${loan}` : 'Return a loan'
    }
    case 'undo_return': {
      const loan = loanText(op.payload.borrowId, borrows)
      return loan ? `Undo return of ${loan}` : 'Undo a return'
    }
    case 'add_stock':
      return `Add ${op.payload.qty} × ${op.payload.component} as new stock`
    case 'create_component':
      return `Register component ${op.payload.name} (${op.payload.weight_g} g)`
    case 'update_component':
      return `Edit component → ${op.payload.name} (${op.payload.weight_g} g)`
    case 'delete_component':
      return 'Delete a component'
  }
}
