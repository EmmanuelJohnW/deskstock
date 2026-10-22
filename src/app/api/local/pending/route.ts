import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { isHubMode, isLocalRequest } from '@/lib/localHub/net'
import { listPendingRuns } from '@/lib/localHub/store'

// Laptop hub only: finished sort runs saved on this laptop, waiting for the
// dashboard to upload them (they're imported into its offline queue).
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isHubMode()) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 })
  // Saved runs are only for the laptop's own dashboard, not other devices on the hotspot.
  if (!isLocalRequest(req.headers.get('host'))) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }
  return NextResponse.json({ runs: await listPendingRuns() })
}
