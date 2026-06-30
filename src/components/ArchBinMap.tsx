import type { BinState } from '@/lib/device/state'
import { HexBin } from './HexBin'

const CONTAINER_W = 760
const CONTAINER_H = 300

const ARC_CENTER_X = CONTAINER_W / 2
const ARC_CENTER_Y = 260
const ARC_RADIUS   = 230

const HEX_W = 96
const HEX_H = Math.round(HEX_W * 0.866)

interface Slot {
  binIdx: number
  isReject: boolean
}

/**
 * Splits known bins (0..binCount-2) into left/right halves around the
 * reject bin (binCount-1), which always lands in the center slot.
 * e.g. binCount=7 -> [0,1,2, REJECT(6), 3,4,5]
 */
function buildArchOrder(binCount: number): Slot[] {
  const rejectIdx = binCount - 1
  const knownCount = Math.max(0, binCount - 1)
  const leftCount = Math.ceil(knownCount / 2)

  const left  = Array.from({ length: leftCount }, (_, i) => i)
  const right = Array.from({ length: knownCount - leftCount }, (_, i) => leftCount + i)

  return [
    ...left.map(binIdx => ({ binIdx, isReject: false })),
    { binIdx: rejectIdx, isReject: true },
    ...right.map(binIdx => ({ binIdx, isReject: false })),
  ]
}

interface ArchBinMapProps {
  bins: BinState[]
  binCount: number
}

export function ArchBinMap({ bins, binCount }: ArchBinMapProps) {
  const order = buildArchOrder(binCount)
  const stepDeg = order.length > 1 ? 180 / (order.length - 1) : 0

  const points = order.map(({ binIdx, isReject }, slot) => {
    const deg = 180 - slot * stepDeg
    const rad = (deg * Math.PI) / 180
    const x = ARC_CENTER_X + ARC_RADIUS * Math.cos(rad)
    const y = ARC_CENTER_Y - ARC_RADIUS * Math.sin(rad)
    const bin = bins[binIdx] ?? null
    const isEmpty = !bin && !isReject
    return { x, y, binIdx, isReject, isEmpty, bin }
  })

  const archPath = points.length > 0
    ? `M ${ARC_CENTER_X - ARC_RADIUS} ${ARC_CENTER_Y} A ${ARC_RADIUS} ${ARC_RADIUS} 0 0 1 ${ARC_CENTER_X + ARC_RADIUS} ${ARC_CENTER_Y}`
    : ''

  return (
    <div className="relative mx-auto" style={{ width: CONTAINER_W, height: CONTAINER_H }}>
      <svg className="absolute inset-0 pointer-events-none" width={CONTAINER_W} height={CONTAINER_H}>
        <path
          d={archPath}
          fill="none"
          stroke="rgba(107,114,128,0.2)"
          strokeWidth={1}
          strokeDasharray="4 8"
        />
      </svg>

      {points.map(({ x, y, binIdx, isReject, isEmpty, bin }, slot) => (
        <div
          key={slot}
          className="absolute"
          style={{ left: x - HEX_W / 2, top: y - HEX_H / 2, width: HEX_W, height: HEX_H }}
        >
          <HexBin
            idx={binIdx}
            component={bin?.component ?? (isReject ? 'Unknown' : '')}
            count={bin?.count ?? 0}
            isReject={isReject}
            isEmpty={isEmpty}
          />
        </div>
      ))}
    </div>
  )
}
