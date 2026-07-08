import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// ─── Migration SQL — run in Supabase SQL editor ───────────────────────────────
//
// Each inventory is an isolated set of components/borrows/ledger/sessions —
// selecting one is how a single dashboard/device deployment moves between
// labs or facilities without their stock lists mixing.
//
// create table public.inventories (
//   id          bigint generated always as identity primary key,
//   name        text        not null unique,
//   archived_at timestamptz,
//   created_at  timestamptz not null default now()
// );
//
// alter table public.inventories enable row level security;
//
// create policy "public read inventories"
//   on public.inventories for select using (true);
//
// ─────────────────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  name: z.string().min(1),
})

const ArchiveSchema = z.object({
  id: z.number().int().positive(),
})

function isUniqueViolation(error: { code: string }) {
  return error.code === '23505'
}

export async function GET() {
  const { data, error } = await getServerClient()
    .from('inventories')
    .select('id, name, created_at')
    .is('archived_at', null)
    .order('name', { ascending: true })

  if (error) {
    console.error('[GET /api/inventories]', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, inventories: data })
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const { data, error } = await getServerClient()
    .from('inventories')
    .insert({ name: parsed.data.name })
    .select('id, name, created_at')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ success: false, error: 'name_taken' }, { status: 409 })
    }
    console.error('[POST /api/inventories]', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, inventory: data }, { status: 201 })
}

// Archive rather than delete — history in count_sessions/borrows/inventory_ledger
// that reference this inventory must stay intact and queryable from Reports.
export async function PATCH(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = ArchiveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const { error } = await getServerClient()
    .from('inventories')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', parsed.data.id)

  if (error) {
    console.error('[PATCH /api/inventories]', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
