import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebSessionGuard, WEB_IDLE_MS } from '../src/lib/webSession.js'

const session = id => ({ user: { id: 'student' }, access_token: `x.${btoa(JSON.stringify({ sub: 'student', session_id: id }))}.x` })
function surface() {
  const events = new Map()
  return {
    hidden: false,
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn) },
    removeEventListener(name, fn) { events.get(name)?.delete(fn) },
    fire(name, extra = {}) {
      const event = { isTrusted: true, cancelable: true, preventDefault() { this.prevented = true }, stopImmediatePropagation() { this.stopped = true }, ...extra }
      for (const fn of events.get(name) || []) { fn(event); if (event.stopped) break }
      return event
    },
  }
}
function fixture({ stored = new Map(), logout = async () => ({ error: null }) } = {}) {
  let time = 100000, next = 0, callback, locks = 0, expired = [], calls = []
  const timers = new Map(), win = surface(), doc = surface()
  const storage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) }
  const schedule = (fn, ms) => { const id = ++next; timers.set(id, { fn, at: time + ms }); return id }
  const cancel = id => timers.delete(id)
  const client = { auth: { stopAutoRefresh() {}, signOut(options) { calls.push(options); return logout() }, onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() {} } } } } } }
  const guard = createWebSessionGuard(client, { authKey: 'auth', storage, win, doc, now: () => time, schedule, cancel, onLock: () => locks++, onExpired: reason => expired.push(reason) })
  return { guard, win, doc, stored, calls, get locks() { return locks }, expired,
    jump(ms, run = true) { time += ms; if (run) { for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn() } } },
    event(name, value) { callback(name, value) },
  }
}

test('30-minute deadline locks the view before logout resolves and clears only auth data', async () => {
  const f = fixture(); f.stored.set('auth', 'token'); f.stored.set('unrelated', 'keep')
  assert(f.guard.begin(session('one')))
  f.jump(WEB_IDLE_MS - 1); assert.equal(f.locks, 0)
  f.jump(1); assert.equal(f.locks, 1)
  await f.guard.settled
  assert.deepEqual(f.calls, [{ scope: 'local' }]); assert.equal(f.stored.has('auth'), false)
  assert.equal(f.stored.get('unrelated'), 'keep'); assert.deepEqual(f.expired, ['inactivity'])
})
test('trusted interaction extends activity; token refresh and synthetic events do not', async () => {
  const f = fixture(); f.guard.begin(session('one'))
  f.jump(20 * 60000); f.doc.fire('keydown')
  f.jump(20 * 60000); f.event('TOKEN_REFRESHED', session('one')); f.jump(0)
  f.doc.fire('pointermove', { isTrusted: false })
  f.jump(10 * 60000); await f.guard.settled
  assert.equal(f.locks, 1)
})
test('overnight wake and the first click cannot revive an expired session when timers were suspended', async () => {
  const f = fixture(); f.guard.begin(session('one')); f.jump(7 * 3600000, false)
  const click = f.doc.fire('pointerdown'); assert(click.prevented && click.stopped)
  await f.guard.settled; assert.equal(f.locks, 1)
})
test('reload rejects stale, missing and malformed activity; preserves an active deadline', async () => {
  for (const age of [null, 'bad', WEB_IDLE_MS]) {
    const f = fixture(); f.stored.set('auth', 'token')
    if (age !== null) f.stored.set('auth:web-activity:v1:one', age === 'bad' ? '{' : JSON.stringify({ at: 100000 - age }))
    assert.equal(f.guard.restore(session('one')), false); await f.guard.settled
    assert.equal(f.stored.has('auth'), false)
  }
  const f = fixture(); f.stored.set('auth:web-activity:v1:one', JSON.stringify({ at: 100000 - 25 * 60000 }))
  assert(f.guard.restore(session('one'))); f.jump(5 * 60000); await f.guard.settled; assert.equal(f.locks, 1)
})
test('activity in another tab extends the same session, and logout removes access from both tabs', async () => {
  const stored = new Map(), a = fixture({ stored }), b = fixture({ stored })
  a.guard.begin(session('one')); assert(b.guard.restore(session('one')))
  a.jump(20 * 60000, false); b.jump(20 * 60000, false); a.doc.fire('scroll')
  b.win.fire('storage', { key: 'auth:web-activity:v1:one', newValue: stored.get('auth:web-activity:v1:one') })
  b.jump(11 * 60000); assert.equal(b.locks, 0)
  b.win.fire('storage', { key: 'auth', newValue: null }); await b.guard.settled
  assert.equal(b.locks, 1); assert.deepEqual(b.expired, ['signed-out'])
})
test('offline logout cannot keep private content visible or leave restorable browser credentials', async () => {
  const f = fixture({ logout: () => new Promise(() => {}) }); f.stored.set('auth', 'token')
  f.guard.begin(session('one')); f.jump(WEB_IDLE_MS); assert.equal(f.locks, 1)
  f.jump(1500); await f.guard.settled; assert.equal(f.stored.has('auth'), false)
})
test('back navigation and visibility restoration validate elapsed time before resuming', async () => {
  for (const name of ['pageshow', 'focus', 'visibilitychange']) {
    const f = fixture(); f.guard.begin(session('one')); f.jump(WEB_IDLE_MS, false)
    const event = (name === 'visibilitychange' ? f.doc : f.win).fire(name)
    assert(event.stopped); await f.guard.settled; assert.equal(f.locks, 1)
  }
})
test('a fresh sign-in establishes a new session; an old deadline and clock rollback cannot extend it', async () => {
  const f = fixture(); f.stored.set('auth:web-activity:v1:old', JSON.stringify({ at: 1 }))
  assert(f.guard.begin(session('new'))); f.jump(-1000, false)
  assert.equal(f.guard.check(), false); await f.guard.settled
})
