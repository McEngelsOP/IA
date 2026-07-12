// ============================================================
// Sílabo IA · Edge Function: auth-by-code
// Resuelve el código de alumno a su correo SOLO en el servidor.
// El navegador nunca recibe el correo completo de nadie, así que
// ya no se pueden cosechar correos probando códigos.
//
// Desplegar en: Supabase → Edge Functions → Deploy a new function
// (via Editor) → nombre: auth-by-code → pegar este archivo → Deploy
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })

// ju•••@gmail.com — mismo enmascarado que usaba la app en el navegador
const mask = (email: string) => {
  const [user, domain] = email.split('@')
  return `${user.slice(0, 2)}•••@${domain}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { action, code, password, origin } = await req.json()
    const normalized = String(code ?? '').trim().toUpperCase()
    if (!normalized || !['login', 'recover', 'resend', 'exists'].includes(action)) {
      return json({ ok: false, error: 'bad_request' })
    }

    // Cliente con service role: solo vive en el servidor de Supabase
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: profile, error: lookupError } = await admin
      .from('profiles')
      .select('email')
      .eq('student_code', normalized)
      .maybeSingle()
    if (lookupError) {
      console.error('[auth-by-code:lookup]', lookupError)
      return json({ ok: false, error: 'server_error' })
    }

    // Solo dice si el código ya tiene cuenta (para el registro); nunca el correo
    if (action === 'exists') return json({ ok: true, exists: Boolean(profile) })

    if (!profile) return json({ ok: false, error: 'code_not_found' })
    const email = profile.email

    // Las operaciones de auth se hacen con la anon key, como haría el navegador
    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    )

    if (action === 'login') {
      const { data, error } = await anon.auth.signInWithPassword({
        email,
        password: String(password ?? '')
      })
      if (error) {
        if (error.message === 'Email not confirmed') return json({ ok: false, error: 'email_not_confirmed' })
        if (error.message === 'Invalid login credentials') return json({ ok: false, error: 'invalid_credentials' })
        return json({ ok: false, error: 'auth_error', message: error.message })
      }
      return json({
        ok: true,
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token
        }
      })
    }

    if (action === 'recover') {
      const { error } = await anon.auth.resetPasswordForEmail(email, {
        redirectTo: String(origin ?? '') || undefined
      })
      if (error) return json({ ok: false, error: 'auth_error', message: error.message })
      return json({ ok: true, masked: mask(email) })
    }

    if (action === 'resend') {
      const { error } = await anon.auth.resend({ type: 'signup', email })
      if (error) return json({ ok: false, error: 'auth_error', message: error.message })
      return json({ ok: true, masked: mask(email) })
    }

    return json({ ok: false, error: 'bad_request' })
  } catch (err) {
    console.error('[auth-by-code]', err)
    return json({ ok: false, error: 'bad_request' })
  }
})
