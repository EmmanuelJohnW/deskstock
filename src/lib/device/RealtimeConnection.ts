'use client'

import { getSupabaseClient } from '@/lib/supabase/client'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { DeviceConnection, DeviceMessage, MessageHandler } from './types'
import { LIVE_RUN_STALE_MS } from './liveRunStaleness'

const STALE_CHECK_INTERVAL_MS = 10_000

// Shape as stored in the live_runs.bins jsonb column — matches the device's
// wire payload (validated by BinSchema in api/ingest/route.ts), not the
// internal BinState naming used by the reducer.
type BinRow = { name: string; weight_g: number; bin: number; count: number }

type LiveRunRow = {
  run_id: string
  status: string
  elapsed_ms: number
  est_remaining_ms: number | null
  bins: BinRow[]
  updated_at: string
}

export class RealtimeConnection implements DeviceConnection {
  readonly controllable = false
  private handlers = new Set<MessageHandler>()
  private channel: RealtimeChannel | null = null
  private prevBins = new Map<number, number>()
  private lastRow: LiveRunRow | null = null
  private staleWatchdog: ReturnType<typeof setInterval> | null = null

  connect(): void {
    const supabase = getSupabaseClient()
    this.channel = supabase
      .channel('live-run-changes')
      .on<LiveRunRow>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_runs' },
        (payload) => this.handleChange(payload),
      )
      .subscribe((status) => {
        // Emit only after the channel is confirmed open — connect() fires before
        // useDevice calls subscribe(dispatch), so any emit here is guaranteed
        // to have handlers registered.
        if (status === 'SUBSCRIBED') {
          // rssi isn't part of the current wire protocol (no per-request signal
          // telemetry) — null rather than a fabricated number, so StatusBar
          // correctly hides the reading instead of showing fake signal quality.
          this.emit({ topic: 'device/status', payload: { online: true, rssi: null, fw: 'realtime' } })
          void this.catchUp(supabase)
        }
      })

    // Push events only fire when the row changes — if the device dies mid-run,
    // nothing ever arrives to clear lastRow. Poll our own cached state instead.
    this.staleWatchdog = setInterval(() => this.checkStaleness(), STALE_CHECK_INTERVAL_MS)
  }

  disconnect(): void {
    this.channel?.unsubscribe()
    this.channel = null
    this.handlers.clear()
    this.prevBins.clear()
    this.lastRow = null
    if (this.staleWatchdog) {
      clearInterval(this.staleWatchdog)
      this.staleWatchdog = null
    }
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  // Physical device controls sort start/stop — these are intentional no-ops
  start(): void {}
  stop(): void {}

  private emit(msg: DeviceMessage): void {
    this.handlers.forEach(h => h(msg))
  }

  private async catchUp(supabase: ReturnType<typeof getSupabaseClient>): Promise<void> {
    // A row left over from a device that died mid-run (no 'complete' ping)
    // must not be picked back up as an in-progress sort on page load.
    const cutoff = new Date(Date.now() - LIVE_RUN_STALE_MS).toISOString()
    const { data } = await supabase
      .from('live_runs')
      .select('*')
      .gte('updated_at', cutoff)
      .order('updated_at', { ascending: false })
      .limit(1)
    const row = data?.[0] ? (data[0] as LiveRunRow) : null
    if (!row) return
    this.lastRow = row
    // Seed prevBins with actual counts so the first UPDATE emits only the delta,
    // not the full accumulated total again.
    this.prevBins = new Map(row.bins.map(b => [b.bin, b.count]))
    this.emit({
      topic: 'sort/start',
      payload: { run_id: row.run_id, bins: row.bins.map(b => ({ idx: b.bin, name: b.name })) },
    })
    // Emit current counts as a single bin/event burst so the UI is fully hydrated.
    for (const bin of row.bins) {
      if (bin.count > 0) {
        this.emit({
          topic: 'bin/event',
          payload: { run_id: row.run_id, bin: bin.bin, component: bin.name, count: bin.count },
        })
      }
    }
    this.emitProgress(row)
  }

  private handleChange(payload: RealtimePostgresChangesPayload<LiveRunRow>): void {
    if (payload.eventType === 'INSERT') {
      const row = payload.new
      this.lastRow = row
      this.prevBins = new Map(row.bins.map((b: BinRow) => [b.bin, 0]))
      this.emit({
        topic: 'sort/start',
        payload: { run_id: row.run_id, bins: row.bins.map((b: BinRow) => ({ idx: b.bin, name: b.name })) },
      })
      this.emitBinDeltas(row)
      this.emitProgress(row)
    } else if (payload.eventType === 'UPDATE') {
      const row = payload.new
      this.lastRow = row
      this.emitBinDeltas(row)
      this.emitProgress(row)
    } else if (payload.eventType === 'DELETE') {
      // Use this.lastRow (updated on every UPDATE) — payload.old without
      // REPLICA IDENTITY FULL only carries the PK, so bins would be empty.
      const row = this.lastRow
      if (!row?.run_id) return
      const total = row.bins.reduce((acc: number, b: BinRow) => acc + b.count, 0)
      this.emit({
        topic: 'sort/complete',
        payload: { run_id: row.run_id, total, duration_ms: row.elapsed_ms },
      })
      this.prevBins.clear()
      this.lastRow = null
    }
  }

  private emitBinDeltas(row: LiveRunRow): void {
    for (const bin of row.bins) {
      const prev = this.prevBins.get(bin.bin) ?? 0
      const delta = bin.count - prev
      if (delta > 0) {
        this.emit({
          topic: 'bin/event',
          payload: { run_id: row.run_id, bin: bin.bin, component: bin.name, count: delta },
        })
      }
    }
    this.prevBins = new Map(row.bins.map(b => [b.bin, b.count]))
  }

  // No DELETE event ever arrives if the device just stops pinging — treat a
  // run as abandoned once its last update falls outside the staleness window,
  // and clear it the same way an explicit stop() would (sort/cancelled).
  private checkStaleness(): void {
    if (!this.lastRow) return
    const age = Date.now() - new Date(this.lastRow.updated_at).getTime()
    if (age < LIVE_RUN_STALE_MS) return

    const runId = this.lastRow.run_id
    this.prevBins.clear()
    this.lastRow = null
    this.emit({ topic: 'sort/cancelled', payload: { run_id: runId } })
  }

  private emitProgress(row: LiveRunRow): void {
    if (row.elapsed_ms > 0) {
      this.emit({
        topic: 'sort/progress',
        payload: {
          run_id: row.run_id,
          elapsed_ms: row.elapsed_ms,
          est_remaining_ms: row.est_remaining_ms ?? 0,
        },
      })
    }
  }
}
