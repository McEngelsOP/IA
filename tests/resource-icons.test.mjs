import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resourceIconSources } from '../src/features/resources/resourceModel.js'

test('all nine existing resources have a real packaged PNG', () => {
  for (const host of ['grok.com','claude.ai','gemini.google.com','theastudy.com','auth.tidbcloud.com','gamma.app','canva.com','supabase.com','notebooklm.google']) {
    const [src] = resourceIconSources('https://' + host)
    assert.ok(existsSync(new URL(src)), host)
    assert.equal(readFileSync(new URL(src)).subarray(1, 4).toString(), 'PNG')
  }
})

test('www and provider aliases resolve to the correct brand', () => {
  assert.equal(resourceIconSources('www.canva.com/design/abc')[0], resourceIconSources('canva.com')[0])
  assert.equal(resourceIconSources('auth.tidbcloud.com')[0], resourceIconSources('tidbcloud.com')[0])
  assert.equal(resourceIconSources('notebooklm.google.com')[0], resourceIconSources('notebooklm.google')[0])
  assert.equal(resourceIconSources('notebook.google')[0], resourceIconSources('notebooklm.google')[0])
})

test('unknown sites use remote discovery without leaking link parameters', () => {
  const sources = resourceIconSources('https://example.org/private/page?token=secret#private')
  assert.equal(sources.length, 3)
  assert.ok(sources.every(s => !s.includes('secret') && !s.includes('/private')))
  assert.ok(sources[0].startsWith('https://www.google.com/s2/'))
})

test('invalid, credential-bearing and local URLs cannot trigger discovery', () => {
  for (const input of ['', 'javascript:alert(1)', 'http://a:b@example.com', 'http://localhost', 'http://127.0.0.1', 'bad url']) assert.deepEqual(resourceIconSources(input), [])
})
