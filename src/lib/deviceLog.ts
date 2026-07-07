import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Migration SQL — run in Supabase SQL editor ───────────────────────────────
//
// create table public.device_log (
//   id          bigint generated always as identity primary key,
//   method      text        not null,
//   endpoint    text        not null,
//   status_code integer     not null,
//   summary     text,
//   created_at  timestamptz not null default now()
// );
//
// alter table public.device_log enable row level security;
//
// create policy "public read device_log"
//   on public.device_log for select using (true);
//
// ─────────────────────────────────────────────────────────────────────────────

interface DeviceLogEntry {
  method: 'GET' | 'POST'
  endpoint: string
  statusCode: number
  summary: string
}

// Best-effort: a logging failure must never break the firmware-facing response.
// Retention is handled separately by a daily Vercel Cron job — see
// api/cron/cleanup-device-log.
export async function logDeviceCall(supabase: SupabaseClient, entry: DeviceLogEntry): Promise<void> {
  const { error } = await supabase.from('device_log').insert({
    method: entry.method,
    endpoint: entry.endpoint,
    status_code: entry.statusCode,
    summary: entry.summary,
  })
  if (error) {
    console.error('[logDeviceCall]', error.message)
  }
}
