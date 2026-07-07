import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { REJECT_BIN_IDX } from '@/lib/device/binLayout'

export const CompleteRunBinSchema = z.object({
  name: z.string().min(1),
  weight_g: z.number().positive(),
  bin: z.number().int().min(0),
  count: z.number().int().min(0),
})

export const CompleteRunSchema = z.object({
  run_id: z.string().min(1),
  duration_ms: z.number().int().min(0),
  started_at: z.string().datetime(),
  bins: z.array(CompleteRunBinSchema).min(1),
})

export type CompleteRunInput = z.infer<typeof CompleteRunSchema>

export interface CompleteRunResult {
  status: number
  body: Record<string, unknown>
  summary: string
}

// Shared by /api/ingest (real firmware, token-gated) and /api/runs (browser
// dev/mock, unauthenticated — see useDevice.ts) so both paths run through the
// exact same session-tally/reconciliation logic instead of drifting apart.
export async function persistCompleteRun(
  supabase: SupabaseClient,
  data: CompleteRunInput,
): Promise<CompleteRunResult> {
  // Idempotency: a re-POST of the same run_id must not double-count the tally.
  const { data: existing } = await supabase
    .from('runs')
    .select('run_id')
    .eq('run_id', data.run_id)
    .maybeSingle()

  if (existing) {
    return { status: 200, body: { success: true }, summary: 'duplicate run_id' }
  }

  // Every cycle must belong to an open counting session.
  const { data: session, error: sessionError } = await supabase
    .from('count_sessions')
    .select('id')
    .eq('status', 'open')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sessionError) {
    console.error('[persistCompleteRun] session lookup failed:', sessionError.message)
    return { status: 500, body: { success: false, error: sessionError.message }, summary: 'session lookup failed' }
  }

  if (!session) {
    return { status: 409, body: { success: false, error: 'no_open_session' }, summary: 'no open session' }
  }

  // Record the cycle run for audit history.
  const total = data.bins.reduce((acc, b) => acc + b.count, 0)

  const { error: runError } = await supabase.from('runs').insert({
    run_id:      data.run_id,
    started_at:  data.started_at,
    duration_ms: data.duration_ms,
    total,
    status:      'complete',
    session_id:  session.id,
  })
  if (runError) {
    console.error('[persistCompleteRun] insert run failed:', runError.message)
    return { status: 500, body: { success: false, error: runError.message }, summary: 'insert run failed' }
  }

  // Record individual bin snapshots — bin↔component mapping is cycle-local only.
  const { error: binsError } = await supabase.from('bins').insert(
    data.bins.map(b => ({
      run_id:    data.run_id,
      idx:       b.bin,
      component: b.name,
      count:     b.count,
    })),
  )
  if (binsError) {
    console.error('[persistCompleteRun] insert bins failed:', binsError.message)
    return { status: 500, body: { success: false, error: binsError.message }, summary: 'insert bins failed' }
  }

  // Roll up this cycle's counts by component name into the session tally.
  // Bin 0 is always the reject/unknown chute — kept in bins for audit but never
  // tallied. Bins with count=0 are also skipped. Multiple bins carrying the same
  // name are summed (device may split a component across bins on overflow).
  const tallyMap = new Map<string, number>()
  for (const b of data.bins) {
    if (b.bin !== REJECT_BIN_IDX && b.count > 0) tallyMap.set(b.name, (tallyMap.get(b.name) ?? 0) + b.count)
  }

  if (tallyMap.size > 0) {
    const tallyRows = Array.from(tallyMap, ([component, qty]) => ({ component, qty }))

    // ── session_tallies is where the per-session count lives ─────────────────
    // add_to_session_tally does qty += excluded.qty on conflict, never replacing.
    const { error: tallyError } = await supabase.rpc('add_to_session_tally', {
      p_session_id: session.id,
      p_rows:       tallyRows,
    })
    if (tallyError) {
      console.error('[persistCompleteRun] add_to_session_tally failed:', tallyError.message)
      return { status: 500, body: { success: false, error: tallyError.message }, summary: 'tally failed' }
    }
  }

  // Remove the live entry — this cycle is fully committed.
  const { error: delError } = await supabase
    .from('live_runs')
    .delete()
    .eq('run_id', data.run_id)
  if (delError) {
    // Non-fatal: tally is already written; stale row will clear on next cycle.
    console.error('[persistCompleteRun] delete live_runs failed:', delError.message)
  }

  return { status: 201, body: { success: true }, summary: 'complete' }
}
