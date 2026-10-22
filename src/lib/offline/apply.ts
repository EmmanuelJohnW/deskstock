import type { BorrowRow, ComponentRow, InventoryView, LedgerRow, Op, Snapshot, StockRow } from './types'

// Applies queued (not yet synced) actions to the last online snapshot, so the
// pages show what the data will look like once everything syncs. Mirrors what
// the server does for each action. Pure: the snapshot is never modified.

interface ViewState {
  components: ComponentRow[]
  borrows: BorrowRow[]
  ledger: LedgerRow[]
  stockDelta: ReadonlyMap<string, number>
}

/** Ids of actions whose results are visibly already in the snapshot. */
function appliedIds(snapshot: Snapshot): Set<string> {
  const ids = new Set(snapshot.borrows.map(b => b.id))
  for (const row of snapshot.ledger) {
    if (row.client_op_id) ids.add(row.client_op_id)
  }
  return ids
}

/** Pending actions, plus confirmed ones the snapshot doesn't include yet. */
function isUnapplied(op: Op, snapshot: Snapshot, alreadyApplied: ReadonlySet<string>): boolean {
  if (op.inventoryId !== snapshot.inventoryId) return false
  // The server may have applied it even if we never saw the reply.
  if ((op.type === 'create_borrow' || op.type === 'add_stock') && alreadyApplied.has(op.id)) return false
  if (op.status === 'pending') return true
  if (op.status === 'confirmed') return !op.confirmedAt || op.confirmedAt > snapshot.fetchedAt
  return false
}

function addStockDelta(deltas: ReadonlyMap<string, number>, component: string, delta: number): Map<string, number> {
  return new Map(deltas).set(component, (deltas.get(component) ?? 0) + delta)
}

function withLedger(state: ViewState, op: Op, component: string, delta: number, reason: string): ViewState {
  const row: LedgerRow = { component, delta, reason, created_at: op.createdAt, pending: true }
  return {
    ...state,
    ledger: [...state.ledger, row],
    stockDelta: addStockDelta(state.stockDelta, component, delta),
  }
}

function setReturned(state: ViewState, op: Op, borrowId: string, returnedAt: string | null): ViewState {
  const borrow = state.borrows.find(b => b.id === borrowId)
  const isReturned = borrow?.returned_at != null
  // A return needs an open loan; an undo needs a returned one. Anything else is a no-op.
  if (!borrow || isReturned === (returnedAt !== null)) return state

  const updated = state.borrows.map(b => (b.id === borrowId ? { ...b, returned_at: returnedAt, pending: true } : b))
  const delta = returnedAt === null ? -borrow.qty : borrow.qty
  const reason = returnedAt === null ? 'return_reversal' : 'return'
  return withLedger({ ...state, borrows: updated }, op, borrow.component, delta, reason)
}

function applyOp(state: ViewState, op: Op): ViewState {
  switch (op.type) {
    case 'create_borrow': {
      const { component, qty, borrower, due_at } = op.payload
      const borrow: BorrowRow = {
        id: op.id,
        component,
        qty,
        borrower,
        taken_at: op.createdAt,
        due_at,
        returned_at: null,
        pending: true,
      }
      return withLedger({ ...state, borrows: [borrow, ...state.borrows] }, op, component, -qty, 'borrow')
    }
    case 'return_borrow':
      return setReturned(state, op, op.payload.borrowId, op.createdAt)
    case 'undo_return':
      return setReturned(state, op, op.payload.borrowId, null)
    case 'add_stock':
      return withLedger(state, op, op.payload.component, op.payload.qty, 'adjustment')
    case 'create_component': {
      const { tempId, name, weight_g } = op.payload
      const component: ComponentRow = { id: tempId, name, weight_g, created_at: op.createdAt, pending: true }
      return { ...state, components: [...state.components, component] }
    }
    case 'update_component': {
      const { componentId, name, weight_g } = op.payload
      return {
        ...state,
        components: state.components.map(c => (c.id === componentId ? { ...c, name, weight_g, pending: true } : c)),
      }
    }
    case 'delete_component':
      return { ...state, components: state.components.filter(c => c.id !== op.payload.componentId) }
  }
}

function applyStock(stock: readonly StockRow[], deltas: ReadonlyMap<string, number>): StockRow[] {
  const byComponent = new Map(stock.map(s => [s.component, s.qty]))
  for (const [component, delta] of deltas) {
    byComponent.set(component, (byComponent.get(component) ?? 0) + delta)
  }
  return [...byComponent.entries()]
    .map(([component, qty]) => ({ component, qty }))
    .sort((a, b) => a.component.localeCompare(b.component))
}

function byName(a: ComponentRow, b: ComponentRow): number {
  return a.name.localeCompare(b.name)
}

export function mergeSnapshot(snapshot: Snapshot, ops: readonly Op[]): InventoryView {
  const alreadyApplied = appliedIds(snapshot)
  const active = ops.filter(op => isUnapplied(op, snapshot, alreadyApplied))
  const base = {
    inventoryId: snapshot.inventoryId,
    reconciliations: snapshot.reconciliations,
    countSessions: snapshot.countSessions,
    fetchedAt: snapshot.fetchedAt,
  }
  if (active.length === 0) {
    return { ...base, components: snapshot.components, borrows: snapshot.borrows, ledger: snapshot.ledger, stock: snapshot.stock }
  }

  const initial: ViewState = {
    components: snapshot.components,
    borrows: snapshot.borrows,
    ledger: snapshot.ledger,
    stockDelta: new Map(),
  }
  const state = active.reduce(applyOp, initial)

  return {
    ...base,
    components: [...state.components].sort(byName),
    borrows: state.borrows,
    ledger: state.ledger,
    stock: applyStock(snapshot.stock, state.stockDelta),
  }
}
