import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// ─── Migration SQL — run in Supabase SQL editor ───────────────────────────────
//
// -- Drop old table (test data discarded)
// drop table if exists public.components;
//
// create table public.components (
//   id         bigint generated always as identity primary key,
//   name       text        not null unique,
//   weight_g   numeric     not null,
//   created_at timestamptz not null default now()
// );
//
// alter table public.components enable row level security;
//
// create policy "public read components"
//   on public.components for select using (true);
//
// ─────────────────────────────────────────────────────────────────────────────

const ComponentFields = z.object({
  name: z.string().min(1),
  weight_g: z.number().positive(),
})

const CreateSchema = ComponentFields

const UpdateSchema = ComponentFields.extend({
  id: z.number().int().positive(),
})

const DeleteSchema = z.object({
  id: z.number().int().positive(),
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

  const { id, ...fields } = parsed.data
  const { error } = await getServerClient().from('components').update(fields).eq('id', id)
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

  const { error } = await getServerClient().from('components').delete().eq('id', parsed.data.id)
  if (error) {
    console.error('[DELETE /api/components]', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
