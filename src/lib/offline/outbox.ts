import type { InventoryView, Op } from './types'

// Pure rules for the queue of actions made offline: ordering, collapsing
// actions that cancel or overwrite each other, dependencies between actions,
// and the failure / retry / discard bookkeeping. Every function returns a new
// array; inputs are never modified.

const DEPENDENCY_FAILED = 'Depends on an action that failed'

function isUnsynced(op: Op): boolean {
  return op.status !== 'confirmed'
}

/** The earlier action this one can't run without, if any. */
export function dependencyOf(op: Op, ops: readonly Op[]): Op | undefined {
  switch (op.type) {
    case 'return_borrow':
    case 'undo_return':
      return ops.find(o => o.type === 'create_borrow' && o.id === op.payload.borrowId && isUnsynced(o))
    case 'update_component':
    case 'delete_component':
      return ops.find(
        o => o.type === 'create_component' && o.payload.tempId === op.payload.componentId && isUnsynced(o),
      )
    default:
      return undefined
  }
}

/** Ids of actions that (directly or indirectly) depend on `rootId`, including it. */
function withDependants(ops: readonly Op[], rootId: string): Set<string> {
  const ids = new Set([rootId])
  for (const op of ops) {
    const dep = dependencyOf(op, ops)
    if (dep && ids.has(dep.id)) ids.add(op.id)
  }
  return ids
}

export function enqueue(ops: readonly Op[], next: Op): Op[] {
  switch (next.type) {
    case 'update_component': {
      const create = dependencyOf(next, ops)
      if (create && create.type === 'create_component') {
        const { name, weight_g } = next.payload
        return ops.map(o =>
          o.id === create.id && o.type === 'create_component' ? { ...o, payload: { ...o.payload, name, weight_g } } : o,
        )
      }
      return [...ops, next]
    }
    case 'delete_component': {
      const create = dependencyOf(next, ops)
      if (create) return ops.filter(o => o.id !== create.id)
      const { componentId } = next.payload
      const withoutEdits = ops.filter(
        o => !(o.type === 'update_component' && o.payload.componentId === componentId && isUnsynced(o)),
      )
      return [...withoutEdits, next]
    }
    case 'undo_return': {
      const pendingReturn = ops.find(
        o => o.type === 'return_borrow' && o.payload.borrowId === next.payload.borrowId && o.status === 'pending',
      )
      if (pendingReturn) return ops.filter(o => o.id !== pendingReturn.id)
      return [...ops, next]
    }
    default:
      return [...ops, next]
  }
}

export function failOp(ops: readonly Op[], id: string, error: string): Op[] {
  const affected = withDependants(ops, id)
  return ops.map(o => {
    if (!affected.has(o.id)) return o
    return { ...o, status: 'failed' as const, error: o.id === id ? error : DEPENDENCY_FAILED }
  })
}

export function discardOp(ops: readonly Op[], id: string): Op[] {
  const affected = withDependants(ops, id)
  return ops.filter(o => !affected.has(o.id))
}

export function retryOp(ops: readonly Op[], id: string): Op[] {
  const affected = withDependants(ops, id)
  return ops.map(o => (affected.has(o.id) ? { ...o, status: 'pending' as const, error: undefined, attempts: 0 } : o))
}

/** After a component created offline syncs, point later actions at its real id. */
export function remapComponentId(ops: readonly Op[], tempId: number, realId: number): Op[] {
  return ops.map(o => {
    if ((o.type === 'update_component' || o.type === 'delete_component') && o.payload.componentId === tempId) {
      return { ...o, payload: { ...o.payload, componentId: realId } } as Op
    }
    return o
  })
}

/** Same check the server does, against the offline view. Returns an error message or null. */
export function validateBorrow(view: InventoryView, component: string, qty: number): string | null {
  const available = view.stock.find(s => s.component === component)?.qty ?? 0
  return qty > available ? 'Not enough in stock' : null
}

/**
 * Folds the results of a sync run (`progressed`) into the latest queue. Only
 * the sync bookkeeping is taken from the sync; anything the user changed
 * meanwhile (a retry, an edit merged into a pending create, new actions) wins.
 * `startStatus` is each action's status when the sync run began.
 */
export function mergeProgress(
  latest: readonly Op[],
  progressed: readonly Op[],
  startStatus: ReadonlyMap<string, Op['status']>,
): Op[] {
  const byId = new Map(progressed.map(o => [o.id, o]))
  return latest.map(o => {
    const result = byId.get(o.id)
    if (!result) return o
    const withId = remapFrom(o, result)
    if (o.status !== startStatus.get(o.id)) return withId
    const { status, confirmedAt, attempts, error } = result
    return { ...withId, status, confirmedAt, attempts, error }
  })
}

/** Keeps a real component id the sync assigned in place of a temporary one. */
function remapFrom(o: Op, result: Op): Op {
  if (
    (o.type === 'update_component' || o.type === 'delete_component') &&
    (result.type === 'update_component' || result.type === 'delete_component') &&
    o.payload.componentId < 0 &&
    result.payload.componentId > 0
  ) {
    return { ...o, payload: { ...o.payload, componentId: result.payload.componentId } } as Op
  }
  return o
}
