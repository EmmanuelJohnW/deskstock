const MIN_BINS = 2
const MAX_BINS = 7

interface BinCountControlProps {
  value: number
  onChange: (n: number) => void
  disabled: boolean
}

export function BinCountControl({ value, onChange, disabled }: BinCountControlProps) {
  const btnBase =
    'w-7 h-7 rounded flex items-center justify-center bg-slate-800 text-white font-bold text-base transition-colors'
  const btnEnabled = 'hover:bg-slate-700 active:bg-slate-600'
  const btnDisabled = 'opacity-40 cursor-not-allowed'

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(Math.max(MIN_BINS, value - 1))}
        disabled={disabled || value <= MIN_BINS}
        className={`${btnBase} ${disabled || value <= MIN_BINS ? btnDisabled : btnEnabled}`}
        aria-label="Fewer bins"
      >
        −
      </button>
      <span className="w-5 text-center text-white font-mono font-semibold tabular-nums">
        {value}
      </span>
      <button
        onClick={() => onChange(Math.min(MAX_BINS, value + 1))}
        disabled={disabled || value >= MAX_BINS}
        className={`${btnBase} ${disabled || value >= MAX_BINS ? btnDisabled : btnEnabled}`}
        aria-label="More bins"
      >
        +
      </button>
    </div>
  )
}
