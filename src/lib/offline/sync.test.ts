import { describe, expect, test, vi } from 'vitest'
import { MAX_ATTEMPTS, runSync, sendOp, type SendResult } from './sync'
import type { Op } from './types'

const AT = '2026-10-20T12:00:00.000Z'
const NOW = '2026-10-20T13:00:00.000Z'

let seq = 0
function op<T extends Op['type']>(type: T, payload: Extract<Op, { type: T }>['payload'], extra: Partial<Op> = {}): Op {
  seq += 1
  return { id: `op-${seq}`, type, inventoryId: 1, payload, createdAt: AT, status: 'pending', ...extra } as Op
}

const borrowPayload = { component: 'Button', qty: 2, borrower: 'Ana', due_at: AT }

describe('runSync', () => {
  test('sends pending actions in order and marks them confirmed', async () => {
    const a = op('add_stock', { component: 'Button', qty: 1 })
    const b = op('create_borrow', borrowPayload)
    const sent: string[] = []
    const send = async (o: Op): Promise<SendResult> => {
      sent.push(o.id)
      return { kind: 'ok' }
    }

    const { ops } = await runSync([a, b], send, () => NOW)

    expect(sent).toEqual([a.id, b.id])
    expect(ops.map(o => [o.status, o.confirmedAt])).toEqual([
      ['confirmed', NOW],
      ['confirmed', NOW],
    ])
  })

  test('skips actions that are already confirmed or failed', async () => {
    const done = op('add_stock', { component: 'Button', qty: 1 }, { status: 'confirmed', confirmedAt: AT })
    const failed = op('add_stock', { component: 'Button', qty: 1 }, { status: 'failed', error: 'x' })
    const send = vi.fn(async (): Promise<SendResult> => ({ kind: 'ok' }))

    await runSync([done, failed], send, () => NOW)

    expect(send).not.toHaveBeenCalled()
  })

  test('stops at a network error and leaves the rest pending', async () => {
    const a = op('add_stock', { component: 'Button', qty: 1 })
    const b = op('add_stock', { component: 'Button', qty: 2 })
    const send = vi.fn(async (): Promise<SendResult> => ({ kind: 'network' }))

    const { ops } = await runSync([a, b], send, () => NOW)

    expect(send).toHaveBeenCalledTimes(1)
    expect(ops.map(o => o.status)).toEqual(['pending', 'pending'])
  })

  test('says when it stopped because the server was unreachable', async () => {
    const a = op('add_stock', { component: 'Button', qty: 1 })

    const offline = await runSync([a], async () => ({ kind: 'network' }), () => NOW)
    const online = await runSync([a], async () => ({ kind: 'ok' }), () => NOW)

    expect([offline.stoppedOnNetwork, offline.changed]).toEqual([true, false])
    expect([online.stoppedOnNetwork, online.changed]).toEqual([false, true])
  })

  test('a rejected action fails with its dependants and the rest still sync', async () => {
    const borrow = op('create_borrow', borrowPayload)
    const ret = op('return_borrow', { borrowId: borrow.id })
    const other = op('add_stock', { component: 'Button', qty: 1 })
    const send = async (o: Op): Promise<SendResult> =>
      o.id === borrow.id ? { kind: 'rejected', error: 'Not enough in stock' } : { kind: 'ok' }

    const { ops } = await runSync([borrow, ret, other], send, () => NOW)

    expect(ops.map(o => [o.status, o.error])).toEqual([
      ['failed', 'Not enough in stock'],
      ['failed', 'Depends on an action that failed'],
      ['confirmed', undefined],
    ])
  })

  test('server errors are retried on later runs, then fail after the limit', async () => {
    const a = op('add_stock', { component: 'Button', qty: 1 })
    const send = async (): Promise<SendResult> => ({ kind: 'retry', error: 'Server error' })

    const { ops: once } = await runSync([a], send, () => NOW)
    expect(once[0]).toMatchObject({ status: 'pending', attempts: 1 })

    const { ops: atLimit } = await runSync([{ ...a, attempts: MAX_ATTEMPTS - 1 }], send, () => NOW)
    expect(atLimit[0]).toMatchObject({ status: 'failed', error: 'Server error' })
  })

  test('a component created offline gets its real id in later actions', async () => {
    const create = op('create_component', { tempId: -1, name: 'Buzzer', weight_g: 2 })
    const edit = op('update_component', { componentId: -1, name: 'Buzzer', weight_g: 2.5 })
    const seen: number[] = []
    const send = async (o: Op): Promise<SendResult> => {
      if (o.type === 'update_component') seen.push(o.payload.componentId)
      return o.type === 'create_component' ? { kind: 'ok', componentId: 42 } : { kind: 'ok' }
    }

    await runSync([create, edit], send, () => NOW)

    expect(seen).toEqual([42])
  })

  test('reports progress after each action', async () => {
    const a = op('add_stock', { component: 'Button', qty: 1 })
    const b = op('add_stock', { component: 'Button', qty: 2 })
    const progress = vi.fn()

    await runSync([a, b], async () => ({ kind: 'ok' }), () => NOW, progress)

    expect(progress).toHaveBeenCalledTimes(2)
  })
})

