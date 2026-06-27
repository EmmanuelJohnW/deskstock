import 'server-only'
import { createClient } from '@supabase/supabase-js'

export function getServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  }

  // New client per request — server-only, never cached across requests
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}
