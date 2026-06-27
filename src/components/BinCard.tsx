import type { BinState } from '@/lib/device/state'

interface BinCardProps {
  idx: number
  bin: BinState | null
}

export function BinCard({ idx, bin }: BinCardProps) {
  if (!bin) {
    return (
      <div className="w-full h-full rounded-xl border border-dashed border-slate-700 flex items-center justify-center opacity-40">
        <span className="text-slate-500 text-xs">—</span>
      </div>
    )
  }

  return (
    <div className="w-full h-full rounded-xl bg-slate-800 border border-slate-700 flex flex-col items-center justify-center gap-1 hover:border-cyan-500 transition-colors duration-200">
      <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
        BIN {idx}
      </span>
      <span className="text-[11px] text-white font-semibold leading-tight px-1 text-center w-full truncate">
        {bin.component}
      </span>
      <span className="text-xl font-bold text-cyan-400 font-mono tabular-nums">
        {bin.count}
      </span>
    </div>
  )
}
