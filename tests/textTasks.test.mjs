import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTaskSuggestions } from '../src/core/calendar/taskExtraction.mjs'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'
const runtime = await transform(await readFile(new URL('../supabase/functions/study-advisor/providers.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' })
const { configuredProviders, generateAdvisorAnswer } = await import('data:text/javascript;base64,' + Buffer.from(runtime.code).toString('base64'))

test('missing dates stay empty, unrecognized courses are discarded and duplicates collapse', () => {
  const tasks = parseTaskSuggestions(JSON.stringify({ tasks: [{ title: ' Informe ', due_date: null, course_id: 'inventado' }, { title: 'Informe', due_date: null }] }))
  assert.deepEqual(tasks, [{ title: 'Informe', due_date: '', course_id: '', selected: true }])
  assert.throws(() => parseTaskSuggestions('{"tasks":[{"title":"Informe","due_date":"2026-02-30"}]}'))
})
const providers = ['gemini', 'groq', 'openrouter'].map(name => ({ name, key: 'fixture', model: name === 'gemini' ? 'gemini-3.5-flash-lite' : 'fixture-model' }))
const run = fetch => generateAdvisorAnswer({ providers, system: 'Extract', context: 'Task', history: [], fetch, reserve: async () => ({ allowed: true }), report: async () => {} })
for (const status of [401, 402, 403, 404, 410, 429, 500]) test(`runtime fallback on HTTP ${status}`, async () => {
  let calls = 0
  const result = await run(async () => ++calls === 1 ? Response.json({ error: { code: status } }, { status }) : Response.json({ choices: [{ message: { content: 'OK' } }] }))
  assert.equal(result.source, 'groq'); assert.equal(calls, 2)
})
test('explicit safety refusals stop fallback', async () => {
  let calls = 0
  const result = await run(async () => { calls++; return Response.json({ promptFeedback: { blockReason: 'SAFETY' } }) })
  assert.equal(result.error, 'content_blocked'); assert.equal(calls, 1)
})
test('invalid structured response uses next provider', async () => {
  let calls = 0
  const result = await generateAdvisorAnswer({ providers, system: '', context: '', history: [], reserve: async () => ({ allowed: true }), report: async () => {}, validateAnswer: answer => { try { parseTaskSuggestions(answer); return true } catch { return false } }, fetch: async () => ++calls === 1 ? Response.json({ candidates: [{ content: { parts: [{ text: 'Not JSON' }] } }] }) : Response.json({ choices: [{ message: { content: '{"tasks":[]}' } }] }) })
  assert.equal(result.source, 'groq'); assert.equal(calls, 2)
})
test('removed/unconfigured providers are skipped and paid OpenRouter models stay disabled', () => {
  const env = { GROQ_API_KEY: 'fixture', OPENROUTER_API_KEY: 'fixture', OPENROUTER_MODEL: 'paid/model' }
  assert.deepEqual(configuredProviders(name => env[name]).map(p => p.name), ['groq'])
})
