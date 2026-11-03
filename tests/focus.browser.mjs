import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true, executablePath: process.env.SETUP_BROWSER, args: ['--no-sandbox'] })
const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' }), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('https://setup-fixture.supabase.co/**', route => route.fulfill({ json: [] }))
    await page.goto(base + '/pagina.html')
    async function navigate(name) {
      if (width <= 860) await page.locator('#trig').click()
      await page.locator(`#nav [data-n="${name}"]`).click()
    }
    await navigate('Mod Focus')
    await page.getByRole('button', { name: 'Pomodoro · 25 min', exact: true }).click()
    await page.clock.install()
    await page.getByRole('button', { name: 'Comenzar', exact: true }).click()
    const timer = page.getByRole('timer', { name: 'Tiempo restante', exact: true })
    await page.clock.fastForward(60_000)
    assert.equal(await timer.innerText(), '24:00')
    await page.getByRole('button', { name: 'Pausa', exact: true }).click()
    await page.clock.fastForward(5 * 60_000)
    assert.equal(await timer.innerText(), '24:00', 'Paused time never counts as study')
    await page.getByRole('button', { name: 'Reanudar', exact: true }).click()
    await navigate('Inicio')
    await page.clock.fastForward(60_000)
    await navigate('Mod Focus')
    assert.equal(await timer.innerText(), '23:00', 'The timer keeps running across sections')
    await page.getByRole('button', { name: 'Terminar antes', exact: true }).click()
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
    await page.clock.fastForward(23 * 60_000)
    await page.getByText('Sesión terminada · 25:00', { exact: true }).waitFor()
    await page.getByText('Inicia sesión para guardar tu próximo momento de estudio.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Volver a Mod Focus', exact: true }).click()
    await page.getByRole('button', { name: 'Comenzar', exact: true }).waitFor()
    assert(await page.locator('#page').evaluate(element => element.scrollWidth <= element.clientWidth + 1))
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('PASS: guest Focus start, pause, resume, navigation, cancel interruption, completion and return; desktop/mobile.')
} finally { await browser.close() }
