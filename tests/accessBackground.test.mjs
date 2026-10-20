import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { initializeAccessBackground } from '../src/features/access/accessBackground.js'

function fixture({ reduced = false, connection, hidden = false, rejectPlay = false } = {}, initialize = initializeAccessBackground) {
  const frames = [], listeners = new Map(), elements = new Map()
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      dataset: { src: './login-landscape.mp4' }, attrs: {}, plays: 0, pauses: 0, loads: 0,
      setAttribute(key, value) { this.attrs[key] = value },
      removeAttribute(key) { delete this[key] }, toggleAttribute() {},
      addEventListener(event, callback) { listeners.set(id + ':' + event, callback) },
      load() { this.loads++ }, pause() { this.pauses++ },
      play() { this.plays++; return rejectPlay ? Promise.reject(new Error('Autoplay denied')) : Promise.resolve() },
    })
    return elements.get(id)
  }
  const document = { hidden, body: { dataset: {} }, getElementById: element,
    addEventListener(event, callback) { listeners.set('document:' + event, callback) } }
  const reduce = { matches: reduced, addEventListener(event, callback) { listeners.set('reduce:' + event, callback) } }
  initialize({ document, reduce, connection: connection ?? null, requestAnimationFrame: callback => frames.push(callback) })
  return { document, reduce, video: element('landscape'), button: element('motionToggle'),
    frame: () => frames.shift()?.(), fire: key => listeners.get(key)?.() }
}

test('video starts after two frames without waiting for a media readiness event', () => {
  const f = fixture()
  assert.equal(f.video.src, undefined)
  f.frame(); assert.equal(f.video.src, undefined)
  f.frame(); assert.equal(f.video.src, './login-landscape.mp4')
  assert.equal(f.video.loads, 1); assert.equal(f.video.plays, 1)
})

test('reduced motion keeps the poster and starts media only after the preference changes', () => {
  const f = fixture({ reduced: true })
  f.frame(); f.frame(); assert.equal(f.video.src, undefined); assert.equal(f.button.disabled, true)
  f.reduce.matches = false; f.fire('reduce:change')
  assert.equal(f.video.loads, 1); assert.equal(f.button.disabled, false)
})

for (const connection of [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) {
  test('slow connection or data saver leaves a static landscape until explicitly resumed ' + JSON.stringify(connection), () => {
    const f = fixture({ connection }); f.frame(); f.frame()
    assert.equal(f.video.src, undefined); assert.equal(f.button.attrs['aria-pressed'], 'true')
    f.fire('motionToggle:click'); assert.equal(f.video.loads, 1)
  })
}

test('hidden tabs defer video and pause it while leaving media controls consistent', () => {
  const f = fixture({ hidden: true }); f.frame(); f.frame(); assert.equal(f.video.src, undefined)
  f.document.hidden = false; f.fire('document:visibilitychange'); assert.equal(f.video.loads, 1)
  f.document.hidden = true; f.fire('document:visibilitychange'); assert.equal(f.document.body.dataset.paused, 'true')
})

test('video failure returns to the poster without retrying or affecting the form', () => {
  const f = fixture(); f.frame(); f.frame(); f.fire('landscape:error')
  assert.equal(f.video.src, undefined); assert.equal(f.button.disabled, true)
  f.document.hidden = true; f.fire('document:visibilitychange')
  f.document.hidden = false; f.fire('document:visibilitychange')
  assert.equal(f.button.disabled, true); assert.equal(f.video.src, undefined)
})

test('autoplay rejection becomes a paused state that the user can resume', async () => {
  const f = fixture({ rejectPlay: true }); f.frame(); f.frame(); await Promise.resolve()
  assert.equal(f.document.body.dataset.paused, 'true')
  assert.equal(f.button.attrs['aria-pressed'], 'true')
})


// Exercise the production transform; unbundled source alone missed this regression.
test('production-minified background initializes without blocking access', async () => {
  const { transform } = await import('esbuild')
  const source = await readFile(new URL('../src/features/access/accessBackground.js', import.meta.url), 'utf8')
  const { code } = await transform(source, { target: 'es2019', format: 'esm', minify: true })
  const module = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  const f = fixture({}, module.initializeAccessBackground)
  f.frame(); f.frame()
  assert.equal(f.video.src, './login-landscape.mp4')
})
