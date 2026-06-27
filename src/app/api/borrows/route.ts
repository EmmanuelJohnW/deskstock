import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

const BorrowSchema = z.object({
  component: z.string().min(1),
  qty: z.number().int().min(1),
  borrower: z.string().min(1),
  due_at: z.string().datetime(),
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

  const { component, qty, borrower, due_at } = parsed.data
  const supabase = getServerClient()

  const { data, error } = await supabase.rpc('borrow_component', {
    p_component: component,
    p_qty: qty,
    p_borrower: borrower,
    p_due_at: due_at,
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
