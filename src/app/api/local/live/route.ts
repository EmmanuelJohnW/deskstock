import 'server-only'
import { NextResponse } from 'next/server'
import { isHubMode } from '@/lib/localHub/net'
import { hubMemory } from '@/lib/localHub/store'

// Laptop hub only: the sort in progress (same shape as a live_runs row) and the
// last finished run, polled by the dashboard (src/lib/device/LocalHubConnection.ts).
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!isHubMode()) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 })
  const { live, lastCompleted, deviceSeenAt } = hubMemory()
  return NextResponse.json({ live, lastCompleted, deviceSeenAt })
}
