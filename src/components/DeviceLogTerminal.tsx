'use client'

import { useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'

interface LogRow {
  id: number
  method: string
  endpoint: string
  status_code: number
  summary: string | null
  created_at: string
}

const MAX_ROWS = 200

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false })
}

function rowColor(row: LogRow): string {
  if (row.status_code >= 400) return 'text-red-400'
  return row.method === 'POST' ? 'text-sky-400' : 'text-violet-400'
}

function statusColor(status: number): string {
  if (status >= 500) return 'text-red-400'
  if (status >= 400) return 'text-amber-400'
  return 'text-emerald-400'
}

export function DeviceLogTerminal() {
  const [rows, setRows] = useState<LogRow[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = getSupabaseClient()
    let cancelled = false

    async function backfill() {
      // Newest MAX_ROWS first, then reversed — ordering ascending with a
      // limit would instead return the OLDEST rows once the table grows
      // past MAX_ROWS, so a just-inserted row would never appear here.
      const { data } = await supabase
        .from('device_log')
        .select('id, method, endpoint, status_code, summary, created_at')
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS)
      if (!cancelled && data) setRows((data as unknown as LogRow[]).reverse())
    }
    backfill()

    const channel = supabase
      .channel('device-log-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'device_log' },
        payload => {
          setRows(prev => [...prev, payload.new as LogRow].slice(-MAX_ROWS))
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [rows.length])

  return (
    <div className="rounded-xl bg-gray-950 border border-gray-800 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[10px] text-gray-500 uppercase tracking-widest font-mono">Live feed</span>
      </div>
      <div className="h-72 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed">
        {rows.length === 0 ? (
          <p className="text-gray-600">Waiting for traffic…</p>
        ) : (
          rows.map(row => (
            <div key={row.id} className="flex gap-3 whitespace-nowrap">
              <span className="text-gray-600 shrink-0">{fmtTime(row.created_at)}</span>
              <span className={`shrink-0 w-10 font-semibold ${rowColor(row)}`}>{row.method}</span>
              <span className={`truncate ${rowColor(row)}`}>{row.endpoint}</span>
              <span className={`shrink-0 font-semibold ${statusColor(row.status_code)}`}>{row.status_code}</span>
              <span className="text-gray-500 truncate">{row.summary}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
