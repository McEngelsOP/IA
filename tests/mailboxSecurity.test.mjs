import test from 'node:test'
import assert from 'node:assert/strict'
import { createMailboxHandler } from '../api/mailbox.js'
import { MAILBOX_TYPES } from '../src/shared/data/mailboxTypes.js'

const env = { MAILBOX_WEBHOOK_URL: 'https://script.google.com/macros/s/fixture/exec',
  VITE_SUPABASE_URL: 'https://fixture.supabase.co', VITE_SUPABASE_ANON_KEY: 'fixture' }
const body = { categoria: 'Aplicativo', tipo: MAILBOX_TYPES.Aplicativo.tipos[0][0], carrera: 'ia',
  mensaje: 'Una sugerencia de prueba para mejorar la navegación.', detalles: {} }
async function send({ token = 'fixture-token', valid = true, quota = true, quotaError = null, payload = body } = {}) {
  const calls = []
  const handler = createMailboxHandler({ env, createClient: () => ({
    auth: { getUser: async () => ({ data: { user: valid ? { id: 'fixture' } : null }, error: null }) },
    rpc: async name => { calls.push(name); return { data: quota, error: quotaError } }
  }), fetch: async (_url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, text: async () => 'OK' } } })
  const res = { code: 200, headers: {}, setHeader(k,v) { this.headers[k]=v }, status(code) { this.code=code;return this }, json(data) { this.data=data;return this } }
  await handler({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: payload }, res)
  return { res, calls }
}
test('mailbox blocks unauthenticated, invalid-session and rate-limited messages before delivery', async () => {
  for (const options of [{ token: '' }, { valid: false }]) {
    const { res, calls } = await send(options)
    assert.equal(res.code, 401); assert.equal(calls.length, 0)
  }
  const limited = await send({ quota: false })
  assert.equal(limited.res.code, 429); assert.deepEqual(limited.calls, ['mailbox_take_quota'])
  assert.equal((await send({ quotaError: {} })).res.code, 503)
  assert.equal((await send({ payload: { ...body, mensaje: 'corto' } })).res.code, 400)
})
test('mailbox accepts an authorized message without forwarding identity or tokens', async () => {
  const { res, calls } = await send()
  assert.equal(res.code, 200)
  assert.equal(calls[1].alias, 'Anónimo')
  assert.ok(!JSON.stringify(calls[1]).includes('fixture-token'))
})
