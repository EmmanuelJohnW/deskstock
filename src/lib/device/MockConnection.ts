import type { DeviceConnection, MessageHandler, DeviceMessage } from './types'

// Index 0 mirrors the real reject/unknown chute; indices 1-5 are mock
// registered components — matches BIN_COUNT/REJECT_BIN_IDX in binLayout.ts.
const MOCK_BINS = ['Unknown', '10kΩ', '100nF', 'LED Red', 'ATtiny85', '1N4148']

// Per-component weight, grams — only exists so useDevice's dev-mode persistence
// path (POST /api/runs) can populate weight_g on each bin, matching the shape
// /api/ingest's BinSchema expects. Not physically meaningful for 'Unknown'
// (reject); weight_g isn't stored anywhere downstream, it just has to be positive.
export const MOCK_BIN_WEIGHTS_G: Record<string, number> = {
  Unknown: 1,
  '10kΩ': 0.24,
  '100nF': 0.06,
  'LED Red': 0.09,
  ATtiny85: 0.12,
  '1N4148': 0.03,
}

const STEP_MS = 1500
const STEPS = 20
const COMPONENTS_PER_STEP = 10 // delta emitted per bin/event
const STATUS_INTERVAL_MS = 5000

export class MockConnection implements DeviceConnection {
  readonly controllable = true
  private handlers = new Set<MessageHandler>()
  private heartbeatTimers: ReturnType<typeof setTimeout>[] = []
  private sortTimers: ReturnType<typeof setTimeout>[] = []
  private active = false
  private currentRunId: string | null = null

  connect(): void {
    this.active = true
    this.emitStatus()
    this.scheduleHeartbeat()
  }

  disconnect(): void {
    this.active = false
    this.clearAllTimers()
    this.handlers.clear()
  }

  start(): void {
    if (!this.active) return
    this.clearSortTimers()
    this.runCycle()
  }

  stop(): void {
    this.clearSortTimers()
    if (this.currentRunId) {
      this.emit({ topic: 'sort/cancelled', payload: { run_id: this.currentRunId } })
      this.currentRunId = null
    }
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  private emit(msg: DeviceMessage): void {
    this.handlers.forEach(h => h(msg))
  }

  private heartbeat(ms: number, fn: () => void): void {
    const t = setTimeout(() => { if (this.active) fn() }, ms)
    this.heartbeatTimers.push(t)
  }

  private sortAt(ms: number, fn: () => void): void {
    const t = setTimeout(() => { if (this.active) fn() }, ms)
    this.sortTimers.push(t)
  }

  private clearSortTimers(): void {
    this.sortTimers.forEach(clearTimeout)
    this.sortTimers = []
  }

  private clearAllTimers(): void {
    this.heartbeatTimers.forEach(clearTimeout)
    this.heartbeatTimers = []
    this.clearSortTimers()
  }

  private emitStatus(): void {
    this.emit({ topic: 'device/status', payload: { online: true, rssi: -58, fw: '1.4.2' } })
  }

  private scheduleHeartbeat(): void {
    this.heartbeat(STATUS_INTERVAL_MS, () => {
      this.emitStatus()
      this.scheduleHeartbeat()
    })
  }

  private runCycle(): void {
    const runId = `mock-${Date.now()}`
    this.currentRunId = runId
    const BIN_COUNT = MOCK_BINS.length
    const totalComponents = STEPS * COMPONENTS_PER_STEP

    this.emit({
      topic: 'sort/start',
      payload: { run_id: runId, bins: MOCK_BINS.map((name, idx) => ({ idx, name })) },
    })

    let totalDispatched = 0

    for (let step = 0; step < STEPS; step++) {
      const delay = (step + 1) * STEP_MS
      const bin = step % BIN_COUNT

      this.sortAt(delay, () => {
        totalDispatched += COMPONENTS_PER_STEP

        // count is a delta — how many items just landed in this bin
        this.emit({
          topic: 'bin/event',
          payload: { run_id: runId, bin, component: MOCK_BINS[bin], count: COMPONENTS_PER_STEP },
        })

        this.emit({
          topic: 'sort/progress',
          payload: {
            run_id: runId,
            elapsed_ms: delay,
            est_remaining_ms: (totalComponents - totalDispatched) * (STEP_MS / COMPONENTS_PER_STEP),
          },
        })
      })
    }

    const completionDelay = STEPS * STEP_MS + 200

    this.sortAt(completionDelay, () => {
      this.currentRunId = null
      this.emit({
        topic: 'sort/complete',
        payload: { run_id: runId, total: totalComponents, duration_ms: completionDelay },
      })
      // one run per start() — no auto-repeat
    })
  }
}
