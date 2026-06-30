import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/server'
import { logDeviceCall } from '@/lib/deviceLog'

// Stub: firmware polls this for Start/Stop signals from the dashboard.
// Always returns {command: null} until command dispatch is implemented.

export async function GET(req: NextRequest) {
  const supabase = getServerClient()

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token || token !== process.env.INGEST_TOKEN) {
    await logDeviceCall(supabase, { method: 'GET', endpoint: '/api/commands', statusCode: 401, summary: 'unauthorized' })
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  await logDeviceCall(supabase, { method: 'GET', endpoint: '/api/commands', statusCode: 200, summary: 'no command' })
  return NextResponse.json({ command: null })
}
