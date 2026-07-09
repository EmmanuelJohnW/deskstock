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
// firmware/deskstock/deskstock.ino's startRun() → fetchRunConfig()). Rather
// than requiring the operator to manually open a count session from the
// dashboard first, this reads active_inventory (set automatically whenever
// the NavBar dropdown selection changes — see api/active-inventory/route.ts)
// and auto-opens a session for it if none is open yet, marking it
// auto_opened so persistCompleteRun knows to auto-reconcile it when the run
// finishes (see lib/ingest/completeRun.ts) — one press of the physical
// button, no manual session management. A session opened manually from the
// dashboard (auto_opened = false) still behaves as before: it can batch
// multiple runs and is only closed by an explicit "Finish Count".
export async function GET(req: NextRequest) {
  const supabase = getServerClient()

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token || token !== process.env.INGEST_TOKEN) {
    await logDeviceCall(supabase, { method: 'GET', endpoint: '/api/run-config', statusCode: 401, summary: 'unauthorized' })
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { data: existing, error: sessionError } = await supabase
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

  let inventoryId: number

  if (existing) {
    inventoryId = existing.inventory_id
  } else {
    const { data: active, error: activeError } = await supabase
      .from('active_inventory')
      .select('inventory_id')
      .eq('id', 1)
      .maybeSingle()

    if (activeError) {
      console.error('[GET /api/run-config] active_inventory lookup failed:', activeError.message)
      await logDeviceCall(supabase, { method: 'GET', endpoint: '/api/run-config', statusCode: 500, summary: 'active_inventory lookup failed' })
      return NextResponse.json({ success: false, error: activeError.message }, { status: 500 })
    }

    if (!active?.inventory_id) {
      await logDeviceCall(supabase, { method: 'GET', endpoint: '/api/run-config', statusCode: 409, summary: 'no active inventory selected' })
      return NextResponse.json({ success: false, error: 'no_active_inventory' }, { status: 409 })
    }

    const { error: openError } = await supabase
      .from('count_sessions')
      .insert({ inventory_id: active.inventory_id, auto_opened: true })

    if (openError) {
      console.error('[GET /api/run-config] auto-open session failed:', openError.message)
      await logDeviceCall(supabase, { method: 'GET', endpoint: '/api/run-config', statusCode: 500, summary: 'auto-open session failed' })
      return NextResponse.json({ success: false, error: openError.message }, { status: 500 })
    }

    inventoryId = active.inventory_id
  }

  const { data, error } = await supabase
    .from('components')
    .select('name, weight_g')
    .eq('inventory_id', inventoryId)
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
