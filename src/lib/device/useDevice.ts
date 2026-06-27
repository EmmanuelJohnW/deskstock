'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { createConnection } from './connection'
import { INITIAL_DEVICE_STATE } from './state'
import type { BinState, DeviceState } from './state'
import type { DeviceConnection, DeviceMessage } from './types'

function reduce(state: DeviceState, msg: DeviceMessage): DeviceState {
  switch (msg.topic) {
    case 'device/status':
      return {
        ...state,
        online: msg.payload.online,
        rssi: msg.payload.rssi,
        fw: msg.payload.fw,
      }

    case 'sort/start': {
      const bins: BinState[] = msg.payload.bins.map((component, idx) => ({
        idx,
        component,
        count: 0,
      }))
      return {
        ...state,
        runId: msg.payload.run_id,
        profile: msg.payload.profile,
        bins,
        elapsedMs: 0,
        estRemainingMs: null,
        runStatus: 'running',
        totalSorted: null,
        durationMs: null,
      }
    }

    case 'bin/event': {
      // count is a delta — accumulate into the running total for this bin
      const bins = state.bins.map(b =>
        b.idx === msg.payload.bin
          ? { ...b, count: b.count + msg.payload.count }
          : b
      )
      return { ...state, bins }
    }

    case 'sort/progress':
      return {
        ...state,
        elapsedMs: msg.payload.elapsed_ms,
        estRemainingMs: msg.payload.est_remaining_ms,
      }

    case 'sort/complete':
      return {
        ...state,
        runStatus: 'complete',
        totalSorted: msg.payload.total,
        durationMs: msg.payload.duration_ms,
      }

    case 'sort/cancelled':
      return {
        ...state,
        runStatus: 'idle',
      }
  }
}

export interface DeviceControls {
  start: (profile?: string) => void
  stop: () => void
}

export type UseDeviceReturn = DeviceState & DeviceControls

export function useDevice(): UseDeviceReturn {
  const [state, dispatch] = useReducer(reduce, INITIAL_DEVICE_STATE)
  const connRef = useRef<DeviceConnection | null>(null)

  useEffect(() => {
    const conn = createConnection()
    connRef.current = conn
    conn.connect()
    const unsub = conn.subscribe(dispatch)
    return () => {
      unsub()
      conn.disconnect()
      connRef.current = null
    }
  }, [])

  const start = useCallback((profile?: string) => {
    connRef.current?.start(profile)
  }, [])

  const stop = useCallback(() => {
    connRef.current?.stop()
  }, [])

  return { ...state, start, stop }
}
