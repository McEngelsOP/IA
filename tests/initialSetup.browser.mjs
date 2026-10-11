import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { CARRERAS } from '../src/data/carreras.js'
const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
const out = '/tmp/ia-setup-review'; await mkdir(out, { recursive: true })
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', app_metadata: { provider: 'email' }, user_metadata: { carrera: 'ia' }, created_at: new Date().toISOString() }
const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url')
const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' }) + '.fixture'
const session = { access_token: token, refresh_token: 'fixture', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user }
let record = null, progress = null, statuses = [], calendar = [], failDraft = false, failComplete = false, lastPayload = null, saves = 0
const browser = await chromium.launch({ headless: true, executablePath: process.env.SETUP_BROWSER, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
await context.addInitScript(({session}) => { localStorage.setItem('sb-setup-fixture-auth-token', JSON.stringify(session)) }, {session})
await context.route('https://setup-fixture.supabase.co/**', async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname; let data = [], status = 200
  if (path === '/auth/v1/user') data = user
  else if (path.endsWith('/profiles')) data = [{ carrera: 'ia', created_at: user.created_at }]
  else if (path.endsWith('/progress')) data = progress ? [progress] : []
  else if (path.endsWith('/course_status')) data = statuses
  else if (path.endsWith('/calendar_events')) data = calendar
  else if (path.endsWith('/student_setup')) data = record ? [record] : []
  else if (path.includes('/rpc/')) {
    const value = req.postDataJSON().value
    if (path.endsWith('save_student_setup_draft')) { if (failDraft) { status = 500; data = { message: 'fixture failure' } } else { record = { ...record, draft: value, preferences: record?.preferences || {}, completed_at: null }; saves++; data = null } }
    else if (path.endsWith('complete_student_setup')) {
      if (failComplete) { status = 500; data = { message: 'fixture failure' } }
      else { lastPayload = value; record = { completed_at: new Date().toISOString(), preferences: value, draft: {} }; progress = { done: value.done, plan: value.enrolled }; statuses = [...value.done.map(course_id => ({ course_id, status: 'aprobado' })), ...value.enrolled.map(course_id => ({ course_id, status: 'matriculado' }))]; calendar = value.events; data = null }
    } else if (path.endsWith('save_student_setup_preferences')) { record.preferences = value; data = null }
    else if (path.endsWith('focus_daily_summary')) data = { seconds: 0, completed_count: 0, interrupted_count: 0 }
    else data = null
  }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
})
const page = await context.newPage(), errors = []
page.on('pageerror', e => errors.push(e.message))
const dialog = page.getByRole('dialog'), title = page.locator('#setup-title')
const next = () => dialog.getByRole('button', { name: 'Continuar', exact: true }).click()
const screen = async name => { await page.waitForFunction(() => !document.querySelector('.setup-primary')?.disabled); if (!process.env.SETUP_SKIP_SCREENSHOTS) await dialog.screenshot({ path: `${out}/${name}.png` }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false) }
await page.goto(base + '/pagina.html'); await title.waitFor(); await screen('semester-light-1366')
assert.equal(await page.locator('#page').evaluate(n => n.inert), true)
await dialog.getByRole('button', { name: '3', exact: true }).click()
failDraft = true; await next(); await dialog.getByRole('alert').waitFor(); assert.match(await title.textContent(), /semestre/)
failDraft = false; await next(); await page.getByText('Ciclo 1 de 3', { exact: true }).waitFor()
const firstCourse = CARRERAS.ia.cursos.find(c => c.c === 1)
await dialog.getByRole('button', { name: new RegExp(firstCourse.n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
await screen('pending-light-1366')
await dialog.getByRole('button', { name: 'Siguiente ciclo', exact: true }).last().click()
await page.getByText('Ciclo 2 de 3', { exact: true }).waitFor()
await dialog.getByRole('button', { name: 'Ciclo anterior', exact: true }).click()
await page.getByText('Ciclo 1 de 3', { exact: true }).waitFor()
assert.equal(await dialog.locator('.setup-course[aria-pressed=true]').count(), 1)
await dialog.getByRole('button', { name: 'Siguiente ciclo', exact: true }).last().click()
await page.getByText('Ciclo 2 de 3', { exact: true }).waitFor()
await dialog.getByRole('button', { name: 'Siguiente ciclo', exact: true }).last().click()
await page.getByText('Ciclo 3 de 3', { exact: true }).waitFor()
await dialog.getByRole('button', { name: 'Continuar', exact: true }).click(); await page.getByText('Los cursos adelantados los puedes llenar manualmente.').waitFor()
await dialog.getByRole('button', { name: 'Continuar después' }).click(); await dialog.waitFor({ state: 'detached' })
await page.reload(); await page.getByText('Los cursos adelantados los puedes llenar manualmente.').waitFor()
assert.equal(record.draft.step, 2); assert.ok(saves >= 5)
await next(); await next(); await dialog.getByRole('button', { name: '14', exact: true }).click(); await next()
await dialog.getByRole('button', { name: /Sí, tengo un archivo/ }).click()
const currentCourse = CARRERAS.ia.cursos.find(c => c.c === 3)
const csv = `dia,hora de inicio,hora de fin,curso,aula\nLunes,08:00,10:00,${currentCourse.n},A-101\nMiércoles,08:00,10:00,${currentCourse.n},A-101`
await dialog.locator('input[type=file]').setInputFiles({ name: 'horario.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
await dialog.locator('table').waitFor(); await dialog.getByLabel('Inicio del ciclo').fill('2026-10-14'); await dialog.getByLabel('Último día de clases').fill('2026-12-01')
if (process.env.SETUP_XLSX_FIXTURE) { await dialog.locator('input[type=file]').setInputFiles(process.env.SETUP_XLSX_FIXTURE); await page.getByText('ia-horario-fixture.xlsx', { exact: true }).waitFor(); await page.waitForFunction(() => document.querySelectorAll('.setup-table tbody tr').length === 2); assert.match(await dialog.locator('.setup-table').textContent(), /08:00 – 10:00/) }
await screen('schedule-light-1366'); await next(); await screen('space-light-1366')
await dialog.getByRole('button', { name: /Nube/ }).click(); await dialog.getByRole('button', { name: 'Oscuro', exact: true }).click(); await next(); await screen('summary-light-1366')
failComplete = true; await dialog.getByRole('button', { name: 'Confirmar y entrar' }).click(); await dialog.getByRole('alert').waitFor(); assert.equal(progress, null)
failComplete = false; await dialog.getByRole('button', { name: 'Confirmar y entrar' }).click(); await dialog.waitFor({ state: 'detached' }); await page.getByRole('tab', { name: 'Gráficos' }).waitFor()
assert.ok(lastPayload.done.length > 0); assert.ok(!lastPayload.done.includes(firstCourse.id)); assert.equal(lastPayload.events.length, 2)
assert.equal(lastPayload.events[0].date, '2026-10-19'); assert.equal(lastPayload.credits, 14)
assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
await page.reload(); await page.getByRole('tab', { name: 'Gráficos' }).waitFor(); assert.equal(await dialog.count(), 0)
await page.getByRole('button', { name: 'Abrir perfil' }).click(); await page.getByRole('menuitem', { name: 'Preferencias de estudio' }).click(); await title.waitFor()
await next(); await next(); await screen('space-dark-1366'); await next(); await dialog.getByRole('button', { name: 'Guardar preferencias' }).click(); await dialog.waitFor({ state: 'detached' })
await page.getByRole('button', { name: 'Mod Focus', exact: true }).click(); await page.locator('.k-settings').waitFor()
assert.equal(await page.locator('[data-a=kpt][data-v=rabbit]').getAttribute('aria-pressed'), 'true')
assert.equal(await page.locator('#kcs option').count(), lastPayload.enrolled.length + 1)
await page.getByRole('button', { name: 'Herramientas', exact: true }).click()
await page.getByRole('button', { name: 'Brújula IA', exact: true }).click()
await page.getByRole('tab', { name: /Tu carga habitual/ }).waitFor()
assert.match(await page.getByRole('tab', { name: /Tu carga habitual/ }).textContent(), /14/)
assert.deepEqual(errors, [])
console.log(JSON.stringify({ status: 'passed', draftSaves: saves, currentCourses: lastPayload.enrolled.length, importedClasses: calendar.length, screenshots: out, consoleErrors: errors }))
await browser.close()
