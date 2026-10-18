import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')
const root = new URL('../', import.meta.url).pathname
const review = root + '.impeccable/review/'
await fs.mkdir(review, { recursive: true })
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5188 }, configFile: root + 'vite.config.js' })
await server.listen()
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const errors = [], completed = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await context.route('**/juegos/geoduelo/index.html', async route => {
    const html = await fs.readFile(root + 'public/juegos/geoduelo/index.html', 'utf8')
    const hook = `window.__geo={G,Snd,curItem,elapsed,stealLeft,flyTo,setProj,proj:()=>proj};\n`
    await route.fulfill({ body: html.replace('bind();ui();', hook + 'bind();ui();'), contentType: 'text/html' })
  })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:5188/pagina.html')
  await page.locator('#act').click()
  await page.locator('[data-a="arcade"]').click()
  await page.locator('#argo').click()
  assert.equal(await page.locator('.gm-dot').count(), 7)
  await page.locator('[data-filter="educational"]').click()
  assert.equal(await page.locator('.gm-dot').count(), 4)
  await page.getByRole('button', { name: 'Seleccionar Geoduelo', exact: true }).click()
  assert.match(await page.locator('.gm-footer').textContent(), /4 juegos/)
  await page.locator('.gm-art img').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())))
  await page.screenshot({ path: review + 'desktop-gallery.png' })
  await page.locator('#gmstart').click()
  const frame = () => page.frames().find(f => f.url().includes('/juegos/geoduelo/index.html'))
  await page.frameLocator('iframe').locator('#m-menu').waitFor()
  await page.locator('[data-gm="library"]').focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Offline')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Online')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'IFRAME')
  assert.equal(await frame().evaluate(() => document.querySelector('#m-menu').contains(document.activeElement)), true)
  await frame().evaluate(() => document.fonts.ready)
  await page.screenshot({ path: review + 'desktop-setup.png' })
  await page.locator('[data-gm="sound"]').click()
  await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelector('#bSnd').getAttribute('aria-pressed') === 'false')

  for (const mode of ['country', 'cap', 'place', 'who', 'cap4', 'cur', 'lang', 'falso', 'dist', 'tz', 'rank']) {
    const f = frame()
    const category = ['country', 'cap', 'place'].includes(mode) ? 'ubicar' : ['dist', 'tz', 'rank'].includes(mode) ? 'calcular' : 'elegir'
    await f.locator(`[data-cat="${category}"]`).click()
    await f.locator(`[data-mode="${mode}"]`).click()
    await f.locator('label[for="r5"]').click()
    await f.locator('label[for="dD"]').click()
    await f.locator('#n0').fill('Engels <&>')
    await f.locator('#setup button[type="submit"]').click()
    for (let t = 0; t < 10; t++) {
      await f.locator('[data-act="reveal"]').click()
      if (mode === 'country' && t === 0) {
        await f.locator('#bSnd').click()
        await page.waitForFunction(() => document.querySelector('[data-gm="sound"]').getAttribute('aria-pressed') === 'true')
      }
      const it = await f.evaluate(() => {
        const it = __geo.curItem()
        return { ui: it.ui, kind: it.kind, right: it.opts?.findIndex(o => o.ok), correctCount: it.opts?.filter(o => o.ok).length, km: it.km,
          order: it.shown?.map((s, i) => ({ rank: s.rank, i })).sort((a, b) => a.rank - b.rank).map(s => s.i) }
      })
      if (it.ui === 'opts') {
        assert.equal(it.correctCount, 1, `${mode}: exactly one correct answer`)
        await f.locator(`.opt[data-i="${it.right}"]`).click()
      } else if (it.ui === 'slider') {
        await f.locator('#est').fill(String(Math.round(Math.sqrt(it.km / 20000) * 1000)))
        await f.locator('[data-act="est"]').click()
      } else if (it.ui === 'order') {
        for (const i of it.order) await f.locator(`.chip[data-i="${i}"]`).click()
        await f.locator('[data-act="rank"]').click()
      } else {
        await f.evaluate(() => { const it = __geo.curItem(); __geo.flyTo(it.ctr[0], it.ctr[1], 1, 0); __geo.setProj() })
        await f.locator('#globe').click({ position: await f.evaluate(() => { const p = __geo.proj()(__geo.curItem().ctr); return { x: p[0], y: p[1] } }) })
        // Some geometrical centroids sit in the sea. Passing also exercises unsuccessful turns.
        if (await f.evaluate(() => __geo.G.phase === 'playing')) await f.locator('#bPass').click()
      }
      if (mode === 'who' && t === 0) { await page.waitForTimeout(150); await page.screenshot({ path: review + 'desktop-result.png' }) }
      assert.equal(await f.evaluate(() => __geo.G.phase), 'result', `${mode}: turn result`)
      await f.locator('[data-act="next"]').click()
    }
    assert.equal(await f.evaluate(() => __geo.G.phase), 'final')
    assert.equal(await f.evaluate(() => __geo.G.log.length), 10)
    assert.equal(await f.locator('#final-sheet .nm').first().textContent(), 'Engels <&>')
    completed.push(mode)
    console.log('Passed mode:', mode)
    await f.locator('[data-act="menu"]').click()
  }

  // Pause the rival's six-second steal when the tab loses visibility.
  let f = frame()
  await f.locator('[data-cat="elegir"]').click()
  await f.locator('[data-mode="who"]').click()
  await f.locator('#setup button[type="submit"]').click()
  await f.locator('[data-act="reveal"]').click()
  await f.locator('#bPause').click()
  const paused = await f.evaluate(() => __geo.elapsed())
  await page.waitForTimeout(140)
  assert.equal(await f.evaluate(() => __geo.elapsed()), paused)
  await f.locator('#bResume').click()
  const wrong = await f.evaluate(() => __geo.curItem().opts.findIndex(o => !o.ok))
  await f.locator(`.opt[data-i="${wrong}"]`).click()
  assert.equal(await f.evaluate(() => __geo.G.phase), 'steal')
  await f.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  assert.equal(await f.evaluate(() => __geo.G.phase), 'paused')
  await f.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
  await f.locator('#bResume').click()
  await f.locator('#bPass').click()
  await page.locator('[data-gm="library"]').click()
  assert.equal(await page.locator('iframe').count(), 0)

  for (const [name, width, height] of [['mobile', 390, 844], ['small-mobile', 360, 640], ['landscape', 844, 390]]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(200)
    await page.locator('.gm-art img').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())))
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.screenshot({ path: review + name + '-gallery.png' })
    await page.locator('#gmstart').click()
    await page.frameLocator('iframe').locator('#m-menu').waitFor()
    f = frame()
    await f.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: review + name + '-setup.png' })
    assert.equal(await f.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' horizontal overflow')
    await f.locator('[data-cat="elegir"]').click()
    await f.locator('[data-mode="who"]').click()
    await f.locator('#setup button[type="submit"]').click()
    await f.locator('[data-act="reveal"]').click()
    await page.waitForTimeout(100)
    assert.deepEqual(await page.locator('#arc').evaluate(el => [el.scrollLeft, el.scrollTop]), [0, 0], name + ' Arcade origin stays fixed')
    await page.screenshot({ path: review + name + '-playing.png' })
    assert.equal(await f.locator('.opt').count(), 4)
    const boxes = await f.evaluate(() => ['#globe', '#optbox', '#dock'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width } }))
    assert.ok(boxes[1].top >= boxes[0].bottom - 1, name + ' question does not cover globe')
    await f.locator('.opt').first().click()
    await page.locator('[data-gm="library"]').click()
  }
  await page.locator('[data-gm="close"]').click()
  assert.equal(await page.locator('iframe').count(), 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: completed, responsive: ['1440×900', '390×844', '360×640', '844×390'], errors }, null, 2))
} finally { await browser.close(); await server.close() }
