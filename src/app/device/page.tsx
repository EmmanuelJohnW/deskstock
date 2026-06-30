'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { getSupabaseClient } from '@/lib/supabase/client'
import { DeviceLogTerminal } from '@/components/DeviceLogTerminal'

// ─── Types ────────────────────────────────────────────────────────────────────

// 'sorting' takes priority when a run is live. Otherwise online/offline is
// derived from how recently the device made any logged API call — this is
// the device's actual heartbeat, not a guess based on run history.
type StatusKind = 'sorting' | 'online' | 'offline'

const ONLINE_THRESHOLD_MS = 60_000

interface DeviceStatus {
  kind: StatusKind
  liveRunId: string | null
  lastSeenMs: number | null
  componentCount: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

async function fetchStatus(): Promise<DeviceStatus> {
  const supabase = getSupabaseClient()

  const [
    { data: liveRows },
    { data: lastLog },
    { count },
  ] = await Promise.all([
    supabase.from('live_runs').select('run_id').limit(1),
    supabase
      .from('device_log')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('components').select('*', { count: 'exact', head: true }),
  ])

  const liveRunId = (liveRows?.[0] as { run_id: string } | undefined)?.run_id ?? null

  const lastSeenMs = lastLog ? new Date((lastLog as { created_at: string }).created_at).getTime() : null

  let kind: StatusKind
  if (liveRunId) {
    kind = 'sorting'
  } else if (lastSeenMs !== null && Date.now() - lastSeenMs < ONLINE_THRESHOLD_MS) {
    kind = 'online'
  } else {
    kind = 'offline'
  }

  return { kind, liveRunId, lastSeenMs, componentCount: count ?? 0 }
}

// ─── Copy field ───────────────────────────────────────────────────────────────

function CopyField({ value, dim }: { value: string; dim?: boolean }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API not available (non-HTTPS dev)
    }
  }

  return (
    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
      <span className={`flex-1 font-mono text-sm truncate ${dim ? 'text-gray-400' : 'text-gray-700'}`}>
        {value}
      </span>
      <button
        onClick={copy}
        className="shrink-0 text-xs font-medium px-2 py-1 rounded transition-colors bg-white border border-gray-200 hover:bg-gray-100 text-gray-500 hover:text-gray-900"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DeviceStatus }) {
  const configs: Record<StatusKind, { dot: string; label: string; sub: string }> = {
    sorting: {
      dot: 'bg-emerald-500 animate-pulse',
      label: 'Sorting now',
      sub: `Run ${status.liveRunId ?? ''}`,
    },
    online: {
      dot: 'bg-emerald-500',
      label: 'Online',
      sub: status.lastSeenMs ? `Last call ${timeAgo(status.lastSeenMs)}` : '',
    },
    offline: {
      dot: 'bg-gray-300',
      label: 'Offline',
      sub: status.lastSeenMs ? `Last call ${timeAgo(status.lastSeenMs)}` : 'No API traffic recorded yet',
    },
  }

  const { dot, label, sub } = configs[status.kind]

  return (
    <div className="flex items-center gap-4 p-5 rounded-xl bg-white border border-gray-200">
      <span className={`w-3 h-3 rounded-full shrink-0 ${dot}`} />
      <div>
        <p className="text-gray-900 font-semibold">{label}</p>
        {sub && <p className="text-gray-500 text-sm mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
      {children}
    </h2>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const SETUP_STEPS = [
  {
    n: 1,
    title: 'Flash credentials',
    body: 'Embed your WiFi SSID, password, server base URL, and INGEST_TOKEN directly in the firmware. The token is the shared secret — treat it like a password.',
  },
  {
    n: 2,
    title: 'Fetch the weight table',
    body: 'On each run start, GET /api/run-config with the Authorization header. The response is [{name, weight_g}] — load it into RAM as your local matching table.',
  },
  {
    n: 3,
    title: 'Sort locally',
    body: 'Weigh each component. Walk the table: find the closest weight match within tolerance. No match → bin 6 (reject chute). All matching is on-device; no round-trip per part.',
  },
  {
    n: 4,
    title: 'Report progress',
    body: 'POST to /api/ingest with status: "running" roughly once per second. Include the current cumulative bin counts, elapsed_ms, and est_remaining_ms. The dashboard updates live via Supabase Realtime.',
  },
  {
    n: 5,
    title: 'Report completion',
    body: 'When done, POST to /api/ingest with status: "complete". Include the final bin counts, total, duration_ms, and started_at (ISO 8601). The server persists the run and clears the live state.',
  },
  {
    n: 6,
    title: 'Poll for commands',
    body: 'GET /api/commands every ~500 ms to receive Start/Stop signals from the dashboard. The endpoint is live but always returns {command: null} for now — dispatch from the dashboard buttons isn\'t wired yet.',
  },
]

export default function DevicePage() {
  const [status, setStatus] = useState<DeviceStatus | null>(null)
  const [origin, setOrigin] = useState('')
  const [lastRefresh, setLastRefresh] = useState(0)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const refresh = useCallback(async () => {
    const s = await fetchStatus()
    setStatus(s)
    setLastRefresh(Date.now())
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 15_000)
    return () => clearInterval(id)
  }, [refresh])

  const base = origin || 'https://your-deployment.vercel.app'

  const endpoints = [
    { method: 'GET ', path: '/api/run-config', note: 'Fetch weight table at run start' },
    { method: 'POST', path: '/api/ingest',     note: 'Report bin counts (running + complete)' },
    { method: 'GET ', path: '/api/commands',   note: 'Poll for start/stop signals (always null for now)' },
  ]

  return (
    <div className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-10">

      {/* ── Live status ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>Device status</SectionLabel>
          <button
            onClick={refresh}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors font-mono"
          >
            {lastRefresh > 0
              ? `Refreshed ${timeAgo(lastRefresh)} · Refresh`
              : 'Refresh'}
          </button>
        </div>

        {status ? (
          <StatusBadge status={status} />
        ) : (
          <div className="p-5 rounded-xl bg-white border border-gray-200 text-gray-400 text-sm">
            Checking…
          </div>
        )}
      </section>

      {/* ── Live communication terminal ── */}
      <section>
        <SectionLabel>Device traffic</SectionLabel>
        <DeviceLogTerminal />
      </section>

      {/* ── Component registry ── */}
      <section>
        <SectionLabel>Component registry</SectionLabel>
        <div className="flex items-center justify-between p-5 rounded-xl bg-white border border-gray-200">
          <div>
            <p className="text-gray-900 font-semibold">
              {status === null ? '—' : status.componentCount} component{status?.componentCount !== 1 ? 's' : ''} registered
            </p>
            <p className="text-gray-500 text-sm mt-0.5">
              {status?.componentCount === 0
                ? 'Register at least one component before the first run.'
                : 'Bins 0–5 assigned dynamically; bin 6 is the reject chute.'}
            </p>
          </div>
          <Link
            href="/components"
            className="shrink-0 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition-colors"
          >
            Manage →
          </Link>
        </div>
      </section>

      {/* ── Firmware endpoints ── */}
      <section>
        <SectionLabel>Firmware endpoints</SectionLabel>
        <div className="space-y-2">
          {endpoints.map(({ method, path, note }) => (
            <div key={path}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono font-semibold text-emerald-600 uppercase tracking-wider w-9 shrink-0">
                  {method.trim()}
                </span>
                <span className="text-gray-500 text-xs">{note}</span>
              </div>
              <CopyField value={`${base}${path}`} />
            </div>
          ))}
        </div>

        <div className="mt-4 p-4 rounded-lg bg-gray-50 border border-gray-200 space-y-2">
          <p className="text-xs text-gray-500 font-medium">Required on every request</p>
          <CopyField value="Authorization: Bearer <INGEST_TOKEN>" />
          <p className="text-xs text-gray-400">
            Set <span className="font-mono text-gray-500">INGEST_TOKEN</span> in your Vercel environment variables.
            Never shown here — copy it directly from the Vercel dashboard into your firmware.
          </p>
        </div>
      </section>

      {/* ── Setup steps ── */}
      <section>
        <SectionLabel>Firmware setup</SectionLabel>
        <ol className="space-y-0">
          {SETUP_STEPS.map(({ n, title, body }, i) => (
            <li key={n} className="flex gap-4">
              <div className="flex flex-col items-center shrink-0">
                <span className="w-7 h-7 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-xs font-bold text-gray-500">
                  {n}
                </span>
                {i < SETUP_STEPS.length - 1 && (
                  <span className="w-px flex-1 bg-gray-200 my-1" />
                )}
              </div>
              <div className={`pb-6 ${i === SETUP_STEPS.length - 1 ? 'pb-0' : ''}`}>
                <p className="font-medium text-sm mb-1 text-gray-900">{title}</p>
                <p className="text-sm leading-relaxed text-gray-500">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

    </div>
  )
}
