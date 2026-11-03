import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true, executablePath: process.env.SETUP_BROWSER, args: ['--no-sandbox'] })
const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  async function scenario(kind) {
    await page.goto(base + '/tests/fixtures/empty.html')
    await page.evaluate(async kind => {
      const { mountAcademicWorkspace } = await import('/src/app/AcademicWorkspace.jsx')
      const courses = [{ id: 'a', n: 'Base', r: [], cr: 4, c: 1 }, { id: 'b', n: 'Último curso', r: ['a'], cr: 4, c: 2 }]
      const done = kind === 'completed' ? ['a', 'b'] : kind === 'blocked' ? [] : ['a']
      if (kind === 'blocked') courses[0].requirementNote = 'Equivalencia por verificar'
      mountAcademicWorkspace(document.getElementById('root'), { tool: 'Brújula IA', client: {}, user: { id: 'planning' }, career: { cursos: courses }, preferences: { semester: 10 }, statuses: kind === 'enrolled' ? { b: { status: 'matriculado' } } : {}, done, plan: [], onClose() {}, onPlan() {}, onBusy() {} })
    }, kind)
    await page.locator('.bj-st').filter({ hasText: 'Planificar' }).click()
  }
  await scenario('enrolled')
  await page.getByText('No quedan cursos por proyectar si apruebas los cursos en curso.', { exact: true }).waitFor({ timeout: 3000 })
  assert.equal(await page.getByRole('button', { name: 'Sumar próximo semestre a mi plan' }).count(), 0)
  await scenario('completed')
  await page.getByText('Ya completaste los cursos de esta malla.', { exact: true }).waitFor()
  await scenario('blocked')
  await page.getByText('2 cursos no se pudieron ubicar con los requisitos actuales.', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: final-semester projection distinguishes courses in progress, completed curriculum and blocked requirements.')
} finally { await browser.close() }
