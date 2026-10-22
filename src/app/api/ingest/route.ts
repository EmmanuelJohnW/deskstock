import 'server-only'
import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'
import { logDeviceCall } from '@/lib/deviceLog'
import { LIVE_RUN_STALE_MS } from '@/lib/device/liveRunStaleness'
import { persistCompleteRun, CompleteRunSchema, CompleteRunBinSchema } from '@/lib/ingest/completeRun'
import { isHubMode } from '@/lib/localHub/net'
import { fixStartedAt, getSelectedInventory, hubMemory, savePendingRun } from '@/lib/localHub/store'

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

const RunningBody = z.object({
  status:           z.literal('running'),
  run_id:           z.string().min(1),
  elapsed_ms:       z.number().int().min(0),
  est_remaining_ms: z.number().int().min(0).nullable(),
  bins:             z.array(CompleteRunBinSchema),
})

const CompleteBody = CompleteRunSchema.extend({
  status: z.literal('complete'),
})

const IngestSchema = z.discriminatedUnion('status', [RunningBody, CompleteBody])

type Bin = z.infer<typeof CompleteRunBinSchema>

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
  const entry = { method: 'POST' as const, endpoint: '/api/ingest', statusCode: status, summary }
  // On the laptop hub, never make the device wait on an internet request.
  if (isHubMode()) after(() => logDeviceCall(supabase, entry))
  else await logDeviceCall(supabase, entry)
  return NextResponse.json(body, { status })
}

type IngestBody = z.infer<typeof IngestSchema>

/**
 * Laptop hub (docs/local-hub.md): the device reached this laptop, usually
 * because the hotspot has no internet. Keep the live view in memory and save
 * finished runs on disk; the dashboard uploads them when it's back online.
 */
async function handleOnHub(supabase: ReturnType<typeof getServerClient>, data: IngestBody): Promise<NextResponse> {
  const hub = hubMemory()
  const now = new Date()
  hub.deviceSeenAt = now.toISOString()

  if (data.status === 'running') {
    hub.live = {
      run_id: data.run_id,
      status: 'running',
      elapsed_ms: data.elapsed_ms,
      est_remaining_ms: data.est_remaining_ms,
      bins: data.bins,
      updated_at: now.toISOString(),
    }
    return respond(supabase, 200, { success: true, hub: true }, summarizeBins(data.bins))
  }

  try {
    await savePendingRun({
      run_id: data.run_id,
      inventory_id: hub.runInventoryId ?? (await getSelectedInventory()),
      started_at: fixStartedAt(data.started_at, data.duration_ms, now),
      duration_ms: data.duration_ms,
      bins: data.bins,
      received_at: now.toISOString(),
    })
  } catch (err) {
    console.error('[POST /api/ingest] could not save the run on the laptop:', err)
    return respond(supabase, 500, { success: false, error: 'could_not_save_on_laptop' }, 'save on laptop failed')
  }
  // The next run must ask run-config again for its inventory.
  hub.runInventoryId = null
  hub.live = null
  hub.lastCompleted = {
    run_id: data.run_id,
    total: data.bins.reduce((sum, b) => sum + b.count, 0),
    duration_ms: data.duration_ms,
  }
  return respond(supabase, 201, { success: true, hub: true }, `saved on laptop ${summarizeBins(data.bins)}`)
}

export async function POST(req: NextRequest) {
  const supabase = getServerClient({ fastFail: true })

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
  if (isHubMode()) return handleOnHub(supabase, data)

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

  const result = await persistCompleteRun(supabase, {
    run_id:      data.run_id,
    duration_ms: data.duration_ms,
    started_at:  data.started_at,
    bins:        data.bins,
  })
  const summary = result.status === 201 ? `complete ${summarizeBins(data.bins)}` : result.summary
  return respond(supabase, result.status, result.body, summary)
}