describe('sendOp', () => {
  function fakeFetch(status: number, body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }))
  }

  test('a borrow sends its id and the time it happened', async () => {
    const borrow = op('create_borrow', borrowPayload)
    const fetchImpl = fakeFetch(201, { success: true, borrow_id: borrow.id })

    const result = await sendOp(borrow, fetchImpl)

    expect(result).toEqual({ kind: 'ok' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/borrows')
    expect(JSON.parse(init.body as string)).toEqual({ ...borrowPayload, inventory_id: 1, id: borrow.id, occurred_at: AT })
  })

  test('a restock sends its op id and time', async () => {
    const add = op('add_stock', { component: 'Button', qty: 3 })
    const fetchImpl = fakeFetch(200, { success: true })

    await sendOp(add, fetchImpl)

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/inventory/add')
    expect(JSON.parse(init.body as string)).toEqual({
      component: 'Button',
      qty: 3,
      inventory_id: 1,
      op_id: add.id,
      occurred_at: AT,
    })
  })

  test('not enough stock is a rejection with a readable message', async () => {
    const result = await sendOp(op('create_borrow', borrowPayload), fakeFetch(409, { error: 'insufficient_stock' }))

    expect(result).toEqual({ kind: 'rejected', error: 'Not enough in stock' })
  })

  test('a return that was already applied counts as success', async () => {
    const result = await sendOp(op('return_borrow', { borrowId: 'b1' }), fakeFetch(409, { error: 'already_returned' }))

    expect(result).toEqual({ kind: 'ok' })
  })

  test('an undo that was already applied counts as success', async () => {
    const result = await sendOp(op('undo_return', { borrowId: 'b1' }), fakeFetch(409, { error: 'not_returned' }))

    expect(result).toEqual({ kind: 'ok' })
  })

  test('creating a component returns its new id', async () => {
    const result = await sendOp(
      op('create_component', { tempId: -1, name: 'Buzzer', weight_g: 2 }),
      fakeFetch(201, { success: true, id: 42 }),
    )

    expect(result).toEqual({ kind: 'ok', componentId: 42 })
  })

  test('edits and deletes use PUT and DELETE with the component id', async () => {
    const put = fakeFetch(200, { success: true })
    await sendOp(op('update_component', { componentId: 5, name: 'A', weight_g: 1 }), put)
    const del = fakeFetch(200, { success: true })
    await sendOp(op('delete_component', { componentId: 5 }), del)

    const [, putInit] = put.mock.calls[0] as unknown as [string, RequestInit]
    const [, delInit] = del.mock.calls[0] as unknown as [string, RequestInit]
    expect(putInit.method).toBe('PUT')
    expect(JSON.parse(putInit.body as string)).toEqual({ id: 5, name: 'A', weight_g: 1, inventory_id: 1 })
    expect(delInit.method).toBe('DELETE')
    expect(JSON.parse(delInit.body as string)).toEqual({ id: 5, inventory_id: 1 })
  })

  test('a failed connection is a network result', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    expect(await sendOp(op('add_stock', { component: 'Button', qty: 1 }), fetchImpl)).toEqual({ kind: 'network' })
  })

  test('a server error is retried later', async () => {
    const result = await sendOp(op('add_stock', { component: 'Button', qty: 1 }), fakeFetch(500, { error: 'boom' }))

    expect(result).toEqual({ kind: 'retry', error: 'boom' })
  })
})
