import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthHandler } from '../supabase/functions/auth-by-code/handler.mjs'

function fixture(profile, options = {}) {
  const calls = []
  const admin = { from() { calls.push('lookup'); return { select() { return this }, eq() { return this },
    async maybeSingle() { return { data: profile, error: null } } } } }
  const auth = {
    async signInWithPassword() { calls.push('login'); return options.login || { data: {}, error: { message: 'Invalid login credentials' } } },
    async resetPasswordForEmail() { calls.push('recover'); return { error: options.mailError || null } },
    async resend() { calls.push('resend'); return { error: options.mailError || null } }
  }
  const handler = createAuthHandler({ admin, auth, log: () => {} })
  const request = async (action, extra = {}) => {
    const response = await handler(new Request('https://fixture.invalid', {
      method: 'POST', body: JSON.stringify({ action, code: '25101823', ...extra })
    }))
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return response.json()
  }
  return { request, calls }
}

test('account lookup reveals neither existence nor email, including legacy clients', async () => {
  for (const profile of [null, { email: 'student@example.invalid' }]) {
    const f = fixture(profile)
    assert.deepEqual(await f.request('exists'), { ok: true, exists: false })
    assert.deepEqual(f.calls, [])
  }
})
test('recovery and resend have the same response for existing and missing accounts', async () => {
  for (const action of ['recover', 'resend']) {
    const present = fixture({ email: 'student@example.invalid' })
    const absent = fixture(null)
    assert.deepEqual(await present.request(action), await absent.request(action))
    assert.deepEqual(present.calls, ['lookup', action])
    assert.deepEqual(absent.calls, ['lookup'])
    assert.deepEqual(await fixture({ email: 'student@example.invalid' }, { mailError: { message: 'private detail' } }).request(action), { ok: true })
  }
})
test('login uses a generic denial, while valid credentials still return session tokens', async () => {
  assert.deepEqual(await fixture(null).request('login'), await fixture({ email: 'student@example.invalid' }).request('login'))
  const session = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', user: { email: 'private@example.invalid' } }
  assert.deepEqual(await fixture({ email: 'student@example.invalid' }, { login: { data: { session } } }).request('login'), {
    ok: true, session: { access_token: 'fixture-access', refresh_token: 'fixture-refresh' }
  })
})
