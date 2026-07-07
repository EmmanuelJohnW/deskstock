'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createConnection } from './connection'
import { INITIAL_DEVICE_STATE } from './state'
import type { BinState, DeviceState } from './state'
import type { DeviceConnection, DeviceMessage } from './types'
import { MOCK_BIN_WEIGHTS_G } from './MockConnection'
import { BIN_COUNT } from './binLayout'

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
      // Always a fixed BIN_COUNT-length array keyed by real bin index — never
      // derived from array position, since the payload may only include a
      // subset of bins (see SortStartPayload). Bins not yet in the payload
      // start empty and pick up their name on their first bin/event.
      const bins: BinState[] = Array.from({ length: BIN_COUNT }, (_, idx) => {
        const known = msg.payload.bins.find(b => b.idx === idx)
        return { idx, component: known?.name ?? '', count: 0 }
      })
      return {
        ...state,
        runId: msg.payload.run_id,
        bins,
        elapsedMs: 0,
        estRemainingMs: null,
        runStatus: 'running',
        totalSorted: null,
        durationMs: null,
        lastBinEvent: null,
      }
    }

    case 'bin/event': {
      // count is a delta — accumulate into the running total for this bin.
      // Also (re)set component: a bin that started empty at sort/start only
      // learns its name once its first event arrives.
      const bins = state.bins.map(b =>
        b.idx === msg.payload.bin
          ? { ...b, component: msg.payload.component, count: b.count + msg.payload.count }
          : b
      )
      return {
        ...state,
        bins,
        lastBinEvent: {
          binIdx: msg.payload.bin,
          component: msg.payload.component,
          seq: (state.lastBinEvent?.seq ?? 0) + 1,
        },
      }
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
  start: () => void
  stop: () => void
  controllable: boolean
}

export type UseDeviceReturn = DeviceState & DeviceControls

export function useDevice(): UseDeviceReturn {
  const [state, dispatch] = useReducer(reduce, INITIAL_DEVICE_STATE)
  const connRef = useRef<DeviceConnection | null>(null)
  const [controllable, setControllable] = useState(false)

  // Tracks wall-clock start time keyed by runId so persist_run gets an accurate started_at
  const runStartRef = useRef<{ runId: string; startedAt: number } | null>(null)
  // Guard: stores the last runId we POSTed so the effect fires exactly once per run
  const lastPersistedRef = useRef<string | null>(null)

  useEffect(() => {
    const conn = createConnection()
    connRef.current = conn
    setControllable(conn.controllable)
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
  // /api/runs shares its persistence logic with /api/ingest (see
  // src/lib/ingest/completeRun.ts) so mock testing exercises the same
  // session-tally/reconciliation path a real device run does. It stays a
  // separate, unauthenticated endpoint rather than posting to /api/ingest
  // directly because INGEST_TOKEN is a server-only secret that must never
  // reach the browser bundle.
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
        duration_ms: state.durationMs ?? 0,
        started_at: startedAt,
        bins: state.bins.map(b => ({
          name: b.component,
          weight_g: MOCK_BIN_WEIGHTS_G[b.component] ?? 1,
          bin: b.idx,
          count: b.count,
        })),
      }),
    }).catch(err => {
      console.error('[useDevice] Failed to persist run:', err)
    })
  }, [state.runStatus, state.runId]) // eslint-disable-line react-hooks/exhaustive-deps
  // ^ state.bins/totalSorted/durationMs are stable at the point runStatus→'complete'
  //   fires; including them would cause spurious re-runs on every bin/event tick

  const start = useCallback(() => {
    connRef.current?.start()
  }, [])

  const stop = useCallback(() => {
    connRef.current?.stop()
  }, [])

  return { ...state, start, stop, controllable }
}
