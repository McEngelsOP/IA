import { createClient } from '@supabase/supabase-js'

let client = null
export function getSupabaseClient() {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  client = createClient(url, key, {
    global: { fetch: (url, options = {}) => fetch(url, {
      ...options, signal: options.signal || (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20000) : undefined)
    }) }
  })
  return client
}
