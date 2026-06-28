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

  // Tracks wall-clock start time keyed by runId so persist_run gets an accurate started_at
  const runStartRef = useRef<{ runId: string; startedAt: number } | null>(null)
  // Guard: stores the last runId we POSTed so the effect fires exactly once per run
  const lastPersistedRef = useRef<string | null>(null)

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

  // Capture wall-clock start time whenever a new run begins
  useEffect(() => {
    if (state.runStatus === 'running' && state.runId) {
      if (runStartRef.current?.runId !== state.runId) {
        runStartRef.current = { runId: state.runId, startedAt: Date.now() }
      }
    }
  }, [state.runStatus, state.runId])

  // Persist completed run to /api/runs — dev/mock only.
  // In production, /api/ingest owns persistence; this effect is a no-op there.
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_USE_MOCK !== 'true') return
    if (state.runStatus !== 'complete' || !state.runId) return
    if (state.runId === lastPersistedRef.current) return

    // Set guard before fetch so React StrictMode's double-fire doesn't double-post
    lastPersistedRef.current = state.runId

    const startedAt =
      runStartRef.current?.runId === state.runId
        ? new Date(runStartRef.current.startedAt).toISOString()
        : new Date(Date.now() - (state.durationMs ?? 0)).toISOString()

    fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_id: state.runId,
        profile: state.profile ?? 'Unknown',
        total: state.totalSorted ?? 0,
        duration_ms: state.durationMs ?? 0,
        started_at: startedAt,
        bins: state.bins.map(b => ({ idx: b.idx, component: b.component, count: b.count })),
      }),
    }).catch(err => {
      console.error('[useDevice] Failed to persist run:', err)
    })
  }, [state.runStatus, state.runId]) // eslint-disable-line react-hooks/exhaustive-deps
  // ^ state.bins/totalSorted/durationMs/profile are stable at the point runStatus→'complete'
  //   fires; including them would cause spurious re-runs on every bin/event tick

  const start = useCallback((profile?: string) => {
    connRef.current?.start(profile)
  }, [])

  const stop = useCallback(() => {
    connRef.current?.stop()
  }, [])

  return { ...state, start, stop }
}
