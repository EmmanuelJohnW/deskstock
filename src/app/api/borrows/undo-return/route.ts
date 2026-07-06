import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// ─── undo_return — run in Supabase SQL editor ────────────────────────────────
//
// Reopens a borrow that was returned by mistake — whether closed manually via
// return_borrow, or auto-matched by add_stock's FIFO/override logic. Ledger
// entries are never deleted or edited (they're an append-only audit trail),
// so this writes a compensating negative 'return_reversal' entry instead of
// touching the original 'return' row.
//
// Guarded against undoing when there isn't enough current stock to cover
// it — if those units already went back out on a new loan, or were consumed
// by a sort-session correction, reversing the return would make the ledger
// balance lie about what's physically on hand.
//
// CREATE OR REPLACE FUNCTION public.undo_return(p_borrow_id uuid)
// RETURNS void LANGUAGE plpgsql AS $$
// DECLARE
//   v_component   text;
//   v_qty         integer;
//   v_returned_at timestamptz;
//   v_available   integer;
// BEGIN
//   SELECT component, qty, returned_at
//   INTO   v_component, v_qty, v_returned_at
//   FROM   borrows
//   WHERE  id = p_borrow_id;
//
//   IF NOT FOUND THEN
//     RAISE EXCEPTION 'borrow_not_found';
//   END IF;
//
//   IF v_returned_at IS NULL THEN
//     RAISE EXCEPTION 'not_returned';
//   END IF;
//
//   SELECT COALESCE(SUM(delta), 0)
//   INTO   v_available
//   FROM   inventory_ledger
//   WHERE  component = v_component;
//
//   IF v_available < v_qty THEN
//     RAISE EXCEPTION 'insufficient_stock_to_undo';
//   END IF;
//
//   UPDATE borrows
//   SET    returned_at = NULL
//   WHERE  id = p_borrow_id;
//
//   INSERT INTO inventory_ledger (component, delta, reason)
//   VALUES (v_component, -v_qty, 'return_reversal');
// END;
// $$;
//
// ─────────────────────────────────────────────────────────────────────────────

const UndoReturnSchema = z.object({
  borrow_id: z.string().uuid(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = UndoReturnSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const { borrow_id } = parsed.data
  const supabase = getServerClient()

  const { error } = await supabase.rpc('undo_return', { p_borrow_id: borrow_id })

  if (error) {
    if (error.message === 'not_returned') {
      return NextResponse.json({ success: false, error: 'not_returned' }, { status: 409 })
    }
    if (error.message === 'borrow_not_found') {
      return NextResponse.json({ success: false, error: 'borrow_not_found' }, { status: 404 })
    }
    if (error.message === 'insufficient_stock_to_undo') {
      return NextResponse.json({ success: false, error: 'insufficient_stock_to_undo' }, { status: 409 })
    }
    console.error('[POST /api/borrows/undo-return] undo_return failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
