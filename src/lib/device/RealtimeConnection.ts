'use client'

import { getSupabaseClient } from '@/lib/supabase/client'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { DeviceConnection, DeviceMessage, MessageHandler } from './types'
import { LIVE_RUN_STALE_MS } from './liveRunStaleness'
import { LiveRunTracker, type LiveRunRow } from './LiveRunTracker'

const STALE_CHECK_INTERVAL_MS = 10_000

/**
 * Live sort view from Supabase Realtime (live_runs rows written by
 * /api/ingest on the hosted site). Pass a shared tracker to combine it with
 * the laptop hub's feed (see connection.ts).
 */
export class RealtimeConnection implements DeviceConnection {
  readonly controllable = false
  private handlers = new Set<MessageHandler>()
  private channel: RealtimeChannel | null = null
  private staleWatchdog: ReturnType<typeof setInterval> | null = null
  private readonly tracker: LiveRunTracker

  constructor(sharedTracker?: LiveRunTracker) {
    this.tracker = sharedTracker ?? new LiveRunTracker(msg => this.emit(msg), LIVE_RUN_STALE_MS)
  }

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
    // nothing ever arrives to clear the run. Poll the tracker's state instead.
    this.staleWatchdog = setInterval(() => this.tracker.checkStaleness(), STALE_CHECK_INTERVAL_MS)
  }

  disconnect(): void {
    this.channel?.unsubscribe()
    this.channel = null
    this.handlers.clear()
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
    if (row) this.tracker.apply(row)
  }

  private handleChange(payload: RealtimePostgresChangesPayload<LiveRunRow>): void {
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      // Data arriving through the hosted site means the device is online.
      this.emit({ topic: 'device/status', payload: { online: true, rssi: null, fw: 'realtime' } })
      this.tracker.apply(payload.new)
    } else if (payload.eventType === 'DELETE') {
      // payload.old without REPLICA IDENTITY FULL only carries the PK, so the
      // tracker completes its own last row for this run.
      const runId = (payload.old as Partial<LiveRunRow>).run_id
      this.tracker.complete(runId)
    }
  }
}
