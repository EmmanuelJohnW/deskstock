import { existsSync } from 'node:fs'
import path from 'node:path'

// Laptop "hub" mode: DeskStock runs on the laptop (next start) and the sorting
// device can send to it over a hotspot with no internet. Server-side, Supabase
// calls then get a short timeout and a circuit breaker, so a device request is
// never stuck waiting for an internet connection that isn't there.

/** Set in the laptop's .env.local. Never active on Vercel, even if set by mistake. */
export function isHubMode(): boolean {
  return process.env.NEXT_PUBLIC_LOCAL_HUB === 'true' && !process.env.VERCEL
}

/** The laptop hub's own browser (not another device on the hotspot). */
export function isLocalRequest(host: string | null): boolean {
  const name = (host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return name === 'localhost' || name === '127.0.0.1' || name === '::1'
}

export function hubDir(): string {
  return process.env.LOCAL_HUB_DIR ?? path.join(process.cwd(), '.local-hub')
}

const SUPABASE_TIMEOUT_MS = 3000
/** After a network failure, treat Supabase as down for this long. */
const BREAKER_OPEN_MS = 30_000

interface BreakerState {
  openUntil: number
}

const breaker: BreakerState = ((globalThis as { __deskstockBreaker?: BreakerState }).__deskstockBreaker ??= {
  openUntil: 0,
})

/** Test switch: the file .local-hub/force-offline (or HUB_FORCE_OFFLINE=true) makes Supabase unreachable. */
export function isHubForcedOffline(): boolean {
  return process.env.HUB_FORCE_OFFLINE === 'true' || existsSync(path.join(hubDir(), 'force-offline'))
}

export function isSupabaseKnownDown(): boolean {
  return isHubForcedOffline() || Date.now() < breaker.openUntil
}

/** fetch for the server Supabase client in hub mode: fails fast instead of hanging. */
export async function hubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isSupabaseKnownDown()) throw new TypeError('fetch failed (offline)')
  try {
    const timeout = AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return await fetch(input, { ...init, signal })
  } catch (err) {
    breaker.openUntil = Date.now() + BREAKER_OPEN_MS
    throw err
  }
}

/** Test helper. */
export function resetBreakerForTests(): void {
  breaker.openUntil = 0
}
