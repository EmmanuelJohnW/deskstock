import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { hubFetch, isHubMode } from '@/lib/localHub/net'

interface ServerClientOptions {
  /**
   * Laptop hub only: fail within seconds when there's no internet, so the
   * sorting device is never kept waiting. Only for device-facing routes —
   * uploads use normal timeouts so a slow link can't cut a save in half.
   */
  fastFail?: boolean
}

export function getServerClient({ fastFail = false }: ServerClientOptions = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  }

  // New client per request — server-only, never cached across requests
  return createClient(url, key, {
    auth: { persistSession: false },
    // On the laptop hub, fail fast when there's no internet instead of hanging.
    ...(fastFail && isHubMode() ? { global: { fetch: hubFetch } } : {}),
  })
}
