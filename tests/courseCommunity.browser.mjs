import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { CARRERAS } from '../src/institutions/esan/carreras.js'

const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
const screenshots = process.env.WORKSPACE_SCREENSHOTS
if (screenshots) await mkdir(screenshots, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.SETUP_BROWSER, headless: true, args: ['--no-sandbox'] })
const errors = []
const now = Date.now(), user = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {} }
const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url')
const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, session_id: 'community', exp: Math.floor(now / 1000) + 3600, role: 'authenticated' })}.fixture`, refresh_token: 'fixture', expires_at: Math.floor(now / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user }
async function fixture(width, theme) {
  const context = await browser.newContext({ viewport: { width, height: width < 860 ? 844 : 1000 }, reducedMotion: 'reduce' })
  await context.addInitScript(({ session, now, theme }) => {
    localStorage.setItem('sb-setup-fixture-auth-token', JSON.stringify(session))
    localStorage.setItem('sb-setup-fixture-auth-token:web-activity:v1:community', JSON.stringify({ at: now }))
    localStorage.setItem('theme', theme)
  }, { session, now, theme })
  let rating = 3, failDifficulty = false, failProfessors = false, failComments = false, description = '', commentsReads = 0
  const professors = [{ id: 'teacher', name: 'PROFESOR DE PRUEBA', professor_votes: [{ student_id: 'other', vote: 1 }], professor_tags: [{ student_id: user.id, tag: 'aprender' }, { student_id: 'other', tag: 'aprender' }] }]
  const requests = []
  await context.route('https://setup-fixture.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method()
    requests.push({ path, method, params: url.searchParams.toString() })
    let data = [], status = 200
    if (path === '/auth/v1/user') data = user
    else if (path.endsWith('/profiles')) data = [{ id: user.id, carrera: 'ia', alias: 'Engels', institution_id: 'esan', curriculum_version: CARRERAS.ia.version }]
    else if (path.endsWith('/progress')) data = [{ done: ['mat0', 'com0'], plan: [] }]
    else if (path.endsWith('/student_setup')) data = [{ completed_at: new Date(now).toISOString(), preferences: { semester: 2, credits: 20 }, draft: {} }]
    else if (path.endsWith('/rpc/get_course_difficulty_stats')) {
      if (failDifficulty) { status = 503; data = { message: 'fixture difficulty error' } }
      else data = { total_votes: 7, avg_rating: 3.9, user_rating: rating }
    } else if (path.endsWith('/course_difficulty_votes') && method === 'POST') { rating = req.postDataJSON().rating; data = null }
    else if (path.endsWith('/professors')) {
      if (failProfessors) { status = 503; data = { message: 'fixture professors error' } }
      else if (method === 'POST') { professors.push({ id: 'new-teacher', ...req.postDataJSON(), professor_tags: [] }); data = null }
      else data = professors
    } else if (path.endsWith('/professor_votes')) {
      const votes = professors[0].professor_votes.filter(v => v.student_id !== user.id)
      if (method === 'POST') votes.push(req.postDataJSON())
      professors[0].professor_votes = votes; data = null
    } else if (path.endsWith('/professor_tags') && method === 'POST') { professors[0].professor_tags.push(req.postDataJSON()); data = null }
    else if (path.endsWith('/rpc/resource_page')) data = { total: 1, items: [{ id: 'tool', name: 'Herramienta de estudio', url: 'https://example.com', description, is_owner: true, liked: false, hearts: 2 }] }
    else if (path.endsWith('/rpc/edit_resource_description')) { description = req.postDataJSON().resource_description; data = null }
    else if (path.endsWith('/tool_comments')) {
      commentsReads++
      assert.equal(url.searchParams.get('select'), 'id,alias,body,created_at')
      assert.equal(url.searchParams.get('tool_id'), 'eq.tool')
      assert(!url.searchParams.toString().includes('author_id'))
      if (failComments) { status = 503; data = { message: 'fixture comments error' } }
      else {
        const offset = Number(url.searchParams.get('offset') || 0)
        data = Array.from({ length: offset ? 1 : 21 }, (_, i) => ({ id: `comment-${i + offset}`, alias: `Estudiante ${i + offset}`, body: i === 0 && !offset ? 'Sirve para organizar tareas. <script>window.commentExecuted=true</script>' : `Consejo de estudio ${i + offset}`, created_at: '2026-10-25T12:00:00Z' }))
      }
    } else if (path.endsWith('/rpc/focus_active_session')) data = null
    else if (path.endsWith('/rpc/focus_daily_summary')) data = { seconds: 0, completed_count: 0, interrupted_count: 0, sessions: [] }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}/pagina.html`); await page.locator('#home-hero-title').waitFor()
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
  return { page, context, requests, get commentsReads() { return commentsReads }, set failDifficulty(value) { failDifficulty = value }, set failProfessors(value) { failProfessors = value }, set failComments(value) { failComments = value } }
}
async function navigate(page, name, width) {
  if (width <= 860) await page.locator('#trig').click()
  await page.locator(`#nav [data-n="${name}"]`).click()
}
async function capture(page, name) {
  if (!screenshots) return
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${screenshots}/${name}.png` })
}
try {
  for (const [width, theme] of [[1440, 'light'], [390, 'dark'], [320, 'light']]) {
    const f = await fixture(width, theme), { page } = f
    await navigate(page, 'Mi carrera', width)
    await page.getByRole('button', { name: 'Ficha del curso', exact: true }).click()
    await capture(page, `acceso-ficha-${width}-${theme}`)
    const picker = page.getByRole('combobox', { name: 'Curso de la ficha', exact: true })
    await picker.selectOption('calc1')
    await page.getByRole('heading', { name: 'PROFESOR DE PRUEBA', exact: true }).waitFor()
    await page.getByText('3.9 / 5', { exact: true }).waitFor()
    assert.equal(await page.getByRole('radio', { name: '3 de 5 estrellas', exact: true }).isChecked(), true)
    await page.locator('.oc-community').scrollIntoViewIfNeeded()
    await capture(page, `ficha-${width}-${theme}`)
    assert(await page.locator('#page').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
    assert(await page.locator('.oc-modes').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
    if (width === 1440) {
      await page.getByRole('radio', { name: '5 de 5 estrellas', exact: true }).click()
      await page.getByText('Dificultad guardada.', { exact: true }).waitFor()
      await page.waitForFunction(() => !document.querySelector('.oc-stars').disabled)
      assert(await page.getByRole('radio', { name: '5 de 5 estrellas', exact: true }).isChecked())
      const recommendations = page.getByRole('group', { name: 'Recomendaciones de PROFESOR DE PRUEBA', exact: true })
      const positive = recommendations.getByRole('button', { name: /^Lo recomiendo/ })
      await positive.click()
      await page.getByText('Recomendación actualizada.', { exact: true }).waitFor()
      await page.waitForFunction(() => document.querySelector('.oc-professor-votes button')?.getAttribute('aria-pressed') === 'true')
      assert.equal(await positive.locator('span').innerText(), '2')
      await recommendations.getByRole('button', { name: /^No lo recomiendo/ }).click()
      await page.waitForFunction(() => document.querySelector('.oc-professor-votes button:nth-child(2)')?.getAttribute('aria-pressed') === 'true')
      assert.equal(await positive.getAttribute('aria-pressed'), 'false')
      await recommendations.getByRole('button', { name: /^No lo recomiendo/ }).click()
      await page.waitForFunction(() => document.querySelector('.oc-professor-votes button:nth-child(2)')?.getAttribute('aria-pressed') === 'false')
      await page.getByRole('checkbox', { name: /Explica con ejemplos/ }).first().click()
      await page.getByText('Etiquetas actualizadas.', { exact: true }).waitFor()
      await page.getByRole('textbox', { name: 'Añadir profesor', exact: true }).fill('Docente nuevo')
      await page.getByRole('button', { name: 'Añadir profesor', exact: true }).click()
      await page.getByRole('heading', { name: 'DOCENTE NUEVO', exact: true }).waitFor()
      f.failDifficulty = true
      await picker.selectOption('calc2')
      await page.getByText('No se pudo cargar la dificultad. Reintenta.', { exact: true }).waitFor()
      assert(await page.getByRole('heading', { name: 'PROFESOR DE PRUEBA', exact: true }).isVisible())
      assert.equal(await page.getByText('Aún no hay valoraciones para este curso.', { exact: true }).count(), 0)
      f.failDifficulty = false
      await page.getByRole('button', { name: 'Reintentar carga', exact: true }).click()
      await page.getByText('3.9 / 5', { exact: true }).waitFor()
      f.failProfessors = true
      await picker.selectOption('mat0')
      await page.getByText('No se pudieron cargar los profesores. Reintenta.', { exact: true }).waitFor()
      assert(await page.getByText('3.9 / 5', { exact: true }).isVisible())
      f.failProfessors = false
      await page.getByRole('button', { name: 'Reintentar carga', exact: true }).click()
      await page.getByRole('heading', { name: 'PROFESOR DE PRUEBA', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Cerrar ficha del curso', exact: true }).click()
      await picker.selectOption('calc1')
      await page.getByRole('heading', { name: 'PROFESOR DE PRUEBA', exact: true }).waitFor()
    }
    await navigate(page, 'Recursos', width)
    await page.getByRole('link', { name: 'Herramienta de estudio', exact: true }).waitFor()
    assert.equal(f.commentsReads, 0, 'comments only load when requested')
    await page.locator('.rc-comments summary').click()
    await page.getByText(/Sirve para organizar tareas/).waitFor()
    assert.equal(await page.evaluate(() => !!window.commentExecuted), false)
    assert.equal(await page.locator('.rc-comment-list li').count(), 20)
    await page.locator('.rc-comments').scrollIntoViewIfNeeded()
    await capture(page, `recursos-${width}-${theme}`)
    assert(await page.locator('#page').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
    await page.getByRole('button', { name: 'Más comentarios', exact: true }).click()
    await page.getByText('Consejo de estudio 20', { exact: true }).waitFor()
    assert.equal(await page.locator('.rc-comment-list li').count(), 1)
    if (width === 1440) {
      f.failComments = true
      await page.getByRole('button', { name: 'Comentarios anteriores', exact: true }).click()
      await page.getByText('No se pudieron cargar los comentarios. Reintenta.', { exact: true }).waitFor()
      assert(await page.getByRole('link', { name: 'Herramienta de estudio', exact: true }).isVisible())
      f.failComments = false
      await page.getByRole('button', { name: 'Reintentar comentarios', exact: true }).click()
      await page.getByText(/Sirve para organizar tareas/).waitFor()
      await page.getByRole('button', { name: 'Añadir descripción', exact: true }).click()
      await page.getByRole('textbox', { name: 'Descripción del autor', exact: true }).fill('Organiza tus apuntes y tareas.')
      await page.getByRole('button', { name: 'Guardar descripción', exact: true }).click()
      await page.getByText('Organiza tus apuntes y tareas.', { exact: true }).waitFor()
      assert(await page.getByText(/Sirve para organizar tareas/).isVisible())
    }
    await f.context.close()
  }
  assert.deepEqual(errors, [])
  console.log('PASS: course-sheet entry and picker, difficulty votes, professors and tags, independent read failures, historical comments without author IDs, pagination, retry, escaped text, author descriptions, 1440/390/320px and both themes.')
} finally { await browser.close() }
