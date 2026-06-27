import type { DeviceConnection, MessageHandler } from './types'

export class MqttConnection implements DeviceConnection {
  constructor(private readonly brokerUrl: string) {}

  connect(): void {
    throw new Error('MqttConnection not yet implemented — see build step 6')
  }

  disconnect(): void {}

  subscribe(_handler: MessageHandler): () => void {
    return () => {}
  }

  start(_profile?: string): void {
    // TODO: publish to command/sort/start topic
    throw new Error('MqttConnection.start not yet implemented')
  }

  stop(): void {
    // TODO: publish to command/sort/stop topic
    throw new Error('MqttConnection.stop not yet implemented')
  }
}
