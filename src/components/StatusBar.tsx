function rssiQuality(rssi: number): string {
  if (rssi >= -60) return 'Excellent'
  if (rssi >= -70) return 'Good'
  if (rssi >= -80) return 'Fair'
  return 'Weak'
}

interface StatusBarProps {
  online: boolean
  rssi: number | null
  fw: string | null
  profile: string | null
  runId: string | null
}

export function StatusBar({ online, rssi, fw, profile, runId }: StatusBarProps) {
  return (
    <header className="flex items-center gap-4 px-5 py-3 bg-slate-900/80 border-b border-slate-800 backdrop-blur text-sm">
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full transition-colors duration-500"
          style={{ background: online ? '#22c55e' : '#ef4444' }}
        />
        <span className={online ? 'text-slate-200' : 'text-slate-500'}>
          {online ? 'Online' : 'Offline'}
        </span>
      </div>

      {rssi != null && (
        <span className="text-slate-500 text-xs">
          {rssi} dBm · {rssiQuality(rssi)}
        </span>
      )}

      {fw != null && (
        <span className="text-slate-600 text-xs font-mono">fw {fw}</span>
      )}

      <div className="flex-1" />

      {profile != null && (
        <span className="text-cyan-400 font-medium">{profile}</span>
      )}

      {runId != null && (
        <span className="text-slate-600 font-mono text-xs">{runId}</span>
      )}
    </header>
  )
}
