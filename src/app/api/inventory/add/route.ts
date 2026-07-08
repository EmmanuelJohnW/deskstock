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
// p_borrow_id is an optional manual override: when given, that specific open
// borrow is force-closed first (still must be fully covered by p_qty — no
// partial returns), and FIFO only runs on whatever quantity is left after
// that, against the remaining open borrows. Omit it (or pass null) for pure
// FIFO, unchanged from before.
//
// This replaces the prior 2-argument version — DROP it first so Postgres
// doesn't end up with two overloaded add_stock functions side by side.
//
// DROP FUNCTION IF EXISTS public.add_stock(text, integer);
//
// p_inventory_id scopes every lookup below — component names are only unique
// per inventory now (see api/components/route.ts), so matching on component
// text alone would let stock from one lab satisfy borrows from another.
//
// CREATE OR REPLACE FUNCTION public.add_stock(
//   p_component    text,
//   p_qty          integer,
//   p_inventory_id bigint,
//   p_borrow_id    uuid DEFAULT NULL
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
//   -- Tables aliased as b throughout: the OUT parameters above are named
//   -- borrower/qty/taken_at, same as columns on borrows, so plpgsql can't
//   -- tell them apart without qualification ("column reference is ambiguous").
//   IF p_borrow_id IS NOT NULL THEN
//     SELECT b.id, b.borrower, b.qty, b.taken_at
//     INTO   v_borrow
//     FROM   borrows b
//     WHERE  b.id = p_borrow_id
//       AND  b.component = p_component
//       AND  b.inventory_id = p_inventory_id
//       AND  b.returned_at IS NULL
//     FOR UPDATE;
//
//     IF NOT FOUND THEN
//       RAISE EXCEPTION 'borrow_not_found_or_already_returned';
//     END IF;
//
//     IF v_remaining < v_borrow.qty THEN
//       RAISE EXCEPTION 'qty_below_selected_borrow';
//     END IF;
//
//     UPDATE borrows
//     SET    returned_at = now()
//     WHERE  id = v_borrow.id;
//
//     INSERT INTO inventory_ledger (component, delta, reason, inventory_id)
//     VALUES (p_component, v_borrow.qty, 'return', p_inventory_id);
//
//     v_remaining := v_remaining - v_borrow.qty;
//
//     borrow_id := v_borrow.id;
//     borrower  := v_borrow.borrower;
//     qty       := v_borrow.qty;
//     taken_at  := v_borrow.taken_at;
//     RETURN NEXT;
//   END IF;
//
//   -- FIFO for whatever's left. Excludes the borrow closed above (its
//   -- returned_at is already set by the time this query runs).
//   FOR v_borrow IN
//     SELECT b.id, b.borrower, b.qty, b.taken_at
//     FROM   borrows b
//     WHERE  b.component = p_component
//       AND  b.inventory_id = p_inventory_id
//       AND  b.returned_at IS NULL
//     ORDER BY b.taken_at ASC
//     FOR UPDATE
//   LOOP
//     EXIT WHEN v_remaining < v_borrow.qty;
//
//     UPDATE borrows
//     SET    returned_at = now()
//     WHERE  id = v_borrow.id;
//
//     INSERT INTO inventory_ledger (component, delta, reason, inventory_id)
//     VALUES (p_component, v_borrow.qty, 'return', p_inventory_id);
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
//     INSERT INTO inventory_ledger (component, delta, reason, inventory_id)
//     VALUES (p_component, v_remaining, 'adjustment', p_inventory_id);
//   END IF;
// END;
// $$;
//
// ─────────────────────────────────────────────────────────────────────────────

const AddStockSchema = z.object({
  component: z.string().min(1),
  qty: z.number().int().min(1),
  inventory_id: z.number().int().positive(),
  borrow_id: z.string().uuid().optional(),
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

  const { component, qty, inventory_id, borrow_id } = parsed.data
  const supabase = getServerClient()

  const { data, error } = await supabase.rpc('add_stock', {
    p_component: component,
    p_qty: qty,
    p_inventory_id: inventory_id,
    p_borrow_id: borrow_id ?? null,
  })

  if (error) {
    if (error.message === 'qty_below_selected_borrow') {
      return NextResponse.json({ success: false, error: 'qty_below_selected_borrow' }, { status: 422 })
    }
    if (error.message === 'borrow_not_found_or_already_returned') {
      return NextResponse.json({ success: false, error: 'borrow_not_found_or_already_returned' }, { status: 409 })
    }
    console.error('[POST /api/inventory/add] add_stock failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    closed_borrows: (data ?? []) as ClosedBorrow[],
  })
}
