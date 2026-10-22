import type { DeviceMessage } from './types'

// Turns snapshots of the sort in progress (live_runs rows from Supabase
// Realtime, or the same shape from the laptop hub) into the device messages
// the Sort page understands. One tracker can be fed by both sources: rows are
// keyed by run_id, older snapshots are ignored, and each run completes once.

// Shape as stored in the live_runs.bins jsonb column — matches the device's
// wire payload (validated in api/ingest/route.ts), not the reducer's naming.
export type LiveBinRow = { name: string; weight_g: number; bin: number; count: number }

export type LiveRunRow = {
  run_id: string
  status: string
  elapsed_ms: number
  est_remaining_ms: number | null
  bins: LiveBinRow[]
  updated_at: string
}

export class LiveRunTracker {
  private lastRow: LiveRunRow | null = null
  private prevBins = new Map<number, number>()
  private readonly finished = new Set<string>()

  constructor(
    private readonly emit: (msg: DeviceMessage) => void,
    private readonly staleAfterMs: number,
  ) {}

  get currentRunId(): string | null {
    return this.lastRow?.run_id ?? null
  }

  /** A new snapshot of a running sort. Starts the run on first sight. */
  apply(row: LiveRunRow): void {
    if (this.finished.has(row.run_id)) return
    const isNewRun = this.lastRow?.run_id !== row.run_id
    if (!isNewRun && this.lastRow && row.elapsed_ms < this.lastRow.elapsed_ms) return

    if (isNewRun) {
      this.prevBins = new Map()
      this.emit({
        topic: 'sort/start',
        payload: { run_id: row.run_id, bins: row.bins.map(b => ({ idx: b.bin, name: b.name })) },
      })
    }
    this.lastRow = row
    this.emitBinDeltas(row)
    this.emitProgress(row)
  }

  /** The run finished. With a run id, only completes that run. */
  complete(runId?: string, summary?: { total: number; duration_ms: number }): void {
    const row = this.lastRow
    if (!row || (runId !== undefined && runId !== row.run_id)) return
    const total = summary?.total ?? row.bins.reduce((acc, b) => acc + b.count, 0)
    this.emit({
      topic: 'sort/complete',
      payload: { run_id: row.run_id, total, duration_ms: summary?.duration_ms ?? row.elapsed_ms },
    })
    this.finished.add(row.run_id)
    this.reset()
  }

  /** No update for too long: the device stopped mid-run (no 'complete' arrived). */
  checkStaleness(now = Date.now()): void {
    if (!this.lastRow) return
    if (now - new Date(this.lastRow.updated_at).getTime() < this.staleAfterMs) return
    const runId = this.lastRow.run_id
    this.reset()
    this.emit({ topic: 'sort/cancelled', payload: { run_id: runId } })
  }

  private reset(): void {
    this.prevBins = new Map()
    this.lastRow = null
  }

  private emitBinDeltas(row: LiveRunRow): void {
    for (const bin of row.bins) {
      const delta = bin.count - (this.prevBins.get(bin.bin) ?? 0)
      if (delta > 0) {
        this.emit({
          topic: 'bin/event',
          payload: { run_id: row.run_id, bin: bin.bin, component: bin.name, count: delta },
        })
      }
    }
    this.prevBins = new Map(row.bins.map(b => [b.bin, b.count]))
  }

  private emitProgress(row: LiveRunRow): void {
    if (row.elapsed_ms <= 0) return
    this.emit({
      topic: 'sort/progress',
      payload: { run_id: row.run_id, elapsed_ms: row.elapsed_ms, est_remaining_ms: row.est_remaining_ms ?? 0 },
    })
  }
}
