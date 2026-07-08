import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// ─── borrow_component — run in Supabase SQL editor ───────────────────────────
//
// Replaces the previous version that mutated inventory.in_stock.
// Now checks available stock from the ledger sum and writes a 'borrow' ledger
// entry atomically with the borrows row. The borrows table is kept intact —
// it remains the record of who has what and when it's due.
//
// v_available below sums ALL inventory_ledger reasons for the component
// (baseline/sort_session/adjustment/borrow/return) — this is the authoritative
// available quantity. get_inventory() (see src/app/inventory/page.tsx) must
// use the same all-reasons sum, or the "available" number shown in the
// Borrows dropdown will disagree with this guard and borrowing will fail with
// insufficient_stock even when the UI just claimed there was enough.
//
// p_inventory_id scopes the availability sum and both inserts — component
// names are only unique per inventory now (see api/components/route.ts).
//
// CREATE OR REPLACE FUNCTION public.borrow_component(
//   p_component    text,
//   p_qty          integer,
//   p_borrower     text,
//   p_due_at       timestamptz,
//   p_inventory_id bigint
// ) RETURNS uuid LANGUAGE plpgsql AS $$
// DECLARE
//   v_available integer;
//   v_borrow_id uuid;
// BEGIN
//   -- Net ledger balance is the authoritative available quantity.
//   SELECT COALESCE(SUM(delta), 0)
//   INTO   v_available
//   FROM   inventory_ledger
//   WHERE  component = p_component
//     AND  inventory_id = p_inventory_id;
//
//   IF v_available < p_qty THEN
//     RAISE EXCEPTION 'insufficient_stock';
//   END IF;
//
//   INSERT INTO borrows (component, qty, borrower, due_at, inventory_id)
//   VALUES (p_component, p_qty, p_borrower, p_due_at, p_inventory_id)
//   RETURNING id INTO v_borrow_id;
//
//   INSERT INTO inventory_ledger (component, delta, reason, inventory_id)
//   VALUES (p_component, -p_qty, 'borrow', p_inventory_id);
//
//   RETURN v_borrow_id;
// END;
// $$;
//
// ─────────────────────────────────────────────────────────────────────────────

const BorrowSchema = z.object({
  component: z.string().min(1),
  qty: z.number().int().min(1),
  borrower: z.string().min(1),
  due_at: z.string().datetime(),
  inventory_id: z.number().int().positive(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = BorrowSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const { component, qty, borrower, due_at, inventory_id } = parsed.data
  const supabase = getServerClient()

  const { data, error } = await supabase.rpc('borrow_component', {
    p_component: component,
    p_qty: qty,
    p_borrower: borrower,
    p_due_at: due_at,
    p_inventory_id: inventory_id,
  })

  if (error) {
    if (error.message === 'insufficient_stock') {
      return NextResponse.json({ success: false, error: 'insufficient_stock' }, { status: 409 })
    }
    console.error('[POST /api/borrows] borrow_component failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, borrow_id: data }, { status: 201 })
}
