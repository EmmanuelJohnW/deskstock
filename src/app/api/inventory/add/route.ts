import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerClient } from '@/lib/supabase/server'

// Records new stock (a restock, a delivery, or a manual correction upward) as
// a single 'adjustment' ledger entry.
//
// This deliberately does NOT treat incoming units as returned loans. Returns
// are recorded only through the Return button on the Borrows page
// (/api/borrows/return), so "borrowed and never returned" reliably means
// "used up" — which is what the stockout forecast counts as usage.
//
// (Previously this called the add_stock() database function, which matched
// incoming units against open loans oldest-first and closed them. That
// function still exists in Supabase but is no longer called.)

const AddStockSchema = z.object({
  component: z.string().min(1),
  qty: z.number().int().min(1),
  inventory_id: z.number().int().positive(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = AddStockSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 422 })
  }

  const { component, qty, inventory_id } = parsed.data
  const { error } = await getServerClient()
    .from('inventory_ledger')
    .insert({ component, delta: qty, reason: 'adjustment', inventory_id })

  if (error) {
    console.error('[POST /api/inventory/add] insert failed:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
