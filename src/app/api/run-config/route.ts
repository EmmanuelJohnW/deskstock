import 'server-only'
import { after, NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerClient } from '@/lib/supabase/server'
import { logDeviceCall } from '@/lib/deviceLog'
import { isHubMode } from '@/lib/localHub/net'
import { getSelectedInventory, hubMemory, loadCatalog, saveCatalog, type CatalogRow } from '@/lib/localHub/store'
import { isNetworkError } from '@/lib/offline/network'

// Response shape: [{name: string, weight_g: number}]
// Postgres numeric returns as string over PostgREST — parseFloat before sending
// so the firmware always receives a JSON number, not a string.
//
// The device has no concept of "which inventory" — it just holds a bearer
// token and calls this endpoint at the start of every run. Rather than
// requiring the operator to manually open a count session from the dashboard
// first, this reads active_inventory (set automatically whenever the NavBar
// dropdown selection changes — see api/active-inventory/route.ts) and
// auto-opens a session for it if none is open yet, marking it auto_opened so
// persistCompleteRun knows to auto-reconcile it when the run finishes (see
// lib/ingest/completeRun.ts) — one press of the physical button, no manual
// session management. A session opened manually from the dashboard
// (auto_opened = false) still behaves as before: it can batch multiple runs
// and is only closed by an explicit "Finish Count".
//
// On the laptop hub (docs/local-hub.md) every successful answer is cached, and
// when there's no internet the cached component list for the dashboard's
// selected inventory is served instead (no session is opened; the run is
// counted into that inventory when it's uploaded later).

type CatalogResult =
  | { ok: true; inventoryId: number; rows: CatalogRow[] }
  | { ok: false; status: number; error: string; summary: string; isNetwork: boolean }

function failure(status: number, error: { message: string } | string, summary: string): CatalogResult {
  const message = typeof error === 'string' ? error : error.message
  return { ok: false, status, error: message, summary, isNetwork: typeof error !== 'string' && isNetworkError(error) }
}

async function resolveCatalog(supabase: SupabaseClient): Promise<CatalogResult> {
  const { data: existing, error: sessionError } = await supabase
    .from('count_sessions')
    .select('inventory_id')
    .eq('status', 'open')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (sessionError) return failure(500, sessionError, 'session lookup failed')

  let inventoryId: number
  if (existing) {
    inventoryId = existing.inventory_id
  } else {
    const { data: active, error: activeError } = await supabase
      .from('active_inventory')
      .select('inventory_id')
      .eq('id', 1)
      .maybeSingle()
    if (activeError) return failure(500, activeError, 'active_inventory lookup failed')
    if (!active?.inventory_id) return failure(409, 'no_active_inventory', 'no active inventory selected')

    const { error: openError } = await supabase
      .from('count_sessions')
      .insert({ inventory_id: active.inventory_id, auto_opened: true })
    if (openError) return failure(500, openError, 'auto-open session failed')
    inventoryId = active.inventory_id
  }

  const { data, error } = await supabase
    .from('components')
    .select('name, weight_g')
    .eq('inventory_id', inventoryId)
    .order('name', { ascending: true })
  if (error) return failure(500, error, 'lookup failed')

  const rows = (data ?? []).map(r => ({
    name: r.name as string,
    weight_g: parseFloat(r.weight_g as unknown as string),
  }))
  return { ok: true, inventoryId, rows }
}

export async function GET(req: NextRequest) {
  const supabase = getServerClient({ fastFail: true })
  const log = (statusCode: number, summary: string) =>
    after(() => logDeviceCall(supabase, { method: 'GET', endpoint: '/api/run-config', statusCode, summary }))

  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token || token !== process.env.INGEST_TOKEN) {
    log(401, 'unauthorized')
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  if (isHubMode()) hubMemory().deviceSeenAt = new Date().toISOString()
  const result = await resolveCatalog(supabase)

  if (result.ok) {
    if (isHubMode()) {
      hubMemory().runInventoryId = result.inventoryId
      await saveCatalog(result.inventoryId, result.rows).catch(err =>
        console.error('[GET /api/run-config] could not cache the catalog:', err),
      )
    }
    log(200, `catalog x${result.rows.length}`)
    return NextResponse.json(result.rows)
  }

  if (isHubMode() && result.isNetwork) {
    const cached = await loadCatalog(await getSelectedInventory())
    if (cached) {
      hubMemory().runInventoryId = cached.inventoryId
      return NextResponse.json(cached.rows)
    }
    return NextResponse.json({ success: false, error: 'no_cached_catalog' }, { status: 503 })
  }

  console.error('[GET /api/run-config]', result.summary, result.error)
  log(result.status, result.summary)
  return NextResponse.json({ success: false, error: result.error }, { status: result.status })
}
