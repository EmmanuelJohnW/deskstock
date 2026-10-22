'use client'

import type { DeviceConnection, DeviceMessage, MessageHandler } from './types'
import { LIVE_RUN_STALE_MS } from './liveRunStaleness'
import { LiveRunTracker, type LiveRunRow } from './LiveRunTracker'

// Live sort view from the laptop hub (docs/local-hub.md): when the device can't
// reach the internet it sends to this laptop, and the hub keeps the sort in
// progress in memory. Polled every second; no internet involved.

const POLL_INTERVAL_MS = 1000
/** The device counts as connected to this laptop if it called within this window. */
const DEVICE_SEEN_WINDOW_MS = 30_000
export const HUB_FW_LABEL = 'laptop hub'

interface HubLiveResponse {
  live: LiveRunRow | null
  lastCompleted: { run_id: string; total: number; duration_ms: number } | null
  deviceSeenAt: string | null
}

export class LocalHubConnection implements DeviceConnection {
  readonly controllable = false
  private handlers = new Set<MessageHandler>()
  private timer: ReturnType<typeof setInterval> | null = null
  private reportedOnline = false
  private readonly tracker: LiveRunTracker

  constructor(sharedTracker?: LiveRunTracker) {
    this.tracker = sharedTracker ?? new LiveRunTracker(msg => this.emit(msg), LIVE_RUN_STALE_MS)
  }

  connect(): void {
    this.poll()
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.handlers.clear()
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  start(): void {}
  stop(): void {}

  /** Only reports when the device talks to this laptop, and when it stops. */
  private reportStatus(deviceSeenAt: string | null): void {
    const isOnline = deviceSeenAt !== null && Date.now() - Date.parse(deviceSeenAt) < DEVICE_SEEN_WINDOW_MS
    if (!isOnline && !this.reportedOnline) return
    this.reportedOnline = isOnline
    this.emit({ topic: 'device/status', payload: { online: isOnline, rssi: null, fw: HUB_FW_LABEL } })
  }

  private emit(msg: DeviceMessage): void {
    this.handlers.forEach(h => h(msg))
  }

  private async poll(): Promise<void> {
    let data: HubLiveResponse
    try {
      const res = await fetch('/api/local/live', { cache: 'no-store' })
      if (!res.ok) return
      data = (await res.json()) as HubLiveResponse
    } catch {
      return
    }
    if (data.live) this.tracker.apply(data.live)
    this.reportStatus(data.deviceSeenAt)
    if (data.lastCompleted) {
      const { run_id, total, duration_ms } = data.lastCompleted
      this.tracker.complete(run_id, { total, duration_ms })
    }
    this.tracker.checkStaleness()
  }
}
