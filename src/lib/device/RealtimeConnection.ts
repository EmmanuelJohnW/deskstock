'use client'

import { getSupabaseClient } from '@/lib/supabase/client'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { DeviceConnection, DeviceMessage, MessageHandler } from './types'

type BinRow = { idx: number; component: string; count: number }

type LiveRunRow = {
  run_id: string
  status: string
  elapsed_ms: number
  est_remaining_ms: number | null
  bins: BinRow[]
  profile: string
}

export class RealtimeConnection implements DeviceConnection {
  private handlers = new Set<MessageHandler>()
  private channel: RealtimeChannel | null = null
  private prevBins = new Map<number, number>()
  private lastRow: LiveRunRow | null = null

  connect(): void {
    const supabase = getSupabaseClient()
    this.channel = supabase
      .channel('live-run-changes')
      .on<LiveRunRow>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_runs' },
        (payload) => this.handleChange(payload),
      )
      .subscribe()

    this.emit({ topic: 'device/status', payload: { online: true, rssi: 0, fw: 'realtime' } })
    void this.catchUp(supabase)
  }

  disconnect(): void {
    this.channel?.unsubscribe()
    this.channel = null
    this.handlers.clear()
    this.prevBins.clear()
    this.lastRow = null
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  // Physical device controls sort start/stop — these are intentional no-ops
  start(_profile?: string): void {}
  stop(): void {}

  private emit(msg: DeviceMessage): void {
    this.handlers.forEach(h => h(msg))
  }

  private async catchUp(supabase: ReturnType<typeof getSupabaseClient>): Promise<void> {
    const { data } = await supabase.from('live_runs').select('*')
    const row = data?.[0] ? (data[0] as LiveRunRow) : null
    if (!row) return
    this.lastRow = row
    // Seed prevBins with actual counts so the first UPDATE emits only the delta,
    // not the full accumulated total again.
    this.prevBins = new Map(row.bins.map(b => [b.idx, b.count]))
    this.emit({
      topic: 'sort/start',
      payload: { run_id: row.run_id, profile: row.profile, bins: row.bins.map(b => b.component) },
    })
    // Emit current counts as a single bin/event burst so the UI is fully hydrated.
    for (const bin of row.bins) {
      if (bin.count > 0) {
        this.emit({
          topic: 'bin/event',
          payload: { run_id: row.run_id, bin: bin.idx, component: bin.component, count: bin.count },
        })
      }
    }
    this.emitProgress(row)
  }

  private handleChange(payload: RealtimePostgresChangesPayload<LiveRunRow>): void {
    if (payload.eventType === 'INSERT') {
      const row = payload.new
      this.lastRow = row
      this.prevBins = new Map(row.bins.map((b: BinRow) => [b.idx, 0]))
      this.emit({
        topic: 'sort/start',
        payload: { run_id: row.run_id, profile: row.profile, bins: row.bins.map((b: BinRow) => b.component) },
      })
      this.emitBinDeltas(row)
      this.emitProgress(row)
    } else if (payload.eventType === 'UPDATE') {
      const row = payload.new
      this.lastRow = row
      this.emitBinDeltas(row)
      this.emitProgress(row)
    } else if (payload.eventType === 'DELETE') {
      // With REPLICA IDENTITY FULL, old contains the final row state
      const row = (payload.old as unknown as LiveRunRow | null) ?? this.lastRow
      if (!row?.run_id) return
      const total = (row.bins ?? []).reduce((acc: number, b: BinRow) => acc + b.count, 0)
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
      const prev = this.prevBins.get(bin.idx) ?? 0
      const delta = bin.count - prev
      if (delta > 0) {
        this.emit({
          topic: 'bin/event',
          payload: { run_id: row.run_id, bin: bin.idx, component: bin.component, count: delta },
        })
      }
    }
    this.prevBins = new Map(row.bins.map(b => [b.idx, b.count]))
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
