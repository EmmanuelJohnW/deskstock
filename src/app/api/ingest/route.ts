import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'
import { logDeviceCall } from '@/lib/deviceLog'
import { LIVE_RUN_STALE_MS } from '@/lib/device/liveRunStaleness'

// ─── Prerequisites — run in Supabase SQL editor before deploying ──────────────
//
// 1. Make runs.profile nullable (profile concept removed from device protocol):
//    alter table public.runs alter column profile drop not null;
//
// 2. Session tally table — one row per (session, component), updated in place:
//    create table public.session_tallies (
//      session_id bigint  not null references public.count_sessions(id),
//      component  text    not null,
//      qty        integer not null default 0,
//      updated_at timestamptz not null default now(),
//      primary key (session_id, component)
//    );
//    alter table public.session_tallies enable row level security;
//    create policy "public read session_tallies"
//      on public.session_tallies for select using (true);
//
// 3. Additive-upsert helper used by the complete path below:
//    create or replace function public.add_to_session_tally(
//      p_session_id bigint,
//      p_rows       jsonb   -- [{component, qty}]
//    ) returns void language plpgsql as $$
//    begin
//      insert into session_tallies (session_id, component, qty, updated_at)
//      select p_session_id,
//             r->>'component',
//             (r->>'qty')::integer,
//             now()
//      from   jsonb_array_elements(p_rows) as r
//      on conflict (session_id, component) do update
//        set qty        = session_tallies.qty + excluded.qty,
//            updated_at = now();
//    end;
//    $$;
//
// ─────────────────────────────────────────────────────────────────────────────

const BinSchema = z.object({
  name:     z.string().min(1),
  weight_g: z.number().positive(),
  bin:      z.number().int().min(0),
  count:    z.number().int().min(0),
})

const RunningBody = z.object({
  status:           z.literal('running'),
  run_id:           z.string().min(1),
  elapsed_ms:       z.number().int().min(0),
  est_remaining_ms: z.number().int().min(0).nullable(),
  bins:             z.array(BinSchema),
})

const CompleteBody = z.object({
  status:      z.literal('complete'),
  run_id:      z.string().min(1),
  duration_ms: z.number().int().min(0),
  started_at:  z.string().datetime(),
  bins:        z.array(BinSchema).min(1),
})

const IngestSchema = z.discriminatedUnion('status', [RunningBody, CompleteBody])

type Bin = z.infer<typeof BinSchema>

function summarizeBins(bins: Bin[]): string {
  if (bins.length === 0) return 'no bins'
  const top = bins.reduce((a, b) => (b.count > a.count ? b : a))
  return `${top.name} x${top.count} bin${top.bin}`
}

async function respond(
  supabase: ReturnType<typeof getServerClient>,
  status: number,
  body: Record<string, unknown>,
  summary: string,
): Promise<NextResponse> {
  await logDeviceCall(supabase, { method: 'POST', endpoint: '/api/ingest', statusCode: status, summary })
  return NextResponse.json(body, { status })
}

