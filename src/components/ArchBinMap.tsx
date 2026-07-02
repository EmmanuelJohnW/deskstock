import type { BinState } from '@/lib/device/state'
import { BIN_COUNT, REJECT_BIN_IDX } from '@/lib/device/binLayout'
import { HexBin } from './HexBin'

const CONTAINER_W = 900
const CONTAINER_H = 520

const ARC_CENTER_X = CONTAINER_W / 2
const ARC_CENTER_Y = 430
const ARC_RADIUS   = 300

const HEX_W = 172
const HEX_H = Math.round(HEX_W * 0.866)

interface Slot {
  binIdx: number
  isReject: boolean
}

/**
 * Reject bin sits at the far left, known bins follow left-to-right:
 * [REJECT(0), 1, 2, 3, 4, 5]
 */
function buildArchOrder(): Slot[] {
  return Array.from({ length: BIN_COUNT }, (_, binIdx) => ({
    binIdx,
    isReject: binIdx === REJECT_BIN_IDX,
  }))
}

interface ArchBinMapProps {
  bins: BinState[]
  activeBinIdx?: number | null
  activeSeq?: number
}

export function ArchBinMap({ bins, activeBinIdx = null, activeSeq = 0 }: ArchBinMapProps) {
  const order = buildArchOrder()
  const stepDeg = order.length > 1 ? 180 / (order.length - 1) : 0

  // Positions/sizes are expressed as % of the container (not px) so the whole
  // arch scales with its box — see the wrapper's aspect-ratio + @container below.
  const points = order.map(({ binIdx, isReject }, slot) => {
    const deg = 180 - slot * stepDeg
    const rad = (deg * Math.PI) / 180
    const x = ARC_CENTER_X + ARC_RADIUS * Math.cos(rad)
    const y = ARC_CENTER_Y - ARC_RADIUS * Math.sin(rad)
    const bin = bins[binIdx] ?? null
    const isEmpty = !bin && !isReject
    return { leftPct: (x / CONTAINER_W) * 100, topPct: (y / CONTAINER_H) * 100, binIdx, isReject, isEmpty, bin }
  })

  const archPath = points.length > 0
    ? `M ${ARC_CENTER_X - ARC_RADIUS} ${ARC_CENTER_Y} A ${ARC_RADIUS} ${ARC_RADIUS} 0 0 1 ${ARC_CENTER_X + ARC_RADIUS} ${ARC_CENTER_Y}`
    : ''

  const hexWidthPct = (HEX_W / CONTAINER_W) * 100
  const hexHeightPct = (HEX_H / CONTAINER_H) * 100

  return (
    <div
      className="@container relative mx-auto w-full"
      style={{ maxWidth: CONTAINER_W, aspectRatio: `${CONTAINER_W} / ${CONTAINER_H}` }}
    >
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${CONTAINER_W} ${CONTAINER_H}`}
      >
        <path
          d={archPath}
          fill="none"
          stroke="rgba(107,114,128,0.2)"
          strokeWidth={1}
          strokeDasharray="4 8"
        />
      </svg>

      {points.map(({ leftPct, topPct, binIdx, isReject, isEmpty, bin }, slot) => {
        const isPulsing = activeBinIdx === binIdx
        return (
          <div
            key={slot}
            className="absolute"
            style={{
              left: `${leftPct}%`,
              top: `${topPct}%`,
              width: `${hexWidthPct}%`,
              height: `${hexHeightPct}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              key={isPulsing ? `pulse-${activeSeq}` : 'idle'}
              className={isPulsing ? 'w-full h-full animate-bin-pulse' : 'w-full h-full'}
            >
              <HexBin
                idx={binIdx}
                component={bin?.component ?? (isReject ? 'Unknown' : '')}
                count={bin?.count ?? 0}
                isReject={isReject}
                isEmpty={isEmpty}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
