import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const endpoints = [
  ['text-to-tasks', { text: 'Entregar el informe del curso mañana' }, 'tasks'],
  ['excel-schedule', { text: 'Lunes de 08:00 a 10:00 Matemáticas' }, 'schedule'],
  ['personal-ai', { action: 'test', provider: 'groq' }, 'key_test'],
]
const bundles = await Promise.all(endpoints.map(async ([name]) => {
  const result = await build({ entryPoints: [`supabase/functions/${name}/index.ts`], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'synthetic-client', setup(b) {
      b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: 'client', namespace: 'synthetic' }))
      b.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({ contents: 'export const createClient=(...args)=>globalThis.fixtureClient(...args)' }))
    } }],
  })
  return result.outputFiles[0].text
}))

test('all extraction and key-test endpoints enforce own keys, quota and cleanup without shared fallback', async () => {
  const previous = { Deno: globalThis.Deno, fetch: globalThis.fetch, fixtureClient: globalThis.fixtureClient }
  try {
    for (const [index, [name, body, resource]] of endpoints.entries()) {
      let handler, owned = [], denied = false, providerCalls = 0
      const calls = []
      const client = {
        auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
        from(table) { const q = { select() { return q }, eq() { return q }, single() { return q }, then(resolve) { return Promise.resolve({ data: table==='profiles'?{ carrera: 'ia', institution_id: 'other' }:[] }).then(resolve) } }; return q },
        rpc: async (rpc, args) => {
          calls.push({ rpc, args })
          return { data: rpc === 'ai_key_read' ? { mode: 'system', access: { sharedEligible: false, personalRequired: true }, providers: owned }
            : rpc === 'advisor_check_moderation' ? { allowed: true }
            : rpc === 'ai_request_begin' ? { allowed: !denied, reason: denied ? 'request_in_progress' : null }
            : { allowed: true } }
        },
      }
      globalThis.fixtureClient = () => client
      globalThis.Deno = { serve: h => { handler = h }, env: { get: key => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', GROQ_API_KEY: 'never-use-shared' })[key] } }
      globalThis.fetch = async (url, init) => {
        providerCalls++
        assert.equal(init.headers.Authorization, 'Bearer synthetic-owned-key')
        // Configuration errors must not fall back to any shared credential.
        return Response.json({ error: { message: 'synthetic rejection' } }, { status: 401 })
      }
      await import('data:text/javascript;base64,' + Buffer.from(bundles[index] + `\n// ${name}`).toString('base64'))
      const request = () => handler(new Request('https://fixture.invalid', { method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify(body) }))
      const missing = await request()
      assert([400, 403].includes(missing.status), `${name} must refuse a missing own key`)
      assert.equal(providerCalls, 0)
      owned = [{ name: 'groq', key: 'synthetic-owned-key' }]; denied = true
      assert.equal((await request()).status, 409)
      assert.equal(providerCalls, 0)
      denied = false
      const result = await request()
      assert([200, 503].includes(result.status))
      assert.equal(providerCalls, 1)
      const begin = calls.filter(c => c.rpc === 'ai_request_begin').at(-1)
      assert.equal(begin.args.p_source, 'personal'); assert.equal(begin.args.p_resource, resource)
      assert.equal(calls.filter(c => c.rpc === 'ai_request_finish').length, 1)
      assert.equal(calls.find(c => c.rpc === 'ai_request_finish').args.p_success, false)
      assert(!calls.some(c => c.rpc === 'advisor_provider_reserve'))
    }
  } finally { Object.assign(globalThis, previous) }
})
