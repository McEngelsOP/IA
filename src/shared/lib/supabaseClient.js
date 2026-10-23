import { getSupabaseClient } from './getSupabaseClient.js'

export const supabase = getSupabaseClient()
if (!supabase) {
  throw new Error('Las variables de entorno VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY son requeridas')
}