export async function POST(req: NextRequest) {
  const supabase = getServerClient()

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token || token !== process.env.INGEST_TOKEN) {
    return respond(supabase, 401, { success: false, error: 'Unauthorized' }, 'unauthorized')
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return respond(supabase, 400, { success: false, error: 'Invalid JSON' }, 'invalid json')
  }

  const parsed = IngestSchema.safeParse(body)
  if (!parsed.success) {
    return respond(supabase, 422, { success: false, error: parsed.error.flatten() }, 'validation failed')
  }

  const data = parsed.data

  // ── running: keep the live view current ───────────────────────────────────
  if (data.status === 'running') {
    const { error } = await supabase.from('live_runs').upsert(
      {
        run_id:           data.run_id,
        status:           'running',
        elapsed_ms:       data.elapsed_ms,
        est_remaining_ms: data.est_remaining_ms,
        bins:             data.bins,
        updated_at:       new Date().toISOString(),
      },
      { onConflict: 'run_id' },
    )
    if (error) {
      console.error('[POST /api/ingest] upsert live_runs failed:', error.message)
      return respond(supabase, 500, { success: false, error: error.message }, 'upsert live_runs failed')
    }

    // Best-effort: clear out any other run's row that's gone stale (device
    // died mid-run, no 'complete' ping ever arrived). Non-fatal if it fails —
    // readers already filter live_runs by recency, so a leftover row is inert.
    const staleCutoff = new Date(Date.now() - LIVE_RUN_STALE_MS).toISOString()
    const { error: cleanupError } = await supabase
      .from('live_runs')
      .delete()
      .neq('run_id', data.run_id)
      .lt('updated_at', staleCutoff)
    if (cleanupError) {
      console.error('[POST /api/ingest] stale live_runs cleanup failed:', cleanupError.message)
    }

    return respond(supabase, 200, { success: true }, summarizeBins(data.bins))
  }

  // ── complete ───────────────────────────────────────────────────────────────

  // Idempotency: a re-POST of the same run_id must not double-count the tally.
  const { data: existing } = await supabase
    .from('runs')
    .select('run_id')
    .eq('run_id', data.run_id)
    .maybeSingle()

  if (existing) {
    return respond(supabase, 200, { success: true }, 'duplicate run_id')
  }

  // Every cycle must belong to an open counting session.
  const { data: session, error: sessionError } = await supabase
    .from('count_sessions')
    .select('id')
    .eq('status', 'open')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sessionError) {
    console.error('[POST /api/ingest] session lookup failed:', sessionError.message)
    return respond(supabase, 500, { success: false, error: sessionError.message }, 'session lookup failed')
  }

  if (!session) {
    return respond(supabase, 409, { success: false, error: 'no_open_session' }, 'no open session')
  }

  // Record the cycle run for audit history.
  const total = data.bins.reduce((acc, b) => acc + b.count, 0)

  const { error: runError } = await supabase.from('runs').insert({
    run_id:      data.run_id,
    started_at:  data.started_at,
    duration_ms: data.duration_ms,
    total,
    status:      'complete',
    session_id:  session.id,
  })
  if (runError) {
    console.error('[POST /api/ingest] insert run failed:', runError.message)
    return respond(supabase, 500, { success: false, error: runError.message }, 'insert run failed')
  }

  // Record individual bin snapshots — bin↔component mapping is cycle-local only.
  const { error: binsError } = await supabase.from('bins').insert(
    data.bins.map(b => ({
      run_id:    data.run_id,
      idx:       b.bin,
      component: b.name,
      count:     b.count,
    })),
  )
  if (binsError) {
    console.error('[POST /api/ingest] insert bins failed:', binsError.message)
    return respond(supabase, 500, { success: false, error: binsError.message }, 'insert bins failed')
  }

  // Roll up this cycle's counts by component name into the session tally.
  // Bin 6 is always the reject/unknown chute — kept in bins for audit but never
  // tallied. Bins with count=0 are also skipped. Multiple bins carrying the same
  // name are summed (device may split a component across bins on overflow).
  const REJECT_BIN = 6
  const tallyMap = new Map<string, number>()
  for (const b of data.bins) {
    if (b.bin !== REJECT_BIN && b.count > 0) tallyMap.set(b.name, (tallyMap.get(b.name) ?? 0) + b.count)
  }

  if (tallyMap.size > 0) {
    const tallyRows = Array.from(tallyMap, ([component, qty]) => ({ component, qty }))

    // ── session_tallies is where the per-session count lives ─────────────────
    // add_to_session_tally does qty += excluded.qty on conflict, never replacing.
    const { error: tallyError } = await supabase.rpc('add_to_session_tally', {
      p_session_id: session.id,
      p_rows:       tallyRows,
    })
    if (tallyError) {
      console.error('[POST /api/ingest] add_to_session_tally failed:', tallyError.message)
      return respond(supabase, 500, { success: false, error: tallyError.message }, 'tally failed')
    }
  }

  // Remove the live entry — this cycle is fully committed.
  const { error: delError } = await supabase
    .from('live_runs')
    .delete()
    .eq('run_id', data.run_id)
  if (delError) {
    // Non-fatal: tally is already written; stale row will clear on next cycle.
    console.error('[POST /api/ingest] delete live_runs failed:', delError.message)
  }

  return respond(supabase, 201, { success: true }, `complete ${summarizeBins(data.bins)}`)
}
