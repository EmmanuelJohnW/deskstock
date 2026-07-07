import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/server'

// ─── Vercel Cron — see vercel.json ("0 */5 * * *") ───────────────────────────
//
// device_log gets one row per firmware-facing call (POST /api/ingest, GET
// /api/run-config, GET /api/commands) and nothing ever trims it — it's read
// straight through by the Device Traffic terminal and the online/offline
// heartbeat on /device. This runs every 5 hours and deletes anything older
// than that, so the table (and the terminal's backfill query) don't grow
// unbounded.
//
// Vercel signs cron-triggered requests with `Authorization: Bearer
// $CRON_SECRET` when CRON_SECRET is set in the project's environment
// variables — set it there. Without it, this route always 401s.
//
// ─────────────────────────────────────────────────────────────────────────────

const RETENTION_MS = 5 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString()
  const { error, count } = await getServerClient()
    .from('device_log')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)

  if (error) {
    console.error('[GET /api/cron/cleanup-device-log]', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, deleted: count ?? 0 })
}
