import { isNetworkError } from './network'
import { failOp, remapComponentId } from './outbox'
import type { Op } from './types'

// Replays actions queued offline through the existing API routes, in the order
// they happened. Each action carries its own id and time, so a replay of an
// action the server already applied is harmless (see api/borrows/route.ts and
// api/inventory/add/route.ts).

/** Server errors (5xx) are retried on later sync runs up to this many times. */
export const MAX_ATTEMPTS = 5

export type SendResult =
  | { kind: 'ok'; componentId?: number }
  | { kind: 'rejected'; error: string }
  | { kind: 'retry'; error: string }
  | { kind: 'network' }

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** Server error codes that mean "already done": the end state is what we wanted. */
const ALREADY_APPLIED = new Set(['already_returned', 'not_returned'])

const ERROR_MESSAGES: Record<string, string> = {
  insufficient_stock: 'Not enough in stock',
  insufficient_stock_to_undo: 'Not enough in stock to undo this return',
  borrow_not_found: 'Loan not found',
  name_taken: 'A component with that name already exists',
}

interface Request {
  url: string
  method: string
  body: Record<string, unknown>
}

function requestFor(op: Op): Request {
  const inventory_id = op.inventoryId
  switch (op.type) {
    case 'create_borrow':
      return {
        url: '/api/borrows',
        method: 'POST',
        body: { ...op.payload, inventory_id, id: op.id, occurred_at: op.createdAt },
      }
    case 'return_borrow':
      return { url: '/api/borrows/return', method: 'POST', body: { borrow_id: op.payload.borrowId } }
    case 'undo_return':
      return { url: '/api/borrows/undo-return', method: 'POST', body: { borrow_id: op.payload.borrowId } }
    case 'add_stock':
      return {
        url: '/api/inventory/add',
        method: 'POST',
        body: { ...op.payload, inventory_id, op_id: op.id, occurred_at: op.createdAt },
      }
    case 'create_component':
      return {
        url: '/api/components',
        method: 'POST',
        // A replay after a lost response would hit "name taken"; ask for the existing id instead.
        body: { name: op.payload.name, weight_g: op.payload.weight_g, inventory_id, return_existing: true },
      }
    case 'update_component':
      return {
        url: '/api/components',
        method: 'PUT',
        body: { id: op.payload.componentId, name: op.payload.name, weight_g: op.payload.weight_g, inventory_id },
      }
    case 'delete_component':
      return { url: '/api/components', method: 'DELETE', body: { id: op.payload.componentId, inventory_id } }
    case 'sort_run':
      // Idempotent by run_id on the server; counted into the inventory it was sorted for.
      return { url: '/api/runs', method: 'POST', body: { ...op.payload, inventory_id } }
  }
}

async function readBody(res: Response): Promise<{ error?: unknown; id?: unknown }> {
  try {
    return (await res.json()) as { error?: unknown; id?: unknown }
  } catch {
    return {}
  }
}

function errorText(error: unknown, status: number): string {
  if (typeof error === 'string') return ERROR_MESSAGES[error] ?? error
  return `Request failed (${status})`
}

/** Sends one queued action to its API route and classifies the answer. */
export async function sendOp(op: Op, fetchImpl: FetchLike = fetch): Promise<SendResult> {
  const { url, method, body } = requestFor(op)
  let res: Response
  try {
    res = await fetchImpl(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    return { kind: 'network' }
  }

  const data = await readBody(res)
  if (res.ok && op.type === 'sort_run') {
    // Uploaded: the laptop hub no longer needs its copy (best effort).
    await fetchImpl(`/api/local/pending/${encodeURIComponent(op.payload.run_id)}`, { method: 'DELETE' }).catch(() => {})
  }
  if (res.ok) {
    return op.type === 'create_component' && typeof data.id === 'number'
      ? { kind: 'ok', componentId: data.id }
      : { kind: 'ok' }
  }
  if (typeof data.error === 'string' && ALREADY_APPLIED.has(data.error)) return { kind: 'ok' }
  // On the laptop hub the server itself may have no internet: that's "offline", not a server fault.
  if (res.status >= 500 && typeof data.error === 'string' && isNetworkError({ message: data.error })) {
    return { kind: 'network' }
  }
  if (res.status >= 500) return { kind: 'retry', error: errorText(data.error, res.status) }
  return { kind: 'rejected', error: errorText(data.error, res.status) }
}

function replace(ops: readonly Op[], id: string, update: (op: Op) => Op): Op[] {
  return ops.map(o => (o.id === id ? update(o) : o))
}

export interface SyncOutcome {
  ops: Op[]
  /** Stopped because the server couldn't be reached; the rest stay pending. */
  stoppedOnNetwork: boolean
  /** Whether any action changed state (confirmed, failed, or a retry counted). */
  changed: boolean
}

/**
 * Sends every pending action in order. Stops at the first network error (the
 * rest stay pending for the next run). `onProgress` gets the queue after each
 * action so it can be saved as it goes.
 */
export async function runSync(
  ops: readonly Op[],
  send: (op: Op) => Promise<SendResult>,
  now: () => string = () => new Date().toISOString(),
  onProgress?: (ops: Op[]) => void | Promise<void>,
): Promise<SyncOutcome> {
  let current = [...ops]
  let changed = false

  for (const { id } of ops) {
    const op = current.find(o => o.id === id)
    if (!op || op.status !== 'pending') continue

    const result = await send(op)
    if (result.kind === 'network') return { ops: current, stoppedOnNetwork: true, changed }
    changed = true

    if (result.kind === 'ok') {
      current = replace(current, id, o => ({ ...o, status: 'confirmed', confirmedAt: now(), error: undefined }))
      if (op.type === 'create_component' && result.componentId !== undefined) {
        current = remapComponentId(current, op.payload.tempId, result.componentId)
      }
    } else if (result.kind === 'rejected') {
      current = failOp(current, id, result.error)
    } else {
      const attempts = (op.attempts ?? 0) + 1
      current =
        attempts >= MAX_ATTEMPTS
          ? failOp(current, id, result.error)
          : replace(current, id, o => ({ ...o, attempts, error: result.error }))
    }
    await onProgress?.(current)
  }

  return { ops: current, stoppedOnNetwork: false, changed }
}
