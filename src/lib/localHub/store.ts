import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { hubDir } from './net'

// What the laptop hub keeps: the sort in progress (memory only), the last
// component list per inventory (for the device's run-config when offline),
// and finished runs waiting for the dashboard to upload them (one file each).

export interface HubBin {
  name: string
  weight_g: number
  bin: number
  count: number
}

/** Same shape as a Supabase live_runs row, so the dashboard reads both alike. */
export interface HubLiveRow {
  run_id: string
  status: 'running'
  elapsed_ms: number
  est_remaining_ms: number | null
  bins: HubBin[]
  updated_at: string
}

export interface HubCompletedRun {
  run_id: string
  total: number
  duration_ms: number
}

export interface HubPendingRun {
  run_id: string
  inventory_id: number | null
  started_at: string
  duration_ms: number
  bins: HubBin[]
  received_at: string
}

export interface CatalogRow {
  name: string
  weight_g: number
}

interface HubMemory {
  live: HubLiveRow | null
  lastCompleted: HubCompletedRun | null
  /** Inventory chosen in the laptop's dashboard. */
  selectedInventoryId: number | null
  /** Inventory whose component list the device got for its current run. */
  runInventoryId: number | null
  /** Last time the device talked to this laptop (ISO). */
  deviceSeenAt: string | null
}

const memory: HubMemory = ((globalThis as { __deskstockHub?: HubMemory }).__deskstockHub ??= {
  live: null,
  lastCompleted: null,
  selectedInventoryId: null,
  runInventoryId: null,
  deviceSeenAt: null,
})

export function hubMemory(): HubMemory {
  return memory
}

function selectedFile(): string {
  return path.join(hubDir(), 'selected-inventory.json')
}

/** Remember the dashboard's selected inventory across hub restarts. */
export async function setSelectedInventory(inventoryId: number): Promise<void> {
  memory.selectedInventoryId = inventoryId
  await writeAtomic(selectedFile(), { inventoryId }).catch(err =>
    console.error('[hub] could not save the selected inventory:', err),
  )
}

export async function getSelectedInventory(): Promise<number | null> {
  if (memory.selectedInventoryId !== null) return memory.selectedInventoryId
  try {
    const saved = JSON.parse(await readFile(selectedFile(), 'utf8')) as { inventoryId: number }
    memory.selectedInventoryId = saved.inventoryId
    return saved.inventoryId
  } catch {
    return null
  }
}

/** Before this the device's clock clearly wasn't set (no NTP without internet). */
const EARLIEST_VALID_TIME = Date.parse('2020-01-01T00:00:00Z')

/**
 * The device stamps runs with its NTP clock, which reads 1970 when it booted
 * without internet. Replace such times with when the laptop received the run.
 */
export function fixStartedAt(startedAt: string | undefined, durationMs: number, receivedAt: Date): string {
  const parsed = startedAt ? Date.parse(startedAt) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= EARLIEST_VALID_TIME) return new Date(parsed).toISOString()
  return new Date(receivedAt.getTime() - durationMs).toISOString()
}

function runsDir(): string {
  return path.join(hubDir(), 'runs')
}

/**
 * File name for a run: safe characters only (the real run_id stays inside the
 * file), plus a short hash so different ids never map to the same name.
 */
export function runFileName(runId: string): string {
  if (runId.length === 0) throw new Error('invalid run id')
  const safe = runId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60)
  const hash = createHash('sha256').update(runId).digest('hex').slice(0, 8)
  return `${safe}-${hash}.json`
}

function runFile(runId: string): string {
  return path.join(runsDir(), runFileName(runId))
}

/** Write via a temp file + rename, so a crash never leaves half a file. */
async function writeAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(data), 'utf8')
  await rename(tmp, file)
}

export async function savePendingRun(run: HubPendingRun): Promise<void> {
  await writeAtomic(runFile(run.run_id), run)
}

export async function listPendingRuns(): Promise<HubPendingRun[]> {
  let names: string[]
  try {
    names = await readdir(runsDir())
  } catch {
    return []
  }
  const runs = await Promise.all(
    names
      .filter(n => n.endsWith('.json'))
      .map(async n => {
        try {
          return JSON.parse(await readFile(path.join(runsDir(), n), 'utf8')) as HubPendingRun
        } catch {
          return null
        }
      }),
  )
  return runs
    .filter((r): r is HubPendingRun => r !== null)
    .sort((a, b) => a.received_at.localeCompare(b.received_at))
}

export async function deletePendingRun(runId: string): Promise<void> {
  await rm(runFile(runId), { force: true })
}

interface CatalogCache {
  lastInventoryId: number | null
  byInventory: Record<string, CatalogRow[]>
}

function catalogFile(): string {
  return path.join(hubDir(), 'catalog.json')
}

async function readCatalogCache(): Promise<CatalogCache> {
  try {
    return JSON.parse(await readFile(catalogFile(), 'utf8')) as CatalogCache
  } catch {
    return { lastInventoryId: null, byInventory: {} }
  }
}

export async function saveCatalog(inventoryId: number, rows: CatalogRow[]): Promise<void> {
  const cache = await readCatalogCache()
  await writeAtomic(catalogFile(), {
    lastInventoryId: inventoryId,
    byInventory: { ...cache.byInventory, [String(inventoryId)]: rows },
  })
}

/** The cached component list for an inventory (default: the last one served). */
export async function loadCatalog(inventoryId: number | null): Promise<{ inventoryId: number; rows: CatalogRow[] } | null> {
  const cache = await readCatalogCache()
  const id = inventoryId ?? cache.lastInventoryId
  if (id === null) return null
  const rows = cache.byInventory[String(id)]
  return rows ? { inventoryId: id, rows } : null
}
