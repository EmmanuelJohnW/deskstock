'use client'

import { useState } from 'react'
import { useDevice } from '@/lib/device/useDevice'
import { ArchBinMap } from '@/components/ArchBinMap'
import { StatusBar } from '@/components/StatusBar'
import { TelemetryBar } from '@/components/TelemetryBar'
import { BinCountControl } from '@/components/BinCountControl'

export default function DashboardPage() {
  const device = useDevice()
  const [binCount, setBinCount] = useState(7)

  const isRunning = device.runStatus === 'running'

  const binSum = device.bins.reduce((sum, b) => sum + b.count, 0)
  const liveSorted =
    device.runStatus === 'complete'
      ? Math.max(device.totalSorted ?? 0, binSum)
      : binSum

  return (
    <div className="flex-1 flex flex-col bg-gray-50 text-gray-900">
      <StatusBar
        online={device.online}
        rssi={device.rssi}
        fw={device.fw}
        profile={device.profile}
        runId={device.runId}
      />

      <TelemetryBar
        elapsedMs={device.elapsedMs}
        estRemainingMs={device.estRemainingMs}
        liveSorted={liveSorted}
        runStatus={device.runStatus}
      />

      <main className="flex-1 flex flex-col items-center justify-center gap-5 p-4 sm:p-6 w-full">
        <div className="flex flex-wrap items-center justify-center gap-4">
          <h1 className="text-lg font-semibold text-gray-700 tracking-tight">
            Arch Sort
          </h1>
          <BinCountControl
            value={binCount}
            onChange={setBinCount}
            disabled={isRunning}
          />
        </div>

        <ArchBinMap bins={device.bins} binCount={binCount} />

        {device.controllable && (
          <div className="flex gap-3">
            {!isRunning ? (
              <button
                onClick={() => device.start()}
                className="px-8 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold transition-colors"
              >
                Start
              </button>
            ) : (
              <button
                onClick={() => device.stop()}
                className="px-8 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-semibold transition-colors"
              >
                Stop
              </button>
            )}
          </div>
        )}

        {device.runStatus === 'complete' && device.durationMs != null && (
          <p className="text-gray-400 text-sm">
            Completed in {(device.durationMs / 1000).toFixed(1)}s
          </p>
        )}
      </main>
    </div>
  )
}
