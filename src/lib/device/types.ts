export interface DeviceStatusPayload {
  online: boolean
  rssi: number | null
  fw: string
}

export interface SortStartPayload {
  run_id: string
  // {idx, name} pairs, not a bare name array — bin identity must always flow
  // through as the real bin number. A real device's ingest payload can omit
  // empty bins, so the array's length/order shifts between polls; deriving
  // a bin's index from its position in this array (as opposed to its own
  // idx field) reintroduces exactly that bug.
  bins: { idx: number; name: string }[]
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
  start(): void
  stop(): void
  readonly controllable: boolean
}
