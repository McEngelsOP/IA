import test from 'node:test'
import assert from 'node:assert/strict'
import { askProviders } from '../supabase/functions/study-advisor/providers.mjs'

const secrets = { GEMINI_API_KEY: 'test-google', GROQ_API_KEY: 'test-groq', OPENROUTER_API_KEY: 'test-router' }
const base = { env: name => secrets[name], system: 'Instrucciones académicas', context: 'Cursos y pregunta', history: [{ role: 'user', content: 'Anterior' }, { role: 'assistant', content: 'Respuesta anterior' }] }
const ok = answer => Response.json({ choices: [{ message: { content: answer } }] })

test('Gemini succeeds without contacting backups, filters thoughts, and preserves history', async () => {
  let calls = 0
  const result = await askProviders({ ...base, fetchImpl: async (url, options) => {
    calls++
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com')
    assert.equal(options.headers['x-goog-api-key'], 'test-google')
    const body = JSON.parse(options.body)
    assert.equal(body.contents[1].role, 'model')
    assert.equal(body.systemInstruction.parts[0].text, base.system)
    return Response.json({ candidates: [{ content: { parts: [{ text: 'Privado', thought: true }, { text: 'Consejo' }] } }] })
  } })
  assert.equal(result.answer, 'Consejo')
  assert.equal(result.provider, 'gemini')
  assert.equal(calls, 1)
})

test('quota exhaustion switches to Groq with the same conversation and the correct credential', async () => {
  const calls = [], logs = []
  const result = await askProviders({ ...base, onFailure: info => logs.push(info), fetchImpl: async (url, options) => {
    calls.push(new URL(url).hostname)
    if (calls.length === 1) return new Response(null, { status: 429 })
    assert.equal(options.headers.Authorization, 'Bearer test-groq')
    assert.equal(options.headers['x-goog-api-key'], undefined)
    const body = JSON.parse(options.body)
    assert.deepEqual(body.messages, [{ role: 'system', content: base.system }, ...base.history, { role: 'user', content: base.context }])
    assert.equal(body.max_tokens, 700)
    return ok('Consejo de respaldo')
  } })
  assert.equal(result.provider, 'groq')
  assert.deepEqual(calls, ['generativelanguage.googleapis.com', 'api.groq.com'])
  assert.equal(logs[0].error, 'rate_limited')
  assert(!JSON.stringify(logs).includes('test-google'))
  assert(!JSON.stringify(logs).includes(base.context))
})

test('Groq failure switches to OpenRouter and requests providers that deny data collection', async () => {
  const calls = []
  const result = await askProviders({ ...base, fetchImpl: async (url, options) => {
    calls.push(new URL(url).hostname)
    if (calls.length <= 2) return new Response(null, { status: calls.length === 1 ? 429 : 503 })
    assert.equal(options.headers.Authorization, 'Bearer test-router')
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'openrouter/free')
    assert.deepEqual(body.provider, { data_collection: 'deny' })
    return ok('Último respaldo')
  } })
  assert.equal(result.provider, 'openrouter')
  assert.deepEqual(calls, ['generativelanguage.googleapis.com', 'api.groq.com', 'openrouter.ai'])
})

test('missing keys skip providers; no keys return configuration_missing without a request', async () => {
  let calls = 0
  const fetchImpl = async url => { calls++; assert.equal(new URL(url).hostname, 'openrouter.ai'); return ok('Router') }
  assert.equal((await askProviders({ ...base, env: name => name === 'OPENROUTER_API_KEY' ? 'test-router' : undefined, fetchImpl })).provider, 'openrouter')
  const missing = await askProviders({ ...base, env: () => undefined, fetchImpl })
  assert.deepEqual(missing, { error: 'configuration_missing', status: 503 })
  assert.equal(calls, 1)
})

test('all exhausted providers report quota without an unbounded retry loop', async () => {
  let calls = 0
  const result = await askProviders({ ...base, fetchImpl: async () => { calls++; return new Response(null, { status: calls === 3 ? 402 : 429 }) } })
  assert.deepEqual(result, { error: 'rate_limited', status: 429 })
  assert.equal(calls, 3)
})

test('invalid request formats stop instead of being sent to every provider', async () => {
  let calls = 0
  const result = await askProviders({ ...base, fetchImpl: async () => { calls++; return new Response(null, { status: 400 }) } })
  assert.equal(result.error, 'provider_configuration')
  assert.equal(calls, 1)
})

test('unavailable models, invalid keys, timeouts, empty answers and network failures permit fallback', async () => {
  for (const reason of [404, 401, 403, 'timeout', 'empty', 'network', 'invalid-json']) {
    let calls = 0
    const result = await askProviders({ ...base, fetchImpl: async () => {
      if (++calls > 1) return ok('Respaldo válido')
      if (typeof reason === 'number') return new Response(null, { status: reason })
      if (reason === 'empty') return Response.json({ candidates: [] })
      if (reason === 'invalid-json') return new Response('invalid')
      throw reason === 'timeout' ? new DOMException('timeout', 'TimeoutError') : new TypeError('network')
    } })
    assert.equal(result.provider, 'groq', reason)
    assert.equal(calls, 2)
  }
})

test('total time budget prevents further requests; model overrides remain server settings', async () => {
  let clock = 0, calls = 0
  const result = await askProviders({ ...base, now: () => clock, fetchImpl: async () => {
    calls++; clock = 28000
    return new Response(null, { status: 503 })
  } })
  assert.equal(result.error, 'provider_timeout')
  assert.equal(calls, 1)
  const custom = await askProviders({ ...base, env: name => name === 'GROQ_MODEL' ? 'custom-model' : name === 'GROQ_API_KEY' ? 'test-groq' : undefined, fetchImpl: async (_, options) => {
    assert.equal(JSON.parse(options.body).model, 'custom-model')
    return ok('Modelo elegido')
  } })
  assert.equal(custom.model, 'custom-model')
})
