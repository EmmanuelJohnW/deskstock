import type { BinState } from '@/lib/device/state'
import { HexBin } from './HexBin'
import { ProgressRing } from './ProgressRing'

const CONTAINER = 560
const CENTER = CONTAINER / 2
const ORBIT_R = 192
const HUB_R = 88

// Flat-top hex: width W, height W * sin(60°)
const HEX_W = 96
const HEX_H = Math.round(HEX_W * 0.866) // ≈ 83

interface RadialHexMapProps {
  bins: BinState[]
  binCount: number
  runStatus: 'idle' | 'running' | 'complete'
  elapsedMs: number
  estRemainingMs: number | null
  liveSorted: number
}

export function RadialHexMap({
  bins,
  binCount,
  runStatus,
  elapsedMs,
  estRemainingMs,
  liveSorted,
}: RadialHexMapProps) {
  type Slot = { bin: BinState | null; isReject: boolean; isEmpty: boolean }
  const slots: Slot[] = Array.from({ length: binCount }, (_, i) => {
    const bin = bins[i] ?? null
    const isReject = i === binCount - 1
    return { bin, isReject, isEmpty: !bin && !isReject }
  })

  return (
    <div className="relative mx-auto" style={{ width: CONTAINER, height: CONTAINER }}>
      {/* Orbit ring + spokes */}
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
          stroke="rgba(148,163,184,0.1)"
          strokeWidth={1}
          strokeDasharray="4 8"
        />
        {slots.map((_, i) => {
          const rad = ((-90 + i * (360 / binCount)) * Math.PI) / 180
          return (
            <line
              key={i}
              x1={CENTER + HUB_R * Math.cos(rad)}
              y1={CENTER + HUB_R * Math.sin(rad)}
              x2={CENTER + ORBIT_R * Math.cos(rad)}
              y2={CENTER + ORBIT_R * Math.sin(rad)}
              stroke="rgba(148,163,184,0.06)"
              strokeWidth={1}
            />
          )
        })}
      </svg>

      {/* Hex bins */}
      {slots.map(({ bin, isReject, isEmpty }, i) => {
        const rad = ((-90 + i * (360 / binCount)) * Math.PI) / 180
        const x = CENTER + ORBIT_R * Math.cos(rad) - HEX_W / 2
        const y = CENTER + ORBIT_R * Math.sin(rad) - HEX_H / 2
        return (
          <div
            key={i}
            className="absolute"
            style={{ left: x, top: y, width: HEX_W, height: HEX_H }}
          >
            <HexBin
              idx={i}
              component={bin?.component ?? (isReject ? 'Unknown' : '')}
              count={bin?.count ?? 0}
              isReject={isReject}
              isEmpty={isEmpty}
            />
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
          boxShadow: '0 0 40px rgba(6,182,212,0.06)',
        }}
      >
        <ProgressRing
          runStatus={runStatus}
          elapsedMs={elapsedMs}
          estRemainingMs={estRemainingMs}
          liveSorted={liveSorted}
        />
      </div>
    </div>
  )
}
