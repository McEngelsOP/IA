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
  else if (path.endsWith('/rpc/save_academic_course_status')) { statuses = statuses.filter(s => s.course_id !== payload.p_course).concat({course_id:payload.p_course,status:payload.p_status}); data = {done:['com0','mat0','prog1'],plan:[],statuses} }
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
const base=process.env.REVIEW_BASE_URL||'http://127.0.0.1:5184';let calls=0,pending,failed=false
await page.route('**/functions/v1/study-advisor',async route=>{calls++;if(failed){await route.fulfill({status:429,json:{error:'rate_limited'}});return}pending=route})
await page.goto(base+'/pagina.html');await page.locator('.h-head').waitFor()
async function open(){if(!await page.locator('#nav [data-k="Asesor IA"]').isVisible())await page.locator('#nav [data-n="Herramientas"]').click();await page.locator('#nav [data-k="Asesor IA"]').click();await page.getByLabel('Pregunta para el asesor académico',{exact:true}).waitFor()}
await open();assert.equal(calls,0,'Opening advisor requested AI')
await page.getByLabel('Pregunta para el asesor académico',{exact:true}).fill('¿Cómo organizo mi semestre?')
const first=page.waitForRequest('**/functions/v1/study-advisor');await page.getByRole('button',{name:'Enviar pregunta',exact:true}).evaluate(e=>{e.click();e.click()});await first;await page.waitForTimeout(50);assert.equal(calls,1,'Duplicate AI request')
await pending.fulfill({status:200,json:{answer:'Distribuye tu estudio durante la semana.'}});await page.getByText('Distribuye tu estudio durante la semana.',{exact:true}).waitFor()
await page.getByLabel('Pregunta para el asesor académico',{exact:true}).fill('¿Qué curso requiere más práctica?');const second=page.waitForRequest('**/functions/v1/study-advisor');await page.getByRole('button',{name:'Enviar pregunta',exact:true}).click();await second
const aborted=page.waitForEvent('requestfailed',{predicate:r=>r.url().includes('/functions/v1/study-advisor')});await page.locator('#nav [data-n="Inicio"]').click();await aborted;assert.equal(calls,2)
failed=true;await open();await page.getByLabel('Pregunta para el asesor académico',{exact:true}).fill('Pregunta que debe conservarse');await page.getByRole('button',{name:'Enviar pregunta',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Pregunta para el asesor académico',{exact:true}).inputValue(),'Pregunta que debe conservarse');console.log('PASS AI only on submit, double-submit deduplication, abort on exit, preserved draft on rate limit.');await browser.close()
