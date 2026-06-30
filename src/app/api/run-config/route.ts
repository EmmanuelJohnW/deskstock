import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/server'

// Response shape: [{name: string, weight_g: number}]
// Postgres numeric returns as string over PostgREST — parseFloat before sending
// so the firmware always receives a JSON number, not a string.

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token || token !== process.env.INGEST_TOKEN) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await getServerClient()
    .from('components')
    .select('name, weight_g')
    .order('name', { ascending: true })

  if (error) {
    console.error('[GET /api/run-config]', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []).map(r => ({
    name: r.name as string,
    weight_g: parseFloat(r.weight_g as unknown as string),
  }))

  return NextResponse.json(rows)
}
