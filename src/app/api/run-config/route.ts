import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/server'
import { logDeviceCall } from '@/lib/deviceLog'

// Response shape: [{name: string, weight_g: number}]
// Postgres numeric returns as string over PostgREST — parseFloat before sending
// so the firmware always receives a JSON number, not a string.

export async function GET(req: NextRequest) {
  const supabase = getServerClient()

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token || token !== process.env.INGEST_TOKEN) {
    await logDeviceCall(supabase, { method: 'GET', endpoint: '/api/run-config', statusCode: 401, summary: 'unauthorized' })
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('components')
    .select('name, weight_g')
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
