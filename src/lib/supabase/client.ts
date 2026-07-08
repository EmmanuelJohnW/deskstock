import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Typed as SupabaseClient<any>, not ReturnType<typeof createClient> — the
// latter resolves createClient's generic defaults with no call-site context,
// which (via a `T extends any` quirk) collapses Schema['Functions'][fn]['Args']
// to `never` for every RPC name. That's invisible for zero-arg rpc() calls
// (an omitted optional param never errors) but breaks the moment any rpc()
// call here passes an args object.
let _client: SupabaseClient<any> | null = null

export function getSupabaseClient() {
  if (_client) return _client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  }

  _client = createClient(url, key)
  return _client
}
