import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/server'
import { persistCompleteRun, CompleteRunSchema } from '@/lib/ingest/completeRun'

// Dev/mock-only counterpart to /api/ingest's "complete" handler — see
// useDevice.ts. It exists as a separate, unauthenticated route (rather than
// having the browser POST to /api/ingest directly) because INGEST_TOKEN is a
// server-only secret that must never ship in the client bundle. It shares
// persistCompleteRun with /api/ingest so mock runs go through the exact same
// session-tally/reconciliation logic a real device run does — requires a
// count session to already be open (see /api/sessions), same as production.

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = CompleteRunSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const result = await persistCompleteRun(getServerClient(), parsed.data)
  return NextResponse.json(result.body, { status: result.status })
}
