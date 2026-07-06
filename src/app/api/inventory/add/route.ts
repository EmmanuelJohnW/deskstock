import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// ─── add_stock — run in Supabase SQL editor ──────────────────────────────────
//
// Records a component coming back into physical stock (a restock, a manual
// correction, or units returning from loan) as a ledger entry.
//
// There's no way to tell, from a handful of parts dropped back in a bin,
// whether they're brand-new stock or a borrower's returned units — so if the
// same component has open borrows from different people, the incoming
// quantity is applied against them earliest-taken-first (FIFO): the oldest
// outstanding loan is assumed to be the one that came back. A borrow is only
// closed when the remaining quantity fully covers it — no partial returns,
// since the borrows table has no field for a partially-returned qty. Once all
// open borrows are satisfied (or there are none), anything left over is
// recorded as a plain 'adjustment' ledger delta — genuinely new stock, not
// tied to any loan.
//
// CREATE OR REPLACE FUNCTION public.add_stock(
//   p_component text,
//   p_qty       integer
// ) RETURNS TABLE(borrow_id uuid, borrower text, qty integer, taken_at timestamptz)
// LANGUAGE plpgsql AS $$
// DECLARE
//   v_remaining integer := p_qty;
//   v_borrow    RECORD;
// BEGIN
//   IF p_qty <= 0 THEN
//     RAISE EXCEPTION 'qty_must_be_positive';
//   END IF;
//
//   FOR v_borrow IN
//     SELECT id, borrower, qty, taken_at
//     FROM   borrows
//     WHERE  component = p_component
//       AND  returned_at IS NULL
//     ORDER BY taken_at ASC
//     FOR UPDATE
//   LOOP
//     EXIT WHEN v_remaining < v_borrow.qty;
//
//     UPDATE borrows
//     SET    returned_at = now()
//     WHERE  id = v_borrow.id;
//
//     INSERT INTO inventory_ledger (component, delta, reason)
//     VALUES (p_component, v_borrow.qty, 'return');
//
//     v_remaining := v_remaining - v_borrow.qty;
//
//     borrow_id := v_borrow.id;
//     borrower  := v_borrow.borrower;
//     qty       := v_borrow.qty;
//     taken_at  := v_borrow.taken_at;
//     RETURN NEXT;
//   END LOOP;
//
//   IF v_remaining > 0 THEN
//     INSERT INTO inventory_ledger (component, delta, reason)
//     VALUES (p_component, v_remaining, 'adjustment');
//   END IF;
// END;
// $$;
//
// ─────────────────────────────────────────────────────────────────────────────

const AddStockSchema = z.object({
  component: z.string().min(1),
  qty: z.number().int().min(1),
})

interface ClosedBorrow {
  borrow_id: string
  borrower: string
  qty: number
  taken_at: string
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = AddStockSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const { component, qty } = parsed.data
  const supabase = getServerClient()

  const { data, error } = await supabase.rpc('add_stock', {
    p_component: component,
    p_qty: qty,
  })

  if (error) {
    console.error('[POST /api/inventory/add] add_stock failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    closed_borrows: (data ?? []) as ClosedBorrow[],
  })
}
