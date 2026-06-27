import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// Expected persist_run Postgres function signature (run this in Supabase SQL editor):
//
// CREATE OR REPLACE FUNCTION persist_run(
//   p_run_id     text,
//   p_profile    text,
//   p_total      integer,
//   p_duration_ms integer,
//   p_started_at  timestamptz,
//   p_bins        jsonb   -- [{idx, component, count, is_reject}]
// ) RETURNS void LANGUAGE plpgsql AS $$
// BEGIN
//   INSERT INTO runs (id, started_at, profile, total, duration_ms, status)
//   VALUES (p_run_id, p_started_at, p_profile, p_total, p_duration_ms, 'complete');
//
//   INSERT INTO bins (run_id, idx, component, count)
//   SELECT p_run_id, (b->>'idx')::int, b->>'component', (b->>'count')::int
//   FROM jsonb_array_elements(p_bins) AS b;
//
//   INSERT INTO inventory (component, in_stock)
//   SELECT b->>'component', (b->>'count')::int
//   FROM jsonb_array_elements(p_bins) AS b
//   WHERE (b->>'is_reject')::boolean = false
//   ON CONFLICT (component) DO UPDATE
//     SET in_stock = inventory.in_stock + EXCLUDED.in_stock;
// END;
// $$;

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
