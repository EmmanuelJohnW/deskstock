import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// ─── return_borrow — run in Supabase SQL editor ──────────────────────────────
//
// Replaces the previous version that mutated inventory.in_stock.
// Marks the borrow returned and writes a 'return' ledger entry atomically.
// The already_returned guard is preserved.
//
// No p_inventory_id parameter needed — the borrow row itself already pins
// which inventory it belongs to, so the ledger entry inherits it from there.
//
// CREATE OR REPLACE FUNCTION public.return_borrow(p_borrow_id uuid)
// RETURNS void LANGUAGE plpgsql AS $$
// DECLARE
//   v_component   text;
//   v_qty         integer;
//   v_returned_at timestamptz;
//   v_inventory_id bigint;
// BEGIN
//   SELECT component, qty, returned_at, inventory_id
//   INTO   v_component, v_qty, v_returned_at, v_inventory_id
//   FROM   borrows
//   WHERE  id = p_borrow_id;
//
//   IF NOT FOUND THEN
//     RAISE EXCEPTION 'borrow_not_found';
//   END IF;
//
//   IF v_returned_at IS NOT NULL THEN
//     RAISE EXCEPTION 'already_returned';
//   END IF;
//
//   UPDATE borrows
//   SET    returned_at = now()
//   WHERE  id = p_borrow_id;
//
//   INSERT INTO inventory_ledger (component, delta, reason, inventory_id)
//   VALUES (v_component, v_qty, 'return', v_inventory_id);
// END;
// $$;
//
// ─────────────────────────────────────────────────────────────────────────────

const ReturnSchema = z.object({
  borrow_id: z.string().uuid(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = ReturnSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const { borrow_id } = parsed.data
  const supabase = getServerClient()

  const { error } = await supabase.rpc('return_borrow', { p_borrow_id: borrow_id })

  if (error) {
    if (error.message === 'already_returned') {
      return NextResponse.json({ success: false, error: 'already_returned' }, { status: 409 })
    }
    console.error('[POST /api/borrows/return] return_borrow failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
