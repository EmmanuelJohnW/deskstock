export interface DeviceStatusPayload {
  online: boolean
  rssi: number
  fw: string
}

export interface SortStartPayload {
  run_id: string
  profile: string
  bins: string[]
}

export interface BinEventPayload {
  run_id: string
  bin: number
  component: string
  count: number // delta — items just sorted into this bin
}

export interface SortProgressPayload {
  run_id: string
  elapsed_ms: number
  est_remaining_ms: number
}

export interface SortCompletePayload {
  run_id: string
  total: number
  duration_ms: number
}

export interface SortCancelledPayload {
  run_id: string
}

export type DeviceMessage =
  | { topic: 'device/status'; payload: DeviceStatusPayload }
  | { topic: 'sort/start'; payload: SortStartPayload }
  | { topic: 'bin/event'; payload: BinEventPayload }
  | { topic: 'sort/progress'; payload: SortProgressPayload }
  | { topic: 'sort/complete'; payload: SortCompletePayload }
  | { topic: 'sort/cancelled'; payload: SortCancelledPayload }

export type MessageHandler = (msg: DeviceMessage) => void

export interface DeviceConnection {
  connect(): void
  disconnect(): void
  subscribe(handler: MessageHandler): () => void
  start(profile?: string): void
  stop(): void
}
