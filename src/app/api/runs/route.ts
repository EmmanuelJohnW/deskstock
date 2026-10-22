import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { isHubMode } from '@/lib/localHub/net'
import { persistCompleteRun, CompleteRunSchema } from '@/lib/ingest/completeRun'

// inventory_id is sent for runs uploaded from the laptop hub (they were sorted
// offline into a known inventory); without it, the newest open session is used.
const RunsBody = CompleteRunSchema.extend({
  inventory_id: z.number().int().positive().optional(),
})

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

  const parsed = RunsBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const { inventory_id, ...run } = parsed.data
  // Choosing the inventory is only for uploads from the laptop hub.
  const options = inventory_id && isHubMode() ? { inventoryId: inventory_id } : {}
  const result = await persistCompleteRun(getServerClient(), run, options)
  return NextResponse.json(result.body, { status: result.status })
}
