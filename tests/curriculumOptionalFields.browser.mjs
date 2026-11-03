import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const browser = await chromium.launch({ headless: true, executablePath: process.env.SETUP_BROWSER, args: ['--no-sandbox'] })
const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
await mkdir('/tmp/lyra-curriculum-optional', { recursive: true })
try {
  for (const [width, theme] of [[1440, 'light'], [390, 'light'], [390, 'dark']]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(base + '/tests/fixtures/empty.html')
    await page.evaluate(async theme => {
      document.documentElement.dataset.theme = theme
      await import('/src/app/portal.css')
      const { mountCurriculumImport } = await import('/src/features/institutions/CurriculumImport.jsx')
      window.calls = []
      mountCurriculumImport(document.getElementById('root'), {
        profile: { university_name: 'Universidad Prueba', external_career: 'Medicina' },
        client: { rpc: async (name, args) => { window.calls.push({ name, args }); return { data: 'draft' } }, functions: { invoke: async () => ({ data: { status: 'completed' } }) } },
        onSaved: () => { window.saved = true },
      })
    }, theme)
    const source = 'Curso;Créditos;Ciclo\nMatemáticas;4;1\nBiología;3,5;2\n' + Array.from({ length: 78 }, (_, i) => `Curso de prueba ${i+3};3;${i%12+1}`).join('\n')
    await page.getByLabel('Texto de la malla', { exact: true }).fill(source)
    await page.getByRole('button', { name: 'Convertir y extraer datos' }).click()
    const list = page.getByRole('region', { name: 'Lista de cursos para verificar' })
    assert.equal(await page.locator('.ci-course').count(), 80)
    assert.equal(await page.locator('.ci-course[open]').count(), 0)
    assert(await list.evaluate(el => el.scrollHeight > el.clientHeight && el.clientHeight <= 540))
    await list.focus()
    await list.press('End')
    await page.waitForFunction(() => document.querySelector('.ci-rows').scrollTop > 0)
    await list.evaluate(el => { el.scrollTop = 0 })
    await page.locator('.ci-course>summary').first().click()
    assert.equal(await page.getByLabel('Código 1', { exact: true }).inputValue(), '')
    assert.equal(await page.getByLabel('Requisitos 1', { exact: true }).inputValue(), '')
    await page.getByLabel('Revisé los datos', { exact: false }).check()
    const save = page.getByRole('button', { name: 'Guardar malla y configurar mi avance' })
    assert(await save.isEnabled())
    await page.getByLabel('Ciclo 1', { exact: true }).fill('')
    await page.getByLabel('Revisé los datos', { exact: false }).check()
    await page.locator('.ci-review-list>summary').click()
    assert(await save.isDisabled())
    await page.getByRole('status').filter({ hasText: 'Fila 1: completa el ciclo' }).waitFor()
    await page.getByRole('button', { name: 'Ir al curso por corregir' }).click()
    assert(await page.getByLabel('Ciclo 1', { exact: true }).evaluate(el => el === document.activeElement))
    await page.getByLabel('Ciclo 1', { exact: true }).fill('1')
    await page.getByLabel('Créditos 1', { exact: true }).fill('')
    await page.getByLabel('Revisé los datos', { exact: false }).check()
    assert(await save.isDisabled())
    await page.getByRole('status').filter({ hasText: 'Fila 1: completa los créditos' }).waitFor()
    await page.getByLabel('Créditos 1', { exact: true }).fill('4')
    await page.getByLabel('Revisé los datos', { exact: false }).check()
    await page.locator('.ci-review-list>summary').click()
    assert.equal(await page.locator('.ci-review-list[open]').count(), 0)
    await page.locator('.ci-review-list>summary').click()
    assert.equal(await page.getByLabel('Ciclo 1', { exact: true }).inputValue(), '1')
    await page.locator('.ci-course>summary').first().click()
    await page.getByRole('button', { name: 'Añadir curso o taller' }).click()
    assert(await page.getByLabel('Nombre 81', { exact: true }).evaluate(el => el === document.activeElement))
    assert.equal(await page.locator('.ci-course[open]').count(), 1)
    await page.getByRole('button', { name: 'Quitar fila 81', exact: true }).click()
    assert.equal(await page.locator('.ci-course').count(), 80)
    assert(await save.isDisabled())
    await page.getByLabel('Revisé los datos', { exact: false }).check()
    await list.evaluate(el => { el.scrollTop = 0 })
    await page.locator('.ci-review-list').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/lyra-curriculum-optional/import-${width}-${theme}.png`, fullPage: true })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await save.click()
    await page.waitForFunction(() => window.saved)
    const [call] = await page.evaluate(() => window.calls)
    assert.equal(call.name, 'submit_curriculum_v2')
    assert(call.args.p_rows.every(r => r.code === '' && r.cycle !== '' && r.requirements === ''))
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('PASS: desktop/mobile require cycles, preserve optional fields and edits, and scroll/collapse an 80-course review with keyboard support')
} finally { await browser.close() }
