// La respuesta pública no confirma la existencia de un código ni revela correos.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
})

export function createAuthHandler({ admin, auth, log = console.error }) {
  return async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
    if (req.method !== 'POST') return json({ ok: false, error: 'bad_request' }, 405)
    try {
      const { action, code, password, origin } = await req.json()
      const normalized = String(code ?? '').trim()
      if (!/^\d{8}$/.test(normalized) || !['login', 'recover', 'resend', 'exists'].includes(action)) {
        return json({ ok: false, error: 'bad_request' })
      }
      // Compatibilidad con clientes antiguos: sin consultar si existe una cuenta.
      if (action === 'exists') return json({ ok: true, exists: false })
      const { data: profile, error } = await admin.from('profiles')
        .select('email').eq('student_code', normalized).maybeSingle()
      if (error) {
        log('[auth-by-code] lookup failed')
        return json({ ok: false, error: 'server_error' })
      }
      if (action === 'login') {
        if (!profile) return json({ ok: false, error: 'invalid_credentials' })
        const result = await auth.signInWithPassword({ email: profile.email, password: String(password ?? '') })
        if (result.error) {
          return json({ ok: false, error: result.error.message === 'Email not confirmed'
            ? 'email_not_confirmed' : 'invalid_credentials' })
        }
        const session = result.data?.session
        if (!session?.access_token || !session?.refresh_token) return json({ ok: false, error: 'server_error' })
        return json({ ok: true, session: { access_token: session.access_token, refresh_token: session.refresh_token } })
      }
      if (profile) {
        const result = action === 'recover'
          ? await auth.resetPasswordForEmail(profile.email, { redirectTo: typeof origin === 'string' ? origin : undefined })
          : await auth.resend({ type: 'signup', email: profile.email })
        // Registrar solo el fallo operativo, sin correos, tokens ni contraseñas.
        if (result.error) log('[auth-by-code] mail delivery failed')
      }
      return json({ ok: true })
    } catch {
      return json({ ok: false, error: 'bad_request' })
    }
  }
}
