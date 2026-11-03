import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreferenceSync } from '../src/shared/lib/preferenceSync.js'

function fixture() {
  let remote = { theme: 'light' }, hold = false
  const reads = [], cache = new Map(), statuses = []
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
      const values = structuredClone(remote)
      if (hold) await new Promise(resolve => reads.push(resolve))
      return { data: { values } }
    } }) }) }),
    auth: { getUser: async () => ({ data: { user: { id: 'student' } } }) },
    rpc: async (_, { p_patch }) => ({ data: { values: remote = { ...remote, ...p_patch } } })
  }
  const sync = createPreferenceSync({ client, onStatus: value => statuses.push(value), storage: {
    getItem: key => cache.get(key), setItem: (key, value) => cache.set(key, value)
  } })
  return { sync, reads, statuses, cache, pause() { hold = true }, update(value) { remote = value } }
}

test('a delayed refresh cannot revert a preference already saved by this device', async () => {
  const f = fixture()
  try {
    await f.sync.start('student')
    f.pause()
    const refresh = f.sync.refresh()
    f.sync.set('theme', 'dark')
    await f.sync.flush()
    f.reads[0]()
    await refresh
    assert.equal(f.sync.get('theme'), 'dark')
    assert.equal(JSON.parse(f.cache.get('lyra-preferences:student')).values.theme, 'dark')
  } finally { f.sync.stop() }
})

test('out-of-order refreshes keep the latest account snapshot', async () => {
  const f = fixture()
  try {
    await f.sync.start('student')
    f.pause()
    const older = f.sync.refresh()
    f.update({ theme: 'dark', homeOrder: ['stats'] })
    const newer = f.sync.refresh()
    f.reads[1]()
    await newer
    f.reads[0]()
    await older
    assert.equal(f.sync.get('theme'), 'dark')
    assert.deepEqual(f.sync.get('homeOrder'), ['stats'])
  } finally { f.sync.stop() }
})

test('responses after sign-out cannot restore preferences or write an account cache', async () => {
  const f = fixture()
  await f.sync.start('student')
  f.pause()
  const refresh = f.sync.refresh(), before = [...f.cache.entries()]
  f.sync.stop()
  f.reads[0]()
  await refresh
  assert.equal(f.sync.get('theme'), undefined)
  assert.deepEqual([...f.cache.entries()], before)
})
