import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isHubForcedOffline, isHubMode, isLocalRequest, setHubForcedOffline } from '@/lib/localHub/net'

// Laptop hub only: the "Work offline" switch on the Sync page. When on, the
// device-facing routes never use the internet (the device gets the saved
// component list, runs stay on the laptop) until it's switched off.
const ModeSchema = z.object({ offline: z.boolean() })

function guard(req: NextRequest): NextResponse | null {
  if (!isHubMode()) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 })
  if (!isLocalRequest(req.headers.get('host'))) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }
  return null
}

export async function GET(req: NextRequest) {
  return guard(req) ?? NextResponse.json({ offline: isHubForcedOffline() })
}

export async function POST(req: NextRequest) {
  const denied = guard(req)
  if (denied) return denied
  const parsed = ModeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 422 })
  await setHubForcedOffline(parsed.data.offline)
  return NextResponse.json({ offline: isHubForcedOffline() })
}
