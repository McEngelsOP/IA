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
const browser = await chromium.launch({ headless: true, executablePath: process.env.REVIEW_BROWSER || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
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
const page = await context.newPage(), errors = [], requests = []; page.on('request',r=>requests.push(r.url())); const capture = options => process.env.REVIEW_SKIP_SCREENSHOTS ? Promise.resolve() : page.screenshot(options); page.on('pageerror', e => errors.push(e.stack))
const base=process.env.REVIEW_BASE_URL || 'http://127.0.0.1:5184'
await context.addInitScript(() => {
 const intervals = new Set(), rawSet = window.setInterval, rawClear = window.clearInterval
 window.setInterval = (...args) => { const id = rawSet(...args); intervals.add(id); return id }
 window.clearInterval = id => { intervals.delete(id); return rawClear(id) }
 const observers = new Map()
 for (const name of ['ResizeObserver','IntersectionObserver']) {
  const Native = window[name]; if (!Native) continue
  window[name] = class extends Native {
   constructor(...args) { super(...args); this.targets = new Set() }
   observe(target,...args) { this.targets.add(target); observers.set(this,this.targets); return super.observe(target,...args) }
   unobserve(target) { this.targets.delete(target); if (!this.targets.size) observers.delete(this); return super.unobserve(target) }
   disconnect() { this.targets.clear(); observers.delete(this); return super.disconnect() }
  }
 }
 window.resourceCounts = () => ({intervals:intervals.size,observers:observers.size})
})
await page.goto(base+'/pagina.html');await page.locator('.h-enrollment-list').waitFor()
assert(!requests.some(u=>/Official(Calendar|StudyGroups|Tools|ArcadeGame).*\.js/.test(u)), 'Unopened section downloaded')
const careerChunks=requests.filter(u=>/\/assets\/(ia|industrial|marketing|economia|contabilidad|derecho|administracion|ingenieria).*\.js/.test(u));assert.equal(careerChunks.length,1);assert.match(careerChunks[0],/\/ia-/)
async function navigate(name){
 if(await page.evaluate(()=>innerWidth<=860&&!document.querySelector('#app').classList.contains('dopen')))await page.locator('#trig').click()
 await page.locator(`#nav [data-n="${name}"]`).click()
 if(name==='Calendario/Horarios')await page.getByRole('button',{name:'Crear evento',exact:true}).waitFor()
 if(name==='Malla Curricular')await page.locator('.oc-name').first().waitFor()
 if(name==='Grupos de estudio')await page.getByText('Todavía no hay salas de estudio',{exact:true}).waitFor()
 if(name==='Mod Focus')await page.locator('#kcs').waitFor()
 if(name==='Inicio')await page.locator('.h-enrollment-list').waitFor()
}
const sections=['Calendario/Horarios','Malla Curricular','Grupos de estudio','Mod Focus','Inicio']
for(const name of sections)await navigate(name)
const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const before=(await cdp.send('Runtime.getHeapUsage')).usedSize, resourcesBefore=await page.evaluate(()=>resourceCounts())
for(let cycle=0;cycle<20;cycle++)for(const name of sections)await navigate(name)
await page.waitForTimeout(1800);await cdp.send('HeapProfiler.collectGarbage');const after=(await cdp.send('Runtime.getHeapUsage')).usedSize, resourcesAfter=await page.evaluate(()=>resourceCounts())
assert.deepEqual(resourcesAfter,resourcesBefore,'Timers/observers accumulated')
assert(after-before<=Math.max(before*.1,5*1024*1024),`Retained heap ${before} -> ${after}`)
await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
async function measureClick(selector, sidebar=false) {
 const runs=[]
 for(let run=0;run<5;run++) {
  const values=[]
  for(let i=0;i<20;i++)values.push(await page.evaluate(async ({selector,i,sidebar})=>{
   const nodes=sidebar?[]:[...document.querySelectorAll(selector)]
   const node=sidebar?document.querySelector(document.body.dataset.side==='rail'?'#brand':'#bRail'):nodes[i%nodes.length]
   const start=performance.now();node.click()
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return performance.now()-start
  },{selector,i,sidebar}))
  runs.push(values.sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1])
 }
 const median=[...runs].sort((a,b)=>a-b)[2]
 assert(median<=200,selector+' response p95 median '+median);return {runs,median}
}
const interactions={sidebar:await measureClick('',true),tabs:await measureClick('.h-tabs button')}
await navigate('Malla Curricular');interactions.course=await measureClick('.oc-canvas button[data-course]')
await navigate('Inicio');const p95=interactions.sidebar.median
await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await page.getByRole('button',{name:'Abrir perfil',exact:true}).click();assert(await page.locator('#menu [data-a="arcade"]').isVisible());assert(await page.locator('#menu [data-a="out"]').isVisible());await page.keyboard.press('Escape')
const sizes=[[1920,947],[1536,730],[1366,657],[1280,620],[1024,600],[768,1024],[390,844],[360,640],[844,390],[390,480]], matrix=[]
for(const theme of ['light','dark']){
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
 for(const [width,height] of sizes){
 await page.setViewportSize({width,height})
 for(const name of sections){
  await navigate(name)
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(geometry.scroll<=geometry.width,JSON.stringify({name,width,height,...geometry}))
  matrix.push({theme,width,height,name,pass:true})
  if([[1536,730],[390,844]].some(([w,h])=>w===width&&h===height))await page.screenshot({path:out+'/'+theme+'-'+name.replaceAll('/','-').replaceAll(' ','-')+'-'+width+'.png'})
 }
}
}
assert.deepEqual(errors,[])
const {writeFile}=await import('node:fs/promises');await writeFile(out+'/performance-functional.json',JSON.stringify({before,after,growth:after-before,resourcesBefore,resourcesAfter,p95,interactions,matrix,errors},null,2))
console.log(JSON.stringify({status:'passed',before,after,growth:after-before,p95,interactions,viewStates:matrix.length}))
const guest = await browser.newContext({viewport:{width:1366,height:657},reducedMotion:'reduce'})
const guestPage=await guest.newPage();guestPage.on('pageerror',e=>errors.push(e.message));await guestPage.clock.install();await guestPage.goto(base+'/pagina.html');await guestPage.locator('#nav [data-n="Mod Focus"]').click();await guestPage.locator('[data-a="kpre"][data-v="p25"]').click();await guestPage.getByRole('button',{name:'Comenzar',exact:true}).click();await guestPage.locator('.k-clock-stage').waitFor()
const clockBefore=await guestPage.locator('.k-clock-stage').textContent();await guestPage.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});await guestPage.clock.fastForward(25*60*1000+1000);assert.equal(await guestPage.locator('.k-clock-stage').textContent(),clockBefore,'Hidden timer repainted');await guestPage.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});await guestPage.getByText(/Sesión terminada/).waitFor();assert.deepEqual(errors,[]);console.log('PASS Focus resumes from timestamps after 25 minutes hidden; no hidden repaint.')
await browser.close()
