import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  deletePendingRun,
  fixStartedAt,
  listPendingRuns,
  loadCatalog,
  saveCatalog,
  runFileName,
  savePendingRun,
  getSelectedInventory,
  hubMemory,
  setSelectedInventory,
  type HubPendingRun,
} from './store'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'deskstock-hub-'))
  process.env.LOCAL_HUB_DIR = dir
})

afterEach(async () => {
  delete process.env.LOCAL_HUB_DIR
  await rm(dir, { recursive: true, force: true })
})

function run(runId: string, receivedAt: string): HubPendingRun {
  return {
    run_id: runId,
    inventory_id: 13,
    started_at: '2026-10-22T10:00:00.000Z',
    duration_ms: 60_000,
    bins: [{ name: 'Button', weight_g: 1.2, bin: 5, count: 4 }],
    received_at: receivedAt,
  }
}

describe('fixStartedAt', () => {
  const received = new Date('2026-10-22T10:05:00.000Z')

  test('keeps a valid start time', () => {
    expect(fixStartedAt('2026-10-22T10:00:00Z', 300_000, received)).toBe('2026-10-22T10:00:00.000Z')
  })

  test('replaces a 1970 start time (device clock never set) with received time minus duration', () => {
    expect(fixStartedAt('1970-01-01T00:02:13Z', 300_000, received)).toBe('2026-10-22T10:00:00.000Z')
  })

  test('replaces a missing or unreadable start time', () => {
    expect(fixStartedAt(undefined, 60_000, received)).toBe('2026-10-22T10:04:00.000Z')
    expect(fixStartedAt('not a date', 0, received)).toBe('2026-10-22T10:05:00.000Z')
  })
})

describe('pending runs', () => {
  test('are saved one file each and listed oldest first', async () => {
    await savePendingRun(run('run-222', '2026-10-22T10:02:00.000Z'))
    await savePendingRun(run('run-111', '2026-10-22T10:01:00.000Z'))

    const runs = await listPendingRuns()

    expect(runs.map(r => r.run_id)).toEqual(['run-111', 'run-222'])
    expect((await readdir(path.join(dir, 'runs'))).filter(n => n.endsWith('.tmp'))).toEqual([])
  })

  test('saving the same run again replaces it instead of duplicating', async () => {
    await savePendingRun(run('run-111', '2026-10-22T10:01:00.000Z'))
    await savePendingRun({ ...run('run-111', '2026-10-22T10:01:00.000Z'), duration_ms: 1 })

    const runs = await listPendingRuns()

    expect(runs).toHaveLength(1)
    expect(runs[0].duration_ms).toBe(1)
  })

  test('can be deleted, and deleting a missing run is fine', async () => {
    await savePendingRun(run('run-111', '2026-10-22T10:01:00.000Z'))

    await deletePendingRun('run-111')
    await deletePendingRun('run-111')

    expect(await listPendingRuns()).toEqual([])
  })

  test('unusual run ids are stored under a safe file name, keeping the real id', async () => {
    await savePendingRun(run('../evil id:1', '2026-10-22T10:01:00.000Z'))

    const files = await readdir(path.join(dir, 'runs'))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^[A-Za-z0-9_-]+\.json$/)
    expect((await listPendingRuns())[0].run_id).toBe('../evil id:1')

    await deletePendingRun('../evil id:1')
    expect(await listPendingRuns()).toEqual([])
  })

  test('different ids never share a file name', () => {
    expect(runFileName('run a')).not.toBe(runFileName('run_a'))
  })

  test('an empty hub has no pending runs', async () => {
    expect(await listPendingRuns()).toEqual([])
  })
})

describe('catalog cache', () => {
  test('returns the component list saved for an inventory', async () => {
    await saveCatalog(13, [{ name: 'Button', weight_g: 1.2 }])
    await saveCatalog(9, [{ name: 'jack', weight_g: 4.4 }])

    expect(await loadCatalog(13)).toEqual({ inventoryId: 13, rows: [{ name: 'Button', weight_g: 1.2 }] })
  })

  test('defaults to the last inventory served', async () => {
    await saveCatalog(13, [{ name: 'Button', weight_g: 1.2 }])
    await saveCatalog(9, [{ name: 'jack', weight_g: 4.4 }])

    expect((await loadCatalog(null))?.inventoryId).toBe(9)
  })

  test('returns nothing when no list is cached', async () => {
    expect(await loadCatalog(null)).toBeNull()
    await saveCatalog(13, [])
    expect(await loadCatalog(5)).toBeNull()
  })
})

describe('selected inventory', () => {
  test('survives a hub restart', async () => {
    await setSelectedInventory(13)
    hubMemory().selectedInventoryId = null // as after a restart

    expect(await getSelectedInventory()).toBe(13)
  })
})
