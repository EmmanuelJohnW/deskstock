import { MockConnection } from './MockConnection'
import { RealtimeConnection } from './RealtimeConnection'
import type { DeviceConnection } from './types'

export function createConnection(): DeviceConnection {
  // Must reference NEXT_PUBLIC_ vars as full literal strings — Next.js replaces
  // them at build time via static analysis and will NOT inline a dynamic key.
  const useMock = process.env.NEXT_PUBLIC_USE_MOCK === 'true'
  console.log('[DeskStock] connection:', useMock ? 'mock' : 'realtime')
  return useMock ? new MockConnection() : new RealtimeConnection()
}
