import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

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
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  // ── complete ───────────────────────────────────────────────────────────────

  // Idempotency: a re-POST of the same run_id must not double-count the tally.
  const { data: existing } = await supabase
    .from('runs')
    .select('run_id')
    .eq('run_id', data.run_id)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ success: true })
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
    return NextResponse.json({ success: false, error: sessionError.message }, { status: 500 })
  }

  if (!session) {
    return NextResponse.json({ success: false, error: 'no_open_session' }, { status: 409 })
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
    return NextResponse.json({ success: false, error: runError.message }, { status: 500 })
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
    return NextResponse.json({ success: false, error: binsError.message }, { status: 500 })
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
      return NextResponse.json({ success: false, error: tallyError.message }, { status: 500 })
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

  return NextResponse.json({ success: true }, { status: 201 })
}
