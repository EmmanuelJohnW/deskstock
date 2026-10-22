// Shapes for the offline copy of an inventory and the queue of actions made
// while offline. Row shapes mirror the Supabase tables the pages read.

export interface ComponentRow {
  id: number
  name: string
  weight_g: number
  created_at: string
  /** Created, edited or deleted offline and not yet synced. */
  pending?: boolean
}

export interface BorrowRow {
  id: string
  component: string
  qty: number
  borrower: string
  taken_at: string
  due_at: string
  returned_at: string | null
  pending?: boolean
}

export interface LedgerRow {
  id?: number
  component: string
  delta: number
  reason: string
  session_id?: number | null
  created_at: string
  /** Id of the queued action that created this row (borrows and restocks synced from offline). */
  client_op_id?: string | null
  pending?: boolean
}

export interface StockRow {
  component: string
  qty: number
}

export interface ReconciliationRow {
  session_id: number
  component: string
  expected: number
  counted: number
  difference: number
}

export interface CountSessionRow {
  id: number
  finished_at: string | null
}

/** Everything the dashboard pages need for one inventory, as last fetched online. */
export interface Snapshot {
  inventoryId: number
  components: ComponentRow[]
  borrows: BorrowRow[]
  ledger: LedgerRow[]
  /** get_inventory() result: authoritative stock per component at fetch time. */
  stock: StockRow[]
  /** Only rows with a non-zero difference (the discrepancy report). */
  reconciliations: ReconciliationRow[]
  /** Reconciled sessions, for discrepancy report dates. */
  countSessions: CountSessionRow[]
  fetchedAt: string
}

export interface InventorySummary {
  id: number
  name: string
  created_at: string
}

// ── Queued actions ───────────────────────────────────────────────────────────

export interface CreateBorrowPayload {
  component: string
  qty: number
  borrower: string
  due_at: string
}

export interface BorrowRefPayload {
  borrowId: string
}

export interface AddStockPayload {
  component: string
  qty: number
}

export interface ComponentFieldsPayload {
  name: string
  weight_g: number
}

export interface UpdateComponentPayload extends ComponentFieldsPayload {
  componentId: number
}

export interface DeleteComponentPayload {
  componentId: number
}

interface OpBase<T extends string, P> {
  /** Unique per action; also the borrow id for create_borrow and the ledger client_op_id for add_stock. */
  id: string
  type: T
  inventoryId: number
  payload: P
  /** When the action happened (ISO). Sent to the server as occurred_at. */
  createdAt: string
  status: OpStatus
  /** When the server accepted it. Snapshots fetched after this already include it. */
  confirmedAt?: string
  error?: string
  attempts?: number
}

export type OpStatus = 'pending' | 'confirmed' | 'failed'

export type Op =
  | OpBase<'create_borrow', CreateBorrowPayload>
  | OpBase<'return_borrow', BorrowRefPayload>
  | OpBase<'undo_return', BorrowRefPayload>
  | OpBase<'add_stock', AddStockPayload>
  | OpBase<'create_component', ComponentFieldsPayload & { tempId: number }>
  | OpBase<'update_component', UpdateComponentPayload>
  | OpBase<'delete_component', DeleteComponentPayload>

export type OpType = Op['type']

/** The data pages render: the snapshot with queued actions applied. */
export interface InventoryView {
  inventoryId: number
  components: ComponentRow[]
  borrows: BorrowRow[]
  ledger: LedgerRow[]
  stock: StockRow[]
  reconciliations: ReconciliationRow[]
  countSessions: CountSessionRow[]
  fetchedAt: string
}
