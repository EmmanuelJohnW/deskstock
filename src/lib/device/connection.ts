import { MockConnection } from './MockConnection'
import { RealtimeConnection } from './RealtimeConnection'
import type { DeviceConnection } from './types'

export function createConnection(): DeviceConnection {
  if (process.env.NEXT_PUBLIC_USE_MOCK === 'true') {
    return new MockConnection()
  }
  return new RealtimeConnection()
}
