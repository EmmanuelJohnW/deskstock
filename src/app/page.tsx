'use client'

import { useState } from 'react'
import { useDevice } from '@/lib/device/useDevice'
import { RadialHexMap } from '@/components/RadialHexMap'
import { StatusBar } from '@/components/StatusBar'
import { TelemetryBar } from '@/components/TelemetryBar'
import { BinCountControl } from '@/components/BinCountControl'

export default function DashboardPage() {
  const device = useDevice()
  const [binCount, setBinCount] = useState(7)

  const isRunning = device.runStatus === 'running'

  // Live total sorted — accumulate from bins during run, use device total when complete
  const liveSorted =
    device.runStatus === 'complete' && device.totalSorted != null
      ? device.totalSorted
      : device.bins.reduce((sum, b) => sum + b.count, 0)

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
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

      <main className="flex-1 flex flex-col items-center justify-center gap-5 p-6">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-slate-300 tracking-tight">
            Radial Sort
          </h1>
          <BinCountControl
            value={binCount}
            onChange={setBinCount}
            disabled={isRunning}
          />
        </div>

        <RadialHexMap
          bins={device.bins}
          binCount={binCount}
          runStatus={device.runStatus}
          elapsedMs={device.elapsedMs}
          estRemainingMs={device.estRemainingMs}
          totalSorted={device.totalSorted}
        />

        <div className="flex gap-3">
          {!isRunning ? (
            <button
              onClick={() => device.start()}
              className="px-8 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 text-white font-semibold transition-colors"
            >
              Start
            </button>
          ) : (
            <button
              onClick={() => device.stop()}
              className="px-8 py-2.5 rounded-lg bg-red-700 hover:bg-red-600 active:bg-red-800 text-white font-semibold transition-colors"
            >
              Stop
            </button>
          )}
        </div>

        {device.runStatus === 'complete' && device.durationMs != null && (
          <p className="text-slate-500 text-sm">
            Completed in {(device.durationMs / 1000).toFixed(1)}s
          </p>
        )}
      </main>
    </div>
  )
}
