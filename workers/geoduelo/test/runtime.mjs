import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
const origin = 'http://127.0.0.1:5173'
export const ids = Array.from({ length: 8 }, (_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
export const capitals = JSON.parse(await fs.readFile(new URL('../src/capitals.json', import.meta.url)))
const script = (await build({ entryPoints: [new URL('../src/index.js', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })).outputFiles[0].text
export async function runtime() {
  const results = [], authCalls = [], writes = { fail: false }
  const mf = new Miniflare({ modules: true, script, compatibilityDate: '2025-10-01',
    durableObjects: { LOBBY: { className: 'Lobby', useSQLite: true }, ROOM: { className: 'Room', useSQLite: true } },
    bindings: { ALLOWED_ORIGINS: origin, SUPABASE_URL: 'https://supabase.test', SUPABASE_ANON_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'secret', TICKET_SECRET: 'x'.repeat(64), MAX_PLAYERS: '50' },
    outboundService: async request => {
      const url = new URL(request.url)
      if (url.pathname === '/auth/v1/user') {
        const id = request.headers.get('authorization')?.slice(7); authCalls.push(id)
        return Response.json(ids.includes(id) ? { id } : { error: 'invalid' }, { status: ids.includes(id) ? 200 : 401 })
      }
      if (url.pathname === '/rest/v1/profiles') return Response.json([{ alias: `Explorador ${ids.indexOf(request.headers.get('authorization')?.slice(7)) + 1}` }])
      if (url.pathname === '/rest/v1/rpc/record_geoduelo_online') {
        assert.equal(request.headers.get('authorization'), 'Bearer secret')
        if (writes.fail) return Response.json({ error: 'offline' }, { status: 503 })
        results.push(await request.json()); return Response.json(null)
      }
      throw new Error(`Unexpected outbound ${url}`)
    }
  })
  await mf.ready
  async function session(seat, action, extra = {}) {
    const r = await mf.dispatchFetch('https://game.test/session', { method: 'POST', headers: { origin, authorization: `Bearer ${ids[seat]}`, 'content-type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
    return { status: r.status, ...await r.json() }
  }
  async function socket(data) {
    const r = await mf.dispatchFetch(`https://game.test/ws/${data.room}?ticket=${data.ticket}`, { headers: { origin, Upgrade: 'websocket' } })
    assert.equal(r.status, 101)
    const ws = r.webSocket; ws.accept(); const messages = []; const waiters = []
    ws.addEventListener('message', e => { const s = JSON.parse(e.data); messages.push(s); for (const w of [...waiters]) if (w.fn(s)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(s) } })
    const wait = fn => messages.findLast(fn) ? Promise.resolve(messages.findLast(fn)) : new Promise((resolve, reject) => { const w = { fn, resolve, timer: setTimeout(() => reject(new Error(`Timeout; ${JSON.stringify(messages.at(-1))}`)), 40000) }; waiters.push(w) })
    return { ws, messages, wait, send: m => ws.send(JSON.stringify(m)) }
  }
  return { mf, session, socket, results, authCalls, writes }
}

