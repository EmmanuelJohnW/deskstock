import { openDB, type IDBPDatabase } from 'idb'
import type { InventorySummary, Op, Snapshot } from './types'

// The laptop's local copy, kept in the browser's IndexedDB: the last online
// snapshot of each inventory, the inventories list, and the queue of actions
// made offline. One key-value object store keeps it simple.

const DB_NAME = 'deskstock-offline'
const DB_VERSION = 1
const STORE = 'kv'

const OUTBOX_KEY = 'outbox'
const INVENTORIES_KEY = 'inventories'
const snapshotKey = (inventoryId: number) => `snapshot:${inventoryId}`

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore(STORE)
    },
  })
  return dbPromise
}

async function read<T>(key: string): Promise<T | undefined> {
  return (await db()).get(STORE, key) as Promise<T | undefined>
}

async function write<T>(key: string, value: T): Promise<void> {
  await (await db()).put(STORE, value, key)
}

export function loadSnapshot(inventoryId: number): Promise<Snapshot | undefined> {
  return read<Snapshot>(snapshotKey(inventoryId))
}

export function saveSnapshot(snapshot: Snapshot): Promise<void> {
  return write(snapshotKey(snapshot.inventoryId), snapshot)
}

export async function loadOutbox(): Promise<Op[]> {
  return (await read<Op[]>(OUTBOX_KEY)) ?? []
}

export function saveOutbox(ops: readonly Op[]): Promise<void> {
  return write(OUTBOX_KEY, [...ops])
}

export async function loadInventories(): Promise<InventorySummary[]> {
  return (await read<InventorySummary[]>(INVENTORIES_KEY)) ?? []
}

export function saveInventories(inventories: readonly InventorySummary[]): Promise<void> {
  return write(INVENTORIES_KEY, [...inventories])
}

/** Test helper: forget the open connection so each test starts clean. */
export function resetForTests(): void {
  dbPromise = null
}
