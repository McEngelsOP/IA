const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = process.env.REVIEW_OUTPUT || '/tmp/ia-deberes-review'; await mkdir(out, { recursive: true })
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', app_metadata: { provider: 'email' }, user_metadata: { carrera: 'ia' }, created_at: '2026-01-01T00:00:00Z' }
const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url')
const session = { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' }) + '.fixture', refresh_token: 'fixture', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user }
let statuses = [{ course_id: 'calc1', status: 'matriculado' }, { course_id: 'com1', status: 'matriculado' }], rating = null, teachers = []
let resources = [{ id: '22222222-2222-4222-8222-222222222222', name: 'Notion', url: 'https://notion.so/', description: 'Organiza apuntes y tareas.', is_owner: false, hearts: 2, liked: false }]
let failPublish = false
const browser = await chromium.launch({ headless: true, executablePath: process.env.REVIEW_BROWSER || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })
await context.addInitScript(session => { localStorage.setItem('sb-setup-fixture-auth-token', JSON.stringify(session)); localStorage.setItem('sb-setup-fixture-auth-token:web-activity:v1:' + session.user.id, JSON.stringify({ at: Date.now() })) }, session)
await context.route('https://setup-fixture.supabase.co/**', async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, payload = req.method() === 'POST' || req.method() === 'PATCH' ? req.postDataJSON() : null
  let data = [], status = 200
  if (path.endsWith('/user')) data = user
  else if (path.endsWith('/profiles')) data = [{ carrera: 'ia', created_at: user.created_at }]
  else if (path.endsWith('/progress')) data = [{ done: ['com0', 'mat0', 'prog1'], plan: [] }]
  else if (path.endsWith('/grades')) data = [{ course_id: 'prog1', grade: 15 }]
  else if (path.endsWith('/student_setup')) data = [{ draft: {}, preferences: { semester: 2, companion: 'cat', credits: 16 }, completed_at: user.created_at }]
  else if (path.endsWith('/course_status')) { if (payload) { statuses = statuses.filter(s => s.course_id !== payload.course_id).concat(payload) }; data = statuses }
  else if (path.endsWith('/professors')) { if (payload) { teachers.push({ id: crypto.randomUUID(), name: payload.name, professor_tags: [] }) }; data = teachers }
  else if (path.endsWith('/professor_tags')) { if (payload) teachers.find(t => t.id === payload.professor_id).professor_tags.push(payload); data = [] }
  else if (path.endsWith('/course_difficulty_votes')) { rating = payload.rating }
  else if (path.endsWith('/rpc/get_course_difficulty_stats')) data = { user_rating: rating, total_votes: rating ? 1 : 0, avg_rating: rating || 0 }
  else if (path.endsWith('/rpc/resource_page')) { const items = resources.filter(r => (r.name + r.url).toLowerCase().includes(payload.search_text.toLowerCase())); data = { items, total: items.length } }
  else if (path.endsWith('/rpc/publish_resource')) {
    if (failPublish) { status = 400; data = { message: 'RESOURCE_DUPLICATE' } }
    else { const id = crypto.randomUUID(); resources.unshift({ id, name: payload.resource_name, url: payload.resource_url, description: payload.resource_description, is_owner: true, hearts: 0, liked: false }); data = id }
  } else if (path.endsWith('/rpc/edit_resource_description')) { resources.find(r => r.id === payload.resource_id).description = payload.resource_description; data = null }
  else if (path.endsWith('/rpc/toggle_resource_heart')) { const item = resources.find(r => r.id === payload.resource_id); item.liked = !item.liked; item.hearts += item.liked ? 1 : -1; data = { liked: item.liked, hearts: item.hearts } }
  else if (path.endsWith('/rpc/focus_daily_summary')) data = { seconds: 0, completed_count: 0, interrupted_count: 0 }
  else if (path.endsWith('/rpc/my_game_score') || path.endsWith('/rpc/focus_active_session')) data = null
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
})
await context.route('**/favicon.ico', route => route.abort())
const page = await context.newPage(), errors = []; const capture = options => process.env.REVIEW_SKIP_SCREENSHOTS ? Promise.resolve() : page.screenshot(options); page.on('pageerror', e => errors.push(e.stack))
await page.goto((process.env.REVIEW_BASE_URL || 'http://127.0.0.1:5181') + '/pagina.html')
await page.locator('.h-enrollment-list').waitFor(); assert.equal(await page.locator('.h-enrollment-list li').count(), 2)
await capture({ path: out + '/inicio-desktop.png' })
await page.getByRole('button', { name: 'Actualizar matrícula', exact: true }).click()
await page.getByRole('button', { name: 'Ficha del curso', exact: true }).click()
await page.locator('[data-course="fia"]').click()
await page.getByLabel('Estado académico').selectOption('matriculado'); await page.getByRole('button', { name: 'Guardar estado', exact: true }).click()
await page.getByText('Estado guardado. Inicio y Mod Focus usan esta matrícula.').waitFor()
await page.getByLabel('4 de 5 estrellas').click(); await page.getByText('Dificultad guardada.', { exact: true }).waitFor()
await page.getByLabel('Añadir profesor', { exact: true }).fill('Docente de ejemplo'); await page.getByRole('button', { name: 'Añadir profesor', exact: true }).click()
await page.getByText('DOCENTE DE EJEMPLO', { exact: true }).waitFor()
await page.getByLabel('Esta es fija').click(); await page.getByText('Etiquetas actualizadas.', { exact: true }).waitFor()
await capture({ path: out + '/ficha-desktop.png' })
await page.locator('#nav [data-n="Inicio"]').click(); await page.locator('.h-enrollment-list').waitFor(); assert.equal(await page.locator('.h-enrollment-list li').count(), 3)
await page.locator('#nav [data-n="Mod Focus"]').click(); await page.locator('#kcs').waitFor()
const names = await page.locator('#kcs option').allTextContents(); assert.equal(names.length, 4); assert.deepEqual(names.slice(1), [...names.slice(1)].sort((a,b) => a.localeCompare(b,'es')))
await page.locator('#nav [data-n="Herramientas"]').click(); await page.locator('#nav [data-k="Recursos"]').click(); await page.getByText('Organiza apuntes y tareas.', { exact: true }).waitFor()
assert.equal(await page.getByRole('button', { name: 'Editar comentario' }).count(), 0)
await page.getByRole('button', { name: 'Dar corazón a Notion', exact: true }).click(); await page.getByRole('button', { name: 'Quitar corazón a Notion', exact: true }).waitFor()
await page.getByRole('button', { name: 'Quitar corazón a Notion', exact: true }).click(); await page.getByRole('button', { name: 'Dar corazón a Notion', exact: true }).waitFor()
await page.getByLabel('Nombre', { exact: true }).fill('Herramienta nueva'); await page.getByLabel('Enlace', { exact: true }).fill('example.com'); await page.getByLabel('¿Para qué sirve?').fill('Ayuda a organizar trabajos de la universidad.')
failPublish = true; await page.getByRole('button', { name: 'Publicar', exact: true }).click(); await page.getByText('Este enlace ya está publicado.', { exact: false }).waitFor(); assert.equal(await page.getByLabel('Nombre', { exact: true }).inputValue(), 'Herramienta nueva')
failPublish = false; await page.getByRole('button', { name: 'Publicar', exact: true }).click(); await page.getByText('Recurso publicado.', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Editar comentario' }).click()
await page.getByLabel('Comentario del autor').fill('Comentario corregido por su autor.'); await page.getByRole('button', { name: 'Guardar comentario', exact: true }).click(); await page.getByText('Comentario actualizado.', { exact: true }).waitFor()
await capture({ path: out + '/recursos-desktop.png' })
await page.getByLabel('¿Para qué sirve?').fill('palabra '.repeat(26)); assert.equal(await page.getByRole('button', { name: 'Publicar', exact: true }).isEnabled(), false)
await page.setViewportSize({ width: 390, height: 844 }); await capture({ path: out + '/recursos-mobile.png' }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
await page.setViewportSize({ width: 1366, height: 768 }); await page.getByRole('button', { name: 'Abrir perfil', exact: true }).click(); await page.locator('#menu [data-a="arcade"]').click(); await page.locator('#argo').click(); await page.locator('#gmshelf').waitFor()
assert.equal(await page.getByLabel('Seleccionar Snake', { exact: true }).count(), 0)
await page.getByLabel('Seleccionar Dino Run+', { exact: true }).click(); await page.getByLabel('Jugar Dino Run+', { exact: true }).click(); await page.locator('.dino-canvas').waitFor(); await capture({ path: out + '/dino-desktop.png' })
await page.getByRole('button', { name: 'Volver a juegos', exact: true }).click(); await page.getByLabel('Seleccionar Escuadrón Galáctico', { exact: true }).click(); await page.getByLabel('Jugar Escuadrón Galáctico', { exact: true }).click(); await page.locator('.gx-canvas').waitFor(); await capture({ path: out + '/galaxia-desktop.png' })
assert.deepEqual(errors, []); console.log('PASS: Inicio → matrícula → Focus; profesores, dificultad, etiquetas; recursos, duplicados, autor, corazones, 25 palabras; Dino, Galaxia; no page errors; mobile overflow check.')
await browser.close()
