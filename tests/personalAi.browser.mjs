const { createServer } = await import('vite')
process.env.VITE_SUPABASE_URL='https://setup-fixture.supabase.co';process.env.VITE_SUPABASE_ANON_KEY='fixture'
const server = await createServer({server:{host:'127.0.0.1',port:5181,open:false}});await server.listen()
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const out = process.env.REVIEW_OUTPUT || '/tmp/ia-deberes-review'; await mkdir(out, { recursive: true })
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', app_metadata: { provider: 'email' }, user_metadata: { carrera: 'ia' }, created_at: '2026-01-01T00:00:00Z' }
const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url')
const session = { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' }) + '.fixture', refresh_token: 'fixture', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user }
let statuses = [{ course_id: 'calc1', status: 'matriculado' }, { course_id: 'com1', status: 'matriculado' }], rating = null, teachers = []
let resources = [{ id: '22222222-2222-4222-8222-222222222222', name: 'Notion', url: 'https://notion.so/', description: 'Organiza apuntes y tareas.', is_owner: false, hearts: 2, liked: false }]
let failPublish = false, failAI = false, failTasks = false, tasks = [], config={mode:'system',keys:[]},failKey=false
const browser = await chromium.launch({ headless: true, executablePath: process.env.REVIEW_BROWSER || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })
await context.addInitScript(session => { localStorage.setItem('sb-setup-fixture-auth-token', JSON.stringify(session)); localStorage.setItem('sb-setup-fixture-auth-token:web-activity:v1:' + session.user.id, JSON.stringify({ at: Date.now() })) }, session)
await context.route('https://setup-fixture.supabase.co/**', async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, payload = req.method() === 'POST' || req.method() === 'PATCH' ? req.postDataJSON() : null
  let data = [], status = 200
  if (path.endsWith('/functions/v1/personal-ai')) { if(failKey&&payload.action==='save'){status=503;data={message:'No se pudo guardar. Reintenta.'}} else {if(payload.action==='save'){config.mode='personal';config.keys=[{provider:payload.provider,hint:'••••'+payload.key.slice(-4),enabled:true,lastStatus:null}]} if(payload.action==='mode')config.mode=payload.mode;if(payload.action==='toggle')config.keys[0].enabled=payload.enabled;if(payload.action==='delete')config.keys=[];data=payload.action==='test'?{status:'ok',message:'Tu clave respondió correctamente.'}:config} }
  else if (path.endsWith('/functions/v1/text-to-tasks')) { if(failAI) { status=503; data={message:'IA no disponible. Reintenta.'} } else data={tasks:[{title:'Entregar informe',due_date:null,course_id:'calc1'},{title:'Preparar exposición',due_date:'2026-10-19',course_id:''}]} }
  else if(path.endsWith('/rpc/set_semester_courses')) { statuses=payload.p_courses.map(course_id=>({course_id,status:'matriculado'})); data=statuses }
  else if(path.endsWith('/calendar_tasks')) { if(payload) { if(failTasks) {status=500;data={message:'fixture failure'}} else { tasks=payload;data=tasks } } else data=tasks }
  else if(path.endsWith('/user')) data = user
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
const page = await context.newPage(), errors = []; const capture = async options => { await page.locator('#page').evaluate(el=>el.scrollTop=0);return page.screenshot({...options,fullPage:true}) }; page.on('pageerror', e => errors.push(e.stack))
await page.goto((process.env.REVIEW_BASE_URL || 'http://127.0.0.1:5181') + '/pagina.html')


await page.locator('.h-enrollment-list').waitFor()
await page.getByRole('button',{name:'Abrir perfil',exact:true}).click()
await page.getByRole('menuitem',{name:'Mi IA · claves personales',exact:true}).click()
await page.getByRole('heading',{name:'Tu conexión de IA',exact:true}).waitFor()
await page.getByLabel('Proveedor',{exact:true}).selectOption('groq')
await page.getByLabel('Clave de API de Groq',{exact:true}).fill('fixture-personal-not-real-key-5678')
assert.equal(await page.locator('#ai-key').getAttribute('type'),'password')
failKey=true
await page.getByRole('button',{name:'Guardar clave',exact:true}).click()
await page.getByText('No se pudo guardar. Reintenta.',{exact:true}).waitFor()
assert((await page.locator('#ai-key').inputValue()).includes('fixture'))
failKey=false
await page.getByRole('button',{name:'Guardar clave',exact:true}).click()
await page.getByText('Clave guardada y modo personal activado.',{exact:false}).waitFor()
assert.equal(await page.locator('#ai-key').inputValue(),'')
assert.equal(await page.locator('input[value="personal"]').isChecked(),true)
await page.getByRole('button',{name:'Probar Groq',exact:true}).click()
await page.getByText('Tu clave respondió correctamente.',{exact:true}).waitFor()
assert.equal(await page.locator('.pai-provider').getByText('Respondió correctamente',{exact:false}).count(),1)
await capture({path:out+'/personal-desktop.png'})
await page.getByRole('button',{name:'Desactivar',exact:true}).click()
await page.getByText('Clave desactivada.',{exact:true}).waitFor()
assert.equal(await page.getByRole('button',{name:'Probar Groq',exact:true}).isEnabled(),false)
await page.getByRole('button',{name:'Activar',exact:true}).click()
await page.getByText('Clave activada.',{exact:true}).waitFor()
await page.getByRole('radio',{name:'Servicio de la app',exact:true}).click()
await page.getByText('Servicio de la app activado.',{exact:true}).waitFor()
assert.equal(await page.getByRole('button',{name:'Probar Groq',exact:true}).isEnabled(),false)
await page.getByRole('button',{name:'Volver a Inicio',exact:true}).click()
await page.locator('.h-enrollment-list').waitFor()
for(const width of [390,320]) {
 await page.setViewportSize({width,height:844})
 await page.getByRole('button',{name:'Abrir perfil',exact:true}).click()
 await page.getByRole('menuitem',{name:'Mi IA · claves personales',exact:true}).click()
 await page.getByRole('heading',{name:'Tu conexión de IA',exact:true}).waitFor()
 await capture({path:out+'/personal-mobile-'+width+'.png'})
 await page.locator('.pai-add').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/personal-key-mobile-'+width+'.png'})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 assert.equal(await page.locator('.pai').evaluate(el=>el.scrollWidth>el.clientWidth),false)
 await page.getByRole('button',{name:'Volver a Inicio',exact:true}).click()
}
await page.getByRole('button',{name:'Abrir perfil',exact:true}).click()
await page.getByRole('menuitem',{name:'Mi IA · claves personales',exact:true}).click()
await page.getByLabel('Eliminar clave de Groq',{exact:true}).click()
await page.getByRole('button',{name:'Conservar',exact:true}).click()
assert.equal(config.keys.length,1)
await page.getByLabel('Eliminar clave de Groq',{exact:true}).click()
await page.getByRole('button',{name:'Confirmar eliminación',exact:true}).click()
await page.getByText('Clave eliminada de la app.',{exact:true}).waitFor()
assert.equal(config.keys.length,0)
assert.deepEqual(errors,[])
console.log('PASS desktop/mobile 390/320: profile/+ → Mi IA; save error/retry; secret masked/cleared; test; activate/deactivate; modes; delete/cancel; no overflow or JS errors.')
await browser.close();await server.close()
