import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'
import { REJECT_BIN_IDX } from '@/lib/device/binLayout'

// ─── persist_run — run this in the Supabase SQL editor ────────────────────────
//
// Writes the runs row and bin snapshots only.
// inventory_ledger is never touched here — sort_session deltas are written
// to inventory_ledger only during session reconciliation (Finish Count).
//
// CREATE OR REPLACE FUNCTION public.persist_run(
//   p_run_id      text,
//   p_profile     text,
//   p_total       integer,
//   p_duration_ms integer,
//   p_started_at  timestamptz,
//   p_bins        jsonb,        -- [{idx, component, count}]
//   p_session_id  bigint default null
// ) RETURNS void LANGUAGE plpgsql AS $$
// BEGIN
//   INSERT INTO runs (run_id, started_at, profile, total, duration_ms, status, session_id)
//   VALUES (p_run_id, p_started_at, p_profile, p_total, p_duration_ms, 'complete', p_session_id)
//   ON CONFLICT (run_id) DO NOTHING;
//
//   -- run_id already existed: re-POST is a no-op
//   IF NOT FOUND THEN
//     RETURN;
//   END IF;
//
//   INSERT INTO bins (run_id, idx, component, count)
//   SELECT p_run_id,
//          (b->>'idx')::integer,
//          b->>'component',
//          (b->>'count')::integer
//   FROM jsonb_array_elements(p_bins) AS b;
// END;
// $$;
// ──────────────────────────────────────────────────────────────────────────────

const BinSchema = z.object({
  idx: z.number().int().min(0),
  component: z.string().min(1),
  count: z.number().int().min(0),
})

const RunSchema = z.object({
  run_id: z.string().min(1),
  profile: z.string().min(1),
  total: z.number().int().min(0),
  duration_ms: z.number().int().min(0),
  started_at: z.string().datetime(),
  bins: z.array(BinSchema).min(1),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = RunSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const { run_id, profile, total, duration_ms, started_at, bins } = parsed.data

  // Device-authoritative integrity check: the device's reported total must equal
  // the sum of all bin counts. A mismatch means a bin/event landed in the same
  // tick as sort/complete and was lost — reject rather than persist corrupt data.
  const binSum = bins.reduce((acc, b) => acc + b.count, 0)
  if (binSum !== total) {
    return NextResponse.json(
      {
        success: false,
        error: 'bin_count_mismatch',
        detail: { bin_sum: binSum, total_claimed: total },
      },
      { status: 422 },
    )
  }

  // Bin 0 is always the reject/unknown chute — excluded from inventory
  const binsWithRejectFlag = bins.map(b => ({ ...b, is_reject: b.idx === REJECT_BIN_IDX }))

  const supabase = getServerClient()

  const { error } = await supabase.rpc('persist_run', {
    p_run_id: run_id,
    p_profile: profile,
    p_total: total,
    p_duration_ms: duration_ms,
    p_started_at: started_at,
    p_bins: binsWithRejectFlag,
  })

  if (error) {
    console.error('[POST /api/runs] persist_run failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true }, { status: 201 })
}
