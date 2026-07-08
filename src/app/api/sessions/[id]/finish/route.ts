import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getServerClient } from '@/lib/supabase/server'

// ─── reconcile_session — run in Supabase SQL editor ───────────────────────────
//
// inventory_ledger, borrows and reconciliations all need an inventory_id
// column now that component names are only unique per inventory (see
// api/components/route.ts) — two labs can each have a "10k resistor" as
// unrelated stock, so every balance/outstanding-borrow lookup below must
// filter by inventory_id, not component name alone, or two labs' numbers
// would bleed into each other.
//
// alter table public.inventory_ledger
//   add column inventory_id bigint references public.inventories(id);
// alter table public.borrows
//   add column inventory_id bigint references public.inventories(id);
// alter table public.reconciliations
//   add column inventory_id bigint references public.inventories(id);
// -- Backfill existing rows into a default inventory first, then:
// alter table public.inventory_ledger  alter column inventory_id set not null;
// alter table public.borrows           alter column inventory_id set not null;
// alter table public.reconciliations   alter column inventory_id set not null;
//
// For each component tallied during the session:
//
//   • No prior ledger history → write a 'baseline' ledger row (delta = counted).
//     No reconciliation row: the first count is ground truth, difference is zero.
//
//   • Prior history exists → compute expected = ledger_balance − outstanding_borrows.
//     Write a reconciliations row {expected, counted, difference = counted − expected}.
//     If difference ≠ 0 → write a 'sort_session' ledger delta so the running
//     balance moves to counted (Decision B: physical count wins).
//
// Discrepancy report: SELECT * FROM reconciliations WHERE session_id = ? AND difference <> 0
//
// CREATE OR REPLACE FUNCTION public.reconcile_session(p_session_id bigint)
// RETURNS void LANGUAGE plpgsql AS $$
// DECLARE
//   v_inventory_id       bigint;
//   v_component          text;
//   v_counted            integer;
//   v_ledger_balance     integer;
//   v_outstanding        integer;
//   v_expected           integer;
//   v_difference         integer;
//   v_has_prior_history  boolean;
// BEGIN
//   -- Guard: session must exist and be open. Also pins the inventory every
//   -- ledger/reconciliation row written below belongs to.
//   SELECT inventory_id INTO v_inventory_id
//   FROM   count_sessions
//   WHERE  id = p_session_id AND status = 'open';
//
//   IF NOT FOUND THEN
//     RAISE EXCEPTION 'session_not_open';
//   END IF;
//
//   FOR v_component, v_counted IN
//     SELECT component, qty
//     FROM   session_tallies
//     WHERE  session_id = p_session_id
//   LOOP
//     -- Has this component ever been sorted or baselined, in this inventory?
//     -- borrow/return entries are excluded: you cannot borrow what was never
//     -- sorted in, so their presence implies a prior baseline exists anyway,
//     -- but excluding them makes the intent explicit.
//     SELECT EXISTS (
//       SELECT 1 FROM inventory_ledger
//       WHERE  component = v_component
//         AND  inventory_id = v_inventory_id
//         AND  reason NOT IN ('borrow', 'return')
//     ) INTO v_has_prior_history;
//
//     IF NOT v_has_prior_history THEN
//       -- First time we've seen this component in this inventory: seed the ledger.
//       INSERT INTO inventory_ledger (component, delta, reason, session_id, inventory_id)
//       VALUES (v_component, v_counted, 'baseline', p_session_id, v_inventory_id);
//
//     ELSE
//       -- Balance from sort-derived entries only (baseline + sort_session +
//       -- adjustment). borrow/return entries are excluded because outstanding
//       -- borrows are subtracted separately below via the borrows table.
//       -- Including them here would double-subtract active borrows.
//       SELECT COALESCE(SUM(delta), 0)
//       INTO   v_ledger_balance
//       FROM   inventory_ledger
//       WHERE  component = v_component
//         AND  inventory_id = v_inventory_id
//         AND  reason NOT IN ('borrow', 'return');
//
//       -- Parts currently borrowed out are not physically present; exclude them.
//       SELECT COALESCE(SUM(qty), 0)
//       INTO   v_outstanding
//       FROM   borrows
//       WHERE  component = v_component
//         AND  inventory_id = v_inventory_id
//         AND  returned_at IS NULL;
//
//       v_expected   := v_ledger_balance - v_outstanding;
//       v_difference := v_counted - v_expected;
//
//       -- Record the reconciliation (zero-difference rows are included so every
//       -- counted component has an audit entry; filter on difference <> 0 for
//       -- the discrepancy report).
//       INSERT INTO reconciliations (session_id, component, expected, counted, difference, inventory_id)
//       VALUES (p_session_id, v_component, v_expected, v_counted, v_difference, v_inventory_id);
//
//       -- Physical count wins: write a correcting delta only when out of balance.
//       IF v_difference <> 0 THEN
//         INSERT INTO inventory_ledger (component, delta, reason, session_id, inventory_id)
//         VALUES (v_component, v_difference, 'sort_session', p_session_id, v_inventory_id);
//       END IF;
//     END IF;
//   END LOOP;
//
//   -- Close the session.
//   UPDATE count_sessions
//   SET    status      = 'reconciled',
//          finished_at = now()
//   WHERE  id = p_session_id;
// END;
// $$;
//
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const sessionId = parseInt(id, 10)

  if (isNaN(sessionId)) {
    return NextResponse.json({ success: false, error: 'invalid_session_id' }, { status: 400 })
  }

  const supabase = getServerClient()

  const { error: rpcError } = await supabase.rpc('reconcile_session', {
    p_session_id: sessionId,
  })

  if (rpcError) {
    if (rpcError.message.includes('session_not_open')) {
      return NextResponse.json({ success: false, error: 'session_not_open' }, { status: 409 })
    }
    console.error('[POST /api/sessions/[id]/finish] reconcile_session failed:', rpcError.message)
    return NextResponse.json({ success: false, error: rpcError.message }, { status: 500 })
  }

  // Return discrepancies so callers can surface them immediately without a
  // second request. Zero-difference rows exist for audit but are excluded here.
  const { data: discrepancies, error: fetchError } = await supabase
    .from('reconciliations')
    .select('component, expected, counted, difference')
    .eq('session_id', sessionId)
    .neq('difference', 0)
    .order('component')

  if (fetchError) {
    // Session is already reconciled at this point; discrepancy fetch is best-effort.
    console.error('[POST /api/sessions/[id]/finish] fetch discrepancies failed:', fetchError.message)
    return NextResponse.json({ success: true, discrepancy_count: 0, discrepancies: [] })
  }

  return NextResponse.json({
    success: true,
    discrepancy_count: discrepancies.length,
    discrepancies,
  })
}
