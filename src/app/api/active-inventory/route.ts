import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// ─── Migration SQL — run in Supabase SQL editor ───────────────────────────────
//
// The physical device has no concept of "which inventory" — it only holds a
// bearer token. This singleton row is how the dashboard tells it: whenever
// the operator picks an inventory in the NavBar dropdown, the client pushes
// that choice here, and /api/run-config reads it back to auto-open a count
// session for the right lab without any manual "Start Count Session" click.
//
// create table public.active_inventory (
//   id           bigint primary key default 1,
//   inventory_id bigint references public.inventories(id),
//   updated_at   timestamptz not null default now(),
//   constraint active_inventory_singleton check (id = 1)
// );
//
// alter table public.active_inventory enable row level security;
//
// create policy "public read active_inventory"
//   on public.active_inventory for select using (true);
//
// insert into public.active_inventory (id, inventory_id) values (1, null);
//
// Also needed for the auto-open/auto-close flow (see api/run-config/route.ts
// and lib/ingest/completeRun.ts):
//
// alter table public.count_sessions
//   add column auto_opened boolean not null default false;
//
// ─────────────────────────────────────────────────────────────────────────────

const SetActiveSchema = z.object({
  inventory_id: z.number().int().positive(),
})

export async function GET() {
  const { data, error } = await getServerClient()
    .from('active_inventory')
    .select('inventory_id, updated_at')
    .eq('id', 1)
    .maybeSingle()

  if (error) {
    console.error('[GET /api/active-inventory]', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, inventory_id: data?.inventory_id ?? null })
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = SetActiveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const supabase = getServerClient()

  const { data: inventory, error: inventoryError } = await supabase
    .from('inventories')
    .select('id, archived_at')
    .eq('id', parsed.data.inventory_id)
    .maybeSingle()

  if (inventoryError) {
    console.error('[POST /api/active-inventory] inventory lookup failed:', inventoryError.message)
    return NextResponse.json({ success: false, error: inventoryError.message }, { status: 500 })
  }

  if (!inventory || inventory.archived_at !== null) {
    return NextResponse.json({ success: false, error: 'inventory_archived' }, { status: 409 })
  }

  const { error } = await supabase
    .from('active_inventory')
    .update({ inventory_id: parsed.data.inventory_id, updated_at: new Date().toISOString() })
    .eq('id', 1)

  if (error) {
    console.error('[POST /api/active-inventory]', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
