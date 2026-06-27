import { MockConnection } from './MockConnection'
// swap to real device: import { MqttConnection } from './MqttConnection'
import type { DeviceConnection } from './types'

export function createConnection(): DeviceConnection {
  return new MockConnection()
  // return new MqttConnection(process.env.NEXT_PUBLIC_MQTT_URL!)
}
