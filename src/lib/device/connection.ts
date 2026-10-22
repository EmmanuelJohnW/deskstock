import { MockConnection } from './MockConnection'
import { RealtimeConnection } from './RealtimeConnection'
import { LocalHubConnection } from './LocalHubConnection'
import { LiveRunTracker } from './LiveRunTracker'
import { LIVE_RUN_STALE_MS } from './liveRunStaleness'
import type { DeviceConnection, DeviceMessage, MessageHandler } from './types'
import { isForcedOffline } from '@/lib/offline/network'

/**
 * On the laptop hub the device may report either online (Supabase Realtime)
 * or to this laptop (no internet). Both feed one tracker, so the Sort page
 * shows a single sort whichever path it took.
 */
class HubAwareConnection implements DeviceConnection {
  readonly controllable = false
  private handlers = new Set<MessageHandler>()
  private readonly tracker = new LiveRunTracker(msg => this.emit(msg), LIVE_RUN_STALE_MS)
  private readonly sources: DeviceConnection[] = [
    new RealtimeConnection(this.tracker),
    new LocalHubConnection(this.tracker),
  ]
  private unsubscribers: (() => void)[] = []

  connect(): void {
    // Sources emit their own device/status messages; forward them.
    this.unsubscribers = this.sources.map(s => s.subscribe(msg => this.emit(msg)))
    this.sources.forEach(s => s.connect())
  }

  disconnect(): void {
    this.unsubscribers.forEach(u => u())
    this.sources.forEach(s => s.disconnect())
    this.handlers.clear()
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  start(): void {}
  stop(): void {}

  private emit(msg: DeviceMessage): void {
    this.handlers.forEach(h => h(msg))
  }
}

export function createConnection(): DeviceConnection {
  // Must reference NEXT_PUBLIC_ vars as full literal strings — Next.js replaces
  // them at build time via static analysis and will NOT inline a dynamic key.
  const useMock = process.env.NEXT_PUBLIC_USE_MOCK === 'true'
  const isHub = process.env.NEXT_PUBLIC_LOCAL_HUB === 'true'
  if (useMock) return new MockConnection()
  if (!isHub) return new RealtimeConnection()
  // "Work offline" on the laptop: don't open a live connection to the internet at all.
  return isForcedOffline() ? new LocalHubConnection() : new HubAwareConnection()
}
