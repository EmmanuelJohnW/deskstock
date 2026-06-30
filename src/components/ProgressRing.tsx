const RING_SIZE = 130
const CENTER    = RING_SIZE / 2
const RADIUS    = 54
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

interface ProgressRingProps {
  runStatus: 'idle' | 'running' | 'complete'
  elapsedMs: number
  estRemainingMs: number | null
  liveSorted: number
}

export function ProgressRing({ runStatus, elapsedMs, estRemainingMs, liveSorted }: ProgressRingProps) {
  const progress =
    runStatus === 'complete'
      ? 1
      : runStatus === 'running' && estRemainingMs != null && elapsedMs + estRemainingMs > 0
      ? elapsedMs / (elapsedMs + estRemainingMs)
      : 0

  const dashOffset  = CIRCUMFERENCE * (1 - progress)
  const strokeColor = runStatus === 'idle' ? '#d1d5db' : '#059669'

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: RING_SIZE, height: RING_SIZE }}
    >
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="absolute inset-0"
        style={{ transform: 'rotate(-90deg)' }}
      >
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="#e5e7eb" strokeWidth={7} />
        <circle
          cx={CENTER} cy={CENTER} r={RADIUS}
          fill="none"
          stroke={strokeColor}
          strokeWidth={7}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.4s ease' }}
        />
      </svg>

      <div className="relative z-10 flex flex-col items-center justify-center text-center px-3">
        {runStatus === 'idle' && (
          <span className="text-gray-400 text-xs">Waiting…</span>
        )}

        {runStatus === 'running' && (
          <>
            <span className="text-[9px] text-emerald-600 uppercase tracking-widest font-medium">
              Running
            </span>
            <span className="text-gray-900 text-base font-bold font-mono tabular-nums leading-tight">
              {formatMs(elapsedMs)}
            </span>
            {estRemainingMs != null && (
              <span className="text-[10px] text-gray-400 font-mono">
                ~{formatMs(estRemainingMs)}
              </span>
            )}
          </>
        )}

        {runStatus === 'complete' && (
          <>
            <span className="text-[9px] text-emerald-600 uppercase tracking-widest font-medium">
              Done
            </span>
            <span className="text-gray-900 text-2xl font-bold tabular-nums leading-tight">
              {liveSorted}
            </span>
            <span className="text-[10px] text-gray-400">sorted</span>
          </>
        )}
      </div>
    </div>
  )
}
