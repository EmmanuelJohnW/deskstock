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
// Offline sync support (see src/lib/offline): p_id lets a queued borrow be
// replayed safely (an existing id means "already done"), and p_at records when
// it actually happened. Both default to null, so plain calls still work.
// client_op_id on inventory_ledger links the ledger row to the action.
//
// alter table public.inventory_ledger
//   add column if not exists client_op_id uuid unique;
//
// drop function if exists public.borrow_component(text, integer, text, timestamptz, bigint);
//
// create or replace function public.borrow_component(
//   p_component    text,
//   p_qty          integer,
//   p_borrower     text,
//   p_due_at       timestamptz,
//   p_inventory_id bigint,
//   p_id           uuid        default null,
//   p_at           timestamptz default null
// ) returns uuid language plpgsql as $$
// declare
//   v_available integer;
//   v_borrow_id uuid;
// begin
//   if p_id is not null and exists (select 1 from borrows where id = p_id) then
//     return p_id;
//   end if;
//
//   select coalesce(sum(delta), 0) into v_available
//   from inventory_ledger
//   where component = p_component and inventory_id = p_inventory_id;
//
//   if v_available < p_qty then
//     raise exception 'insufficient_stock';
//   end if;
//
//   insert into borrows (id, component, qty, borrower, due_at, taken_at, inventory_id)
//   values (coalesce(p_id, gen_random_uuid()), p_component, p_qty, p_borrower, p_due_at,
//           coalesce(p_at, now()), p_inventory_id)
//   returning id into v_borrow_id;
//
//   insert into inventory_ledger (component, delta, reason, inventory_id, created_at, client_op_id)
//   values (p_component, -p_qty, 'borrow', p_inventory_id, coalesce(p_at, now()), p_id);
//
//   return v_borrow_id;
// end;
// $$;
//
// notify pgrst, 'reload schema';
//
// ─────────────────────────────────────────────────────────────────────────────

const BorrowSchema = z.object({
  component: z.string().min(1),
  qty: z.number().int().min(1),
  borrower: z.string().min(1),
  due_at: z.string().datetime(),
  inventory_id: z.number().int().positive(),
  // Set by offline sync: a client-generated id (makes replays safe) and when it happened.
  id: z.string().uuid().optional(),
  occurred_at: z.string().datetime().optional(),
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

  const { component, qty, borrower, due_at, inventory_id, id, occurred_at } = parsed.data
  const supabase = getServerClient()

  const { data, error } = await supabase.rpc('borrow_component', {
    p_component: component,
    p_qty: qty,
    p_borrower: borrower,
    p_due_at: due_at,
    p_inventory_id: inventory_id,
    p_id: id ?? null,
    p_at: occurred_at ?? null,
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
