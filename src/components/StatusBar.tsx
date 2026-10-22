function rssiQuality(rssi: number): string {
  if (rssi >= -60) return 'Excellent'
  if (rssi >= -70) return 'Good'
  if (rssi >= -80) return 'Fair'
  return 'Weak'
}

interface StatusBarProps {
  online: boolean
  /** This laptop is offline, so the device's real state can't be known. */
  isUnknown?: boolean
  rssi: number | null
  fw: string | null
  runId: string | null
}

export function StatusBar({ online, isUnknown = false, rssi, fw, runId }: StatusBarProps) {
  if (isUnknown) {
    return (
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-5 py-2.5 sm:py-3 bg-white/90 border-b border-gray-200 backdrop-blur text-sm">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0 bg-gray-300" />
          <span className="text-gray-500">Device status unknown</span>
        </div>
        <span className="text-gray-400 text-xs">
          This laptop is offline. The device may still be sorting and saving online.
        </span>
      </header>
    )
  }

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-5 py-2.5 sm:py-3 bg-white/90 border-b border-gray-200 backdrop-blur text-sm">
      <div className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full transition-colors duration-500 shrink-0"
          style={{ background: online ? '#059669' : '#ef4444' }}
        />
        <span className={online ? 'text-gray-900' : 'text-gray-400'}>
          {online ? 'Online' : 'Offline'}
        </span>
      </div>

      {rssi != null && (
        <span className="hidden sm:inline text-gray-400 text-xs">
          {rssi} dBm · {rssiQuality(rssi)}
        </span>
      )}

      {fw != null && (
        <span className="hidden sm:inline text-gray-400 text-xs font-mono">fw {fw}</span>
      )}

      <div className="hidden sm:block flex-1" />

      {runId != null && (
        <span className="text-gray-400 font-mono text-xs truncate max-w-full">{runId}</span>
      )}
    </header>
  )
}
