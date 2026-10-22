import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  loadInventories,
  loadOutbox,
  loadSnapshot,
  resetForTests,
  saveInventories,
  saveOutbox,
  saveSnapshot,
} from './store'
import type { Op, Snapshot } from './types'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetForTests()
})

const snapshot: Snapshot = {
  inventoryId: 7,
  components: [],
  borrows: [],
  ledger: [],
  stock: [{ component: 'Button', qty: 3 }],
  reconciliations: [],
  countSessions: [],
  fetchedAt: '2026-10-20T10:00:00.000Z',
}

describe('offline store', () => {
  test('starts empty', async () => {
    expect(await loadSnapshot(7)).toBeUndefined()
    expect(await loadOutbox()).toEqual([])
    expect(await loadInventories()).toEqual([])
  })

  test('keeps a snapshot per inventory', async () => {
    await saveSnapshot(snapshot)

    expect(await loadSnapshot(7)).toEqual(snapshot)
    expect(await loadSnapshot(8)).toBeUndefined()
  })

  test('keeps the queue in order', async () => {
    const ops = [
      { id: 'a', type: 'add_stock', inventoryId: 7, payload: { component: 'B', qty: 1 }, createdAt: 'x', status: 'pending' },
      { id: 'b', type: 'add_stock', inventoryId: 7, payload: { component: 'B', qty: 2 }, createdAt: 'y', status: 'pending' },
    ] as Op[]

    await saveOutbox(ops)

    expect((await loadOutbox()).map(o => o.id)).toEqual(['a', 'b'])
  })

  test('keeps the inventories list', async () => {
    const list = [{ id: 1, name: 'Default', created_at: 'x' }]

    await saveInventories(list)

    expect(await loadInventories()).toEqual(list)
  })
})
