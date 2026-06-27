import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

const ReturnSchema = z.object({
  borrow_id: z.string().uuid(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = ReturnSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const { borrow_id } = parsed.data
  const supabase = getServerClient()

  const { error } = await supabase.rpc('return_borrow', { p_borrow_id: borrow_id })

  if (error) {
    if (error.message === 'already_returned') {
      return NextResponse.json({ success: false, error: 'already_returned' }, { status: 409 })
    }
    console.error('[POST /api/borrows/return] return_borrow failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
