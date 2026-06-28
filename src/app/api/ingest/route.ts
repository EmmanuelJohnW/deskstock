import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

const BinSchema = z.object({
  idx: z.number().int().min(0),
  component: z.string().min(1),
  count: z.number().int().min(0),
})

const RunningBody = z.object({
  status: z.literal('running'),
  run_id: z.string().min(1),
  profile: z.string().min(1),
  elapsed_ms: z.number().int().min(0),
  est_remaining_ms: z.number().int().min(0).nullable(),
  bins: z.array(BinSchema).min(1),
})

const CompleteBody = z.object({
  status: z.literal('complete'),
  run_id: z.string().min(1),
  profile: z.string().min(1),
  total: z.number().int().min(0),
  duration_ms: z.number().int().min(0),
  started_at: z.string().datetime(),
  bins: z.array(BinSchema).min(1),
})

const IngestSchema = z.discriminatedUnion('status', [RunningBody, CompleteBody])

function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token || token !== process.env.INGEST_TOKEN) return unauthorized()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = IngestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const data = parsed.data
  const supabase = getServerClient()

  if (data.status === 'running') {
    const { error } = await supabase.from('live_runs').upsert(
      {
        run_id: data.run_id,
        status: 'running',
        profile: data.profile,
        elapsed_ms: data.elapsed_ms,
        est_remaining_ms: data.est_remaining_ms,
        bins: data.bins,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'run_id' },
    )
    if (error) {
      console.error('[POST /api/ingest] upsert failed:', error.message)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  // status === 'complete'
  const binSum = data.bins.reduce((acc, b) => acc + b.count, 0)
  if (binSum !== data.total) {
    return NextResponse.json(
      {
        success: false,
        error: 'bin_count_mismatch',
        detail: { bin_sum: binSum, total_claimed: data.total },
      },
      { status: 422 },
    )
  }

  const rejectIdx = Math.max(...data.bins.map(b => b.idx))
  const binsWithFlag = data.bins.map(b => ({ ...b, is_reject: b.idx === rejectIdx }))

  const { error: rpcError } = await supabase.rpc('persist_run', {
    p_run_id: data.run_id,
    p_profile: data.profile,
    p_total: data.total,
    p_duration_ms: data.duration_ms,
    p_started_at: data.started_at,
    p_bins: binsWithFlag,
  })
  if (rpcError) {
    console.error('[POST /api/ingest] persist_run failed:', rpcError.message)
    return NextResponse.json({ success: false, error: rpcError.message }, { status: 500 })
  }

  const { error: delError } = await supabase
    .from('live_runs')
    .delete()
    .eq('run_id', data.run_id)
  if (delError) {
    // Non-fatal: persist_run succeeded; stale row will be cleaned on next run
    console.error('[POST /api/ingest] delete live_runs failed:', delError.message)
  }

  return NextResponse.json({ success: true })
}
