import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { createAuthHandler } from './handler.mjs'

const options = { auth: { persistSession: false, autoRefreshToken: false } }
Deno.serve(req => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options)
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, options)
  return createAuthHandler({ admin, auth: client.auth })(req)
})
