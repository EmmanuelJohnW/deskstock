function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

interface TelemetryBarProps {
  elapsedMs: number
  estRemainingMs: number | null
  liveSorted: number
  runStatus: 'idle' | 'running' | 'complete'
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[80px]">
      <span className="text-[9px] text-slate-500 uppercase tracking-widest font-medium">
        {label}
      </span>
      <span className="text-white font-mono font-semibold text-sm tabular-nums">
        {value}
      </span>
    </div>
  )
}

export function TelemetryBar({ elapsedMs, estRemainingMs, liveSorted, runStatus }: TelemetryBarProps) {
  const ratePerMin =
    runStatus === 'running' && elapsedMs > 0
      ? Math.round(liveSorted / (elapsedMs / 60_000))
      : null

  const isActive = runStatus !== 'idle'

  return (
    <div className="flex gap-8 px-6 py-3 bg-slate-900/70 border-b border-slate-800 backdrop-blur">
      <Stat label="Elapsed" value={isActive ? fmtMs(elapsedMs) : '—'} />
      <Stat
        label="Remaining"
        value={
          runStatus === 'running' && estRemainingMs != null
            ? `~${fmtMs(estRemainingMs)}`
            : '—'
        }
      />
      <Stat
        label="Rate"
        value={ratePerMin != null ? `${ratePerMin}/min` : '—'}
      />
      <Stat
        label="Sorted"
        value={isActive && liveSorted > 0 ? String(liveSorted) : '—'}
      />
    </div>
  )
}
