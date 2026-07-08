import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// ─── Migration SQL — run in Supabase SQL editor ───────────────────────────────
//
// A session belongs to exactly one inventory — everything counted during it
// (bins, session_tallies, ledger entries) rolls up under that inventory. The
// "only one open session at a time" rule below stays GLOBAL, not per-inventory:
// there's one physical sorter, so it can only be mid-run for one lab at a time.
//
// alter table public.count_sessions
//   add column inventory_id bigint references public.inventories(id);
//
// -- Backfill existing rows into a default inventory first, then:
// alter table public.count_sessions
//   alter column inventory_id set not null;
//
// ─────────────────────────────────────────────────────────────────────────────

const StartSchema = z.object({
  operator: z.string().min(1).optional(),
  inventory_id: z.number().int().positive(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = StartSchema.safeParse(body)
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
    console.error('[POST /api/sessions] inventory lookup failed:', inventoryError.message)
    return NextResponse.json({ success: false, error: inventoryError.message }, { status: 500 })
  }

  if (!inventory || inventory.archived_at !== null) {
    return NextResponse.json({ success: false, error: 'inventory_archived' }, { status: 409 })
  }

  // Only one open session at a time, across all inventories — one physical
  // sorter can only be mid-run for one lab at once.
  const { data: existing, error: checkError } = await supabase
    .from('count_sessions')
    .select('id, inventory_id')
    .eq('status', 'open')
    .maybeSingle()

  if (checkError) {
    console.error('[POST /api/sessions] open-session check failed:', checkError.message)
    return NextResponse.json({ success: false, error: checkError.message }, { status: 500 })
  }

  if (existing) {
    return NextResponse.json(
      {
        success: false,
        error: 'session_already_open',
        session_id: existing.id,
        inventory_id: existing.inventory_id,
      },
      { status: 409 },
    )
  }

  const { data, error } = await supabase
    .from('count_sessions')
    .insert({ operator: parsed.data.operator ?? null, inventory_id: parsed.data.inventory_id })
    .select('id, started_at')
    .single()

  if (error) {
    console.error('[POST /api/sessions] insert failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    { success: true, session_id: data.id, started_at: data.started_at },
    { status: 201 },
  )
}
