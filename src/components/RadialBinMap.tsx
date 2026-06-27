import type { BinState } from '@/lib/device/state'
import { BinCard } from './BinCard'
import { ProgressRing } from './ProgressRing'

const CONTAINER = 520
const CENTER = CONTAINER / 2
const ORBIT_R = 190
const BIN_SIZE = 90
const HUB_R = 82
const MAX_BINS = 7

interface RadialBinMapProps {
  bins: BinState[]
  runStatus: 'idle' | 'running' | 'complete'
  elapsedMs: number
  estRemainingMs: number | null
  totalSorted: number | null
}

export function RadialBinMap({
  bins,
  runStatus,
  elapsedMs,
  estRemainingMs,
  totalSorted,
}: RadialBinMapProps) {
  const slotCount = Math.max(MAX_BINS, bins.length)
  const slots: (BinState | null)[] = Array.from({ length: slotCount }, (_, i) => bins[i] ?? null)

  return (
    <div className="relative mx-auto" style={{ width: CONTAINER, height: CONTAINER }}>
      {/* Dashed orbit ring */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={CONTAINER}
        height={CONTAINER}
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={ORBIT_R}
          fill="none"
          stroke="rgba(148,163,184,0.15)"
          strokeWidth={1}
          strokeDasharray="4 7"
        />
        {/* Spoke lines from hub edge to bin center */}
        {slots.map((_, i) => {
          const angleDeg = -90 + i * (360 / slotCount)
          const angleRad = (angleDeg * Math.PI) / 180
          const bx = CENTER + ORBIT_R * Math.cos(angleRad)
          const by = CENTER + ORBIT_R * Math.sin(angleRad)
          const sx = CENTER + HUB_R * Math.cos(angleRad)
          const sy = CENTER + HUB_R * Math.sin(angleRad)
          return (
            <line
              key={i}
              x1={sx}
              y1={sy}
              x2={bx}
              y2={by}
              stroke="rgba(148,163,184,0.08)"
              strokeWidth={1}
            />
          )
        })}
      </svg>

      {/* Bin cards */}
      {slots.map((bin, i) => {
        const angleDeg = -90 + i * (360 / slotCount)
        const angleRad = (angleDeg * Math.PI) / 180
        const x = CENTER + ORBIT_R * Math.cos(angleRad) - BIN_SIZE / 2
        const y = CENTER + ORBIT_R * Math.sin(angleRad) - BIN_SIZE / 2
        return (
          <div
            key={i}
            className="absolute"
            style={{ left: x, top: y, width: BIN_SIZE, height: BIN_SIZE }}
          >
            <BinCard idx={i} bin={bin} />
          </div>
        )
      })}

      {/* Center hub */}
      <div
        className="absolute rounded-full flex items-center justify-center"
        style={{
          left: CENTER - HUB_R,
          top: CENTER - HUB_R,
          width: HUB_R * 2,
          height: HUB_R * 2,
          background: 'radial-gradient(circle at 40% 35%, #1e3a5f 0%, #0f172a 70%)',
          border: '1.5px solid rgba(6,182,212,0.2)',
          boxShadow: '0 0 32px rgba(6,182,212,0.08)',
        }}
      >
        <ProgressRing
          runStatus={runStatus}
          elapsedMs={elapsedMs}
          estRemainingMs={estRemainingMs}
          totalSorted={totalSorted}
        />
      </div>
    </div>
  )
}
