import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/server'
import { logDeviceCall } from '@/lib/deviceLog'

// Response shape: [{name: string, weight_g: number}]
// Postgres numeric returns as string over PostgREST — parseFloat before sending
// so the firmware always receives a JSON number, not a string.
//
// The device has no concept of "which inventory" — it just holds a bearer
// token and calls this endpoint at the start of every run (see
// firmware/deskstock/deskstock.ino's startRun() → fetchRunConfig()). The
// operator always opens a count session from the dashboard, inventory
// picked via the NavBar dropdown, before walking over and pressing the
// physical run button — so the currently-open session's inventory_id is
// the only signal this endpoint needs. Returning every inventory's
// components unfiltered would let two labs' catalogs collide in the
// firmware's weight table and misclassify parts into the wrong bin.
export async function GET(req: NextRequest) {
  const supabase = getServerClient()

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token || token !== process.env.INGEST_TOKEN) {
    await logDeviceCall(supabase, { method: 'GET', endpoint: '/api/run-config', statusCode: 401, summary: 'unauthorized' })
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { data: session, error: sessionError } = await supabase
    .from('count_sessions')
    .select('inventory_id')
    .eq('status', 'open')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sessionError) {
    console.error('[GET /api/run-config] session lookup failed:', sessionError.message)
    await logDeviceCall(supabase, { method: 'GET', endpoint: '/api/run-config', statusCode: 500, summary: 'session lookup failed' })
    return NextResponse.json({ success: false, error: sessionError.message }, { status: 500 })
  }

  if (!session) {
    await logDeviceCall(supabase, { method: 'GET', endpoint: '/api/run-config', statusCode: 409, summary: 'no open session' })
    return NextResponse.json({ success: false, error: 'no_open_session' }, { status: 409 })
  }

  const { data, error } = await supabase
    .from('components')
    .select('name, weight_g')
    .eq('inventory_id', session.inventory_id)
    .order('name', { ascending: true })

  if (error) {
    console.error('[GET /api/run-config]', error.message)
    await logDeviceCall(supabase, { method: 'GET', endpoint: '/api/run-config', statusCode: 500, summary: 'lookup failed' })
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []).map(r => ({
    name: r.name as string,
    weight_g: parseFloat(r.weight_g as unknown as string),
  }))

  await logDeviceCall(supabase, {
    method: 'GET',
    endpoint: '/api/run-config',
    statusCode: 200,
    summary: `catalog x${rows.length}`,
  })
  return NextResponse.json(rows)
}
