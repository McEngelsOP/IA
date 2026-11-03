import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true, executablePath: process.env.SETUP_BROWSER, args: ['--no-sandbox'] })
const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
try {
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion }), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('https://setup-fixture.supabase.co/**', route => route.fulfill({ json: [] }))
    await page.goto(base + '/pagina.html')
    await page.locator('#home-hero-title').waitFor()
    await page.getByRole('button', { name: 'Abrir perfil', exact: true }).click()
    await page.getByRole('menuitem', { name: 'ARCADE', exact: true }).click()
    await page.locator('#argo').click({ timeout: 6000 })
    await page.locator('#gmshelf').waitFor()
    assert.equal(await page.locator('.gm-dot').count(), 7)
    await page.getByRole('button', { name: 'Educativos', exact: true }).click()
    assert.equal(await page.locator('.gm-dot').count(), 4)
    await page.getByRole('button', { name: 'Todos', exact: true }).click()
    for (const [name, selector] of [['Dino Run+', '.dino-canvas'], ['Escuadrón Galáctico', '.gx-canvas']]) {
      await page.getByRole('button', { name: `Ver ${name}`, exact: true }).click()
      await page.getByRole('button', { name: `Jugar ${name}`, exact: true }).click()
      await page.locator(selector).waitFor()
      await page.getByRole('button', { name: 'Volver a juegos', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Salir de Arcade', exact: true }).click()
    await page.locator('#arc').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('#page').evaluate(element => element.inert), false)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('PASS: LYRA Arcade intro, filters, Dino/Galaxia loading, library return, exit and background restoration; normal/reduced motion.')
} finally { await browser.close() }
