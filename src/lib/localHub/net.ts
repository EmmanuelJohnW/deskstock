import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
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
  return process.env.HUB_FORCE_OFFLINE === 'true' || existsSync(forceOfflineFile())
}

function forceOfflineFile(): string {
  return path.join(hubDir(), 'force-offline')
}

/** "Work offline" on the laptop: device-facing routes stop using the internet. */
export async function setHubForcedOffline(on: boolean): Promise<void> {
  if (on) {
    await mkdir(hubDir(), { recursive: true })
    await writeFile(forceOfflineFile(), 'on\n', 'utf8')
  } else {
    await rm(forceOfflineFile(), { force: true })
  }
}

export function isSupabaseKnownDown(): boolean {
  return isHubForcedOffline() || Date.now() < breaker.openUntil
}

/**
 * An immediate "offline" answer. Returned rather than thrown on purpose:
 * supabase-js retries thrown network errors with 1s/2s/4s back-off, which
 * would outlast the device's 2.5s request timeout. 504 isn't retried.
 */
function offlineResponse(): Response {
  return new Response(JSON.stringify({ message: 'TypeError: fetch failed (offline)', code: 'OFFLINE' }), {
    status: 504,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** fetch for the device-facing Supabase client in hub mode: answers within seconds, never hangs. */
export async function hubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isSupabaseKnownDown()) return offlineResponse()
  try {
    const timeout = AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return await fetch(input, { ...init, signal })
  } catch {
    breaker.openUntil = Date.now() + BREAKER_OPEN_MS
    return offlineResponse()
  }
}

/** Test helper. */
export function resetBreakerForTests(): void {
  breaker.openUntil = 0
}
