import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

const StartSchema = z.object({
  operator: z.string().min(1).optional(),
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

  // Only one open session at a time.
  const { data: existing, error: checkError } = await supabase
    .from('count_sessions')
    .select('id')
    .eq('status', 'open')
    .maybeSingle()

  if (checkError) {
    console.error('[POST /api/sessions] open-session check failed:', checkError.message)
    return NextResponse.json({ success: false, error: checkError.message }, { status: 500 })
  }

  if (existing) {
    return NextResponse.json(
      { success: false, error: 'session_already_open', session_id: existing.id },
      { status: 409 },
    )
  }

  const { data, error } = await supabase
    .from('count_sessions')
    .insert({ operator: parsed.data.operator ?? null })
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
