import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// ─── persist_run — run this in the Supabase SQL editor ────────────────────────
//
// Replaces the existing 5-param stub (which lacks p_started_at).
// Corrections vs. the draft:
//   • runs PK is run_id, not id
//   • p_started_at added (wall-clock time captured by the hook)
//   • ON CONFLICT (run_id) DO NOTHING makes re-POSTs idempotent;
//     IF NOT FOUND guard skips bins/inventory when the run already exists
//   • inventory upsert sets updated_at = now()
//
// CREATE OR REPLACE FUNCTION persist_run(
//   p_run_id      text,
//   p_profile     text,
//   p_total       integer,
//   p_duration_ms integer,
//   p_started_at  timestamptz,
//   p_bins        jsonb    -- [{idx, component, count, is_reject}]
// ) RETURNS void LANGUAGE plpgsql AS $$
// BEGIN
//   INSERT INTO runs (run_id, started_at, profile, total, duration_ms, status)
//   VALUES (p_run_id, p_started_at, p_profile, p_total, p_duration_ms, 'complete')
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
//
//   INSERT INTO inventory (component, in_stock)
//   SELECT b->>'component',
//          (b->>'count')::integer
//   FROM jsonb_array_elements(p_bins) AS b
//   WHERE (b->>'is_reject')::boolean = false
//   ON CONFLICT (component) DO UPDATE
//     SET in_stock   = inventory.in_stock + EXCLUDED.in_stock,
//         updated_at = now();
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

  // Bin with the highest idx is the reject/unknown chute — excluded from inventory
  const rejectIdx = Math.max(...bins.map(b => b.idx))
  const binsWithRejectFlag = bins.map(b => ({ ...b, is_reject: b.idx === rejectIdx }))

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
