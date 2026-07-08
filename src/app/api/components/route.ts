import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// ─── Migration SQL — run in Supabase SQL editor ───────────────────────────────
//
// Components become inventory-scoped: the same part name can exist in two
// different labs as two unrelated stock records, so uniqueness moves from
// name alone to (inventory_id, name).
//
// alter table public.components
//   add column inventory_id bigint references public.inventories(id);
//
// -- Backfill existing rows into a default inventory before this step —
// -- see the top-level migration plan for the one-time "Lab 1" backfill.
// alter table public.components
//   alter column inventory_id set not null;
//
// alter table public.components drop constraint components_name_key;
// alter table public.components add constraint components_inventory_id_name_key
//   unique (inventory_id, name);
//
// ─────────────────────────────────────────────────────────────────────────────

const ComponentFields = z.object({
  name: z.string().min(1),
  weight_g: z.number().positive(),
  inventory_id: z.number().int().positive(),
})

const CreateSchema = ComponentFields

const UpdateSchema = ComponentFields.extend({
  id: z.number().int().positive(),
})

const DeleteSchema = z.object({
  id: z.number().int().positive(),
  inventory_id: z.number().int().positive(),
})

function isUniqueViolation(error: { code: string }) {
  return error.code === '23505'
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

  const { error } = await getServerClient().from('components').insert(parsed.data)
  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ success: false, error: 'name_taken' }, { status: 409 })
    }
    console.error('[POST /api/components]', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  // inventory_id is scope, not an editable field — a component can't be
  // reassigned to a different inventory via edit.
  const { id, inventory_id, ...fields } = parsed.data
  const { error } = await getServerClient()
    .from('components')
    .update(fields)
    .eq('id', id)
    .eq('inventory_id', inventory_id)
  if (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ success: false, error: 'name_taken' }, { status: 409 })
    }
    console.error('[PUT /api/components]', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = DeleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const { error } = await getServerClient()
    .from('components')
    .delete()
    .eq('id', parsed.data.id)
    .eq('inventory_id', parsed.data.inventory_id)
  if (error) {
    console.error('[DELETE /api/components]', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
