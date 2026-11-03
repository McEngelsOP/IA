import { createClient as makeClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const email = value => typeof value === 'string' && value.length <= 254 && !/[\x00-\x1f\x7f]/.test(value) && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)
const escape = value => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]))
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0')
const required = ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'SUPABASE_SERVICE_ROLE_KEY']

function configuration(env) {
  const values = Object.fromEntries([...required, 'BREVO_SENDER_NAME'].map(name => [name, typeof env[name] === 'string' ? env[name].trim() : '']))
  const missing = required.filter(name => !values[name])
  const invalid = required.filter(name => values[name] && (name === 'BREVO_SENDER_EMAIL'
    ? !email(values[name]) : /[\s\x00-\x1f\x7f]/.test(values[name])))
  if (values.BREVO_SENDER_NAME && (!text(values.BREVO_SENDER_NAME, 160) || /[\x00-\x1f\x7f]/.test(values.BREVO_SENDER_NAME))) invalid.push('BREVO_SENDER_NAME')
  return { values, missing, invalid, ready: missing.length === 0 && invalid.length === 0 }
}

function providerError(status, outcome) {
  if (outcome?.code === 'duplicate_parameter') return 'duplicate'
  if (status === 401) return 'provider_authentication'
  if (status === 403) return 'provider_forbidden'
  if (status === 402) return 'provider_credits'
  if (status === 429) return 'provider_rate_limited'
  if (status >= 500) return 'delivery_unknown'
  if (status === 400 && ['invalid_parameter', 'missing_parameter'].includes(outcome?.code) && /sender/i.test(outcome?.message || '')) return 'provider_sender'
  return 'provider_rejected'
}

export function createCommunicationsHandler({ createClient = makeClient, fetch = globalThis.fetch, env = process.env } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'method' }) }
    const token = /^Bearer ([^\s]+)$/i.exec(req.headers?.authorization || '')?.[1]
    if (!token) return res.status(401).json({ error: 'session' })
    let sending = false
    try {
      const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
      const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
      if (!url || !key) return res.status(503).json({ error: 'configuration' })
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
      const identity = await client.auth.getUser(token)
      if (identity.error || !identity.data?.user) return res.status(401).json({ error: 'session' })
      const access = await client.rpc('is_app_admin')
      if (access.error) return res.status(503).json({ error: 'authorization_unavailable' })
      if (access.data !== true) return res.status(403).json({ error: 'forbidden' })
      const { values, missing, invalid, ready } = configuration(env)
      if (req.method === 'GET') return res.status(200).json({ ready, missing, invalid, sender: ready ? values.BREVO_SENDER_EMAIL : null })
      if (!ready) return res.status(503).json({ error: 'configuration', missing, invalid })
      let body
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body } catch { return res.status(400).json({ error: 'invalid_message' }) }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['userId','expectedEmail','subject','preview','message'].includes(k)) ||
        !uuid.test(body.userId || '') || !email(body.expectedEmail) || !text(body.subject, 160) || /[\r\n]/.test(body.subject) ||
        typeof body.preview !== 'string' || body.preview.length > 200 || body.preview.includes('\0') || !text(body.message, 5000)) return res.status(400).json({ error: 'invalid_message' })
      // The browser never supplies a destination: resolve the current, confirmed Auth email by account ID.
      const admin = createClient(url, values.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      const recipient = await admin.auth.admin.getUserById(body.userId)
      if (recipient.error) return res.status(recipient.error.status === 404 ? 404 : 503).json({ error: 'recipient_unavailable' })
      const user = recipient.data?.user
      if (!user || !email(user.email) || !user.email_confirmed_at || user.is_anonymous || user.deleted_at || new Date(user.banned_until) > new Date()) return res.status(409).json({ error: 'recipient_unavailable' })
      if (user.email.toLowerCase() !== body.expectedEmail.toLowerCase()) return res.status(409).json({ error: 'recipient_changed' })
      const subject = body.subject.trim(), message = body.message.trim(), preview = body.preview.trim()
      const senderName = values.BREVO_SENDER_NAME || 'Lyra AI'
      const digest = createHash('sha256').update(JSON.stringify([identity.data.user.id, user.id, user.email.toLowerCase(), values.BREVO_SENDER_EMAIL.toLowerCase(), senderName, subject, preview, message])).digest('hex')
      const idempotencyKey = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`
      sending = true
      const result = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'Content-Type':'application/json', Accept:'application/json', 'api-key':values.BREVO_API_KEY },
        body: JSON.stringify({ sender: { email: values.BREVO_SENDER_EMAIL, name: senderName }, to: [{ email: user.email }], subject, textContent: message,
          htmlContent: `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;line-height:1.6;color:#25242c;background:#ffffff"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(preview)}</div><div style="max-width:600px;margin:24px auto;padding:16px">${message.split(/\n\s*\n/).map(p=>`<p>${escape(p).replace(/\n/g,'<br>')}</p>`).join('')}</div></body></html>`,
          headers: { idempotencyKey }, tags: ['lyra-individual'] }), signal: AbortSignal.timeout(20000), redirect:'error'
      })
      const outcome = await result.json().catch(() => ({}))
      if (!result.ok) {
        const error = providerError(result.status, outcome)
        return res.status(error === 'duplicate' ? 409 : 502).json({ error })
      }
      if (typeof outcome?.messageId !== 'string' || !outcome.messageId) return res.status(502).json({ error:'delivery_unknown' })
      return res.status(200).json({ accepted:true, messageId:outcome.messageId })
    } catch { return res.status(502).json({ error:sending ? 'delivery_unknown' : 'service_unavailable' }) }
  }
}
export default createCommunicationsHandler()
