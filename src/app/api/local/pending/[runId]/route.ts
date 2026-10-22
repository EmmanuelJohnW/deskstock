import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { isHubMode, isLocalRequest } from '@/lib/localHub/net'
import { deletePendingRun } from '@/lib/localHub/store'

// Laptop hub only: forget a saved run once it has been uploaded (or discarded).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  if (!isHubMode()) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 })
  // Saved runs are only for the laptop's own dashboard, not other devices on the hotspot.
  if (!isLocalRequest(req.headers.get('host'))) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }
  const { runId } = await params
  try {
    await deletePendingRun(runId)
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_run_id' }, { status: 400 })
  }
  return NextResponse.json({ success: true })
}
