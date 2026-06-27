export interface BinState {
  idx: number
  component: string
  count: number
}

export interface DeviceState {
  online: boolean
  rssi: number | null
  fw: string | null
  runId: string | null
  profile: string | null
  bins: BinState[]
  elapsedMs: number
  estRemainingMs: number | null
  runStatus: 'idle' | 'running' | 'complete'
  totalSorted: number | null
  durationMs: number | null
}

export const INITIAL_DEVICE_STATE: DeviceState = {
  online: false,
  rssi: null,
  fw: null,
  runId: null,
  profile: null,
  bins: [],
  elapsedMs: 0,
  estRemainingMs: null,
  runStatus: 'idle',
  totalSorted: null,
  durationMs: null,
}
