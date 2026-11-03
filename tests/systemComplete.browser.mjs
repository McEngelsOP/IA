import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { CARRERAS } from '../src/institutions/esan/carreras.js'
const browser=await chromium.launch({headless:true,executablePath:process.env.SETUP_BROWSER,args:['--no-sandbox']})
browser.on('disconnected',()=>{});
const base=process.env.SETUP_BASE_URL||'http://127.0.0.1:5181',shots=process.env.WORKSPACE_SCREENSHOTS
if(shots)await mkdir(shots,{recursive:true})
const now=Date.now(),id='11111111-1111-4111-8111-111111111111',authKey='sb-setup-fixture-auth-token',sessionId='system-fixture'
const user={id,email:'fixture@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date(now).toISOString()}
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url')
const session={access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,session_id:sessionId,exp:Math.floor(now/1000)+86400,role:'authenticated'})}.fixture`,refresh_token:'fixture',expires_at:Math.floor(now/1000)+86400,expires_in:86400,token_type:'bearer',user}
let preferences={},reports=[],providerReads=0,aiCalls=0;const errors=[]
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const events=[{id:'a',student_id:id,title:'Física',date,start_time:'08:00',end_time:'09:00',event_type:'clase'},{id:'b',student_id:id,title:'Biología',date,start_time:'08:30',end_time:'09:30',event_type:'clase'}]
async function fixture(width=1440,admin=false){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'})
 await context.addInitScript(({authKey,session,sessionId,now})=>{localStorage.setItem(authKey,JSON.stringify(session));localStorage.setItem(`${authKey}:web-activity:v1:${sessionId}`,JSON.stringify({at:now}))},{authKey,session,sessionId,now})
 await context.route('https://setup-fixture.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname,method=route.request().method(),body=route.request().postDataJSON();let data=[],status=200
  if(path.startsWith('/functions/v1/')){aiCalls++;status=429;data={error:'rate_limited'}}
  else if(path==='/auth/v1/user')data=user
  else if(path.endsWith('/rpc/is_app_admin'))data=admin
  else if(path.endsWith('/profiles'))data=[{id,carrera:'ia',alias:'Engels',institution_id:'esan',curriculum_version:CARRERAS.ia.version}]
  else if(path.endsWith('/progress'))data=[{done:['calc1'],plan:[]}]
  else if(path.endsWith('/grades'))data=[{course_id:'calc1',grade:16}]
  else if(path.endsWith('/course_status'))data=[{course_id:'fis1',status:'matriculado'}]
  else if(path.endsWith('/student_setup'))data=[{completed_at:new Date(now).toISOString(),preferences:{semester:4},draft:{}}]
  else if(path.endsWith('/student_preferences'))data=[{values:preferences}]
  else if(path.endsWith('/institution_rules'))data=[{grade_scale:{kind:'numeric',min:0,max:20,passing:10.5,decimals:2,weighting:'credits'}}]
  else if(path.endsWith('/rpc/save_lyra_preferences')){preferences={...preferences,...body.p_patch};data={values:preferences}}
  else if(path.endsWith('/rpc/publish_curriculum')){status=400;data={code:'P0001',message:'CYCLIC_CURRICULUM'}}
  else if(path.endsWith('/rpc/moderation_access'))data={admin,scopes:[]}
  else if(path.endsWith('/rpc/service_dashboard')){providerReads++;data={errors:[{code:'calendar_load',total:2,last_at:new Date().toISOString()}],providers:[{provider:'groq',last_status:'ok',requests_24h:5,daily_limit:100,last_duration_ms:150}],reports:reports.length}}
  else if(path.endsWith('/incident_reports')){if(method==='POST'){data={...body,id:crypto.randomUUID(),status:'open',created_at:new Date().toISOString()};reports.push(data)}else data=reports}
  else if(path.endsWith('/calendar_events'))data=events
  else if(path.endsWith('/calendar_tasks'))data=[{id:'task',title:'Informe de Física',due_date:date,completed:false}]
  else if(path.endsWith('/curriculum_versions'))data=[{version:CARRERAS.ia.version,catalog:CARRERAS.ia,plan_year:null,plan_name:null,published_at:new Date().toISOString()}]
  if(route.request().headers()['accept']?.includes('application/vnd.pgrst.object'))data=Array.isArray(data)?data[0]||null:data
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 })
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/pagina.html');await page.locator('.hoy').waitFor();return{context,page}
}
try{
 const first=await fixture();await first.page.getByRole('button',{name:'Personalizar Inicio'}).click();await first.page.locator('.hw[data-w="hoy"] .w-grip').focus();await first.page.locator('.hw[data-w="hoy"] .w-grip').press('ArrowDown');await first.page.waitForTimeout(700)
 assert.equal(preferences.homeLayout.order.filter(id=>id!=='hero')[0],'stats')
 const second=await fixture(390);assert.equal(await second.page.locator('.hw').first().getAttribute('data-w'),'stats')
 await second.page.locator('#act').click();await second.page.locator('[data-a="preferences"]').click();await second.page.getByRole('heading',{name:'Tu cuenta, en cada dispositivo'}).waitFor()
 await second.page.getByLabel('Qué ocurrió').fill('No puedo encontrar un curso dentro de mi malla.');await second.page.getByRole('button',{name:'Enviar reporte'}).click();await second.page.getByText('Reporte enviado al panel de atención.').waitFor();assert.equal(reports.length,1)
 assert.equal(await second.page.locator('[data-a="admin"]').count(),0)
 await second.page.locator('#page').evaluate(el=>el.scrollTop=0);
 await second.page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'})
 await second.page.evaluate(()=>document.documentElement.dataset.theme='dark')
 assert(await second.page.locator('.lyra-system').evaluate(el=>{const probe=document.createElement('span');probe.style.color='var(--txt)';el.appendChild(probe);const matches=getComputedStyle(el).color===getComputedStyle(probe).color;probe.remove();return matches}))
 if(shots)await second.page.screenshot({path:shots+'/mobile.png',fullPage:true})
 await first.page.locator('#nav .it[data-n="Mi semestre"]').click();await first.page.getByRole('heading',{name:'Tu semana, con tiempo'}).waitFor();await first.page.getByText('Revisar las próximas 4 semanas').click();await first.page.getByText(/Física coincide con Biología/).waitFor()
 const admin=await fixture(1440,true);await admin.page.locator('#act').click();await admin.page.locator('[data-a="admin"]').click();await admin.page.getByRole('heading',{name:'Administración de Lyra'}).waitFor();await admin.page.getByText('calendar_load').waitFor()
 if(shots)await admin.page.screenshot({path:shots+'/desktop.png',fullPage:true})
 const publication=admin.page.locator('.lyra-system>section').filter({has:admin.page.getByRole('heading',{name:'Publicar una versión de malla'})})
 await publication.locator('input[type=file]').setInputFiles({name:'malla-prueba.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(CARRERAS.ia))})
 await publication.getByRole('button',{name:'Validar y publicar versión'}).click()
 await publication.getByRole('alert').filter({hasText:'Hay una cadena circular de requisitos.'}).waitFor()
 await publication.getByRole('alert').scrollIntoViewIfNeeded()
 if(shots)await admin.page.screenshot({path:shots+'/admin-feedback.png',fullPage:true})

 await admin.page.evaluate(()=>document.documentElement.dataset.theme='dark')
 if(shots)await admin.page.screenshot({path:shots+'/admin-dark.png',fullPage:true})
 await admin.page.locator('#nav .it[data-n="Mi semestre"]').click()
 await admin.page.getByRole('button',{name:'Texto → tareas',exact:true}).click()
 await admin.page.getByText('Estado de los servicios de IA',{exact:true}).click()
 const previousReads=providerReads
 await admin.page.getByRole('button',{name:'Actualizar estado de IA',exact:true}).click()
 await admin.page.getByText('Última respuesta correcta',{exact:false}).waitFor()
 assert.equal(providerReads,previousReads+1)
 assert.equal(aiCalls,0,'Checking recorded provider health must never call a quota-consuming AI endpoint')
 if(shots)await admin.page.screenshot({path:shots+'/provider-dark.png',fullPage:true})

 await admin.page.locator('#nav .it[data-n="Asistente"]').click()
 await admin.page.getByLabel('Pregunta para el asesor académico').waitFor()
 for(const theme of ['dark','light']){
  await admin.page.evaluate(value=>document.documentElement.dataset.theme=value,theme)
  for(const width of [1440,390,320]){
   await admin.page.setViewportSize({width,height:900})
   assert(await admin.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   if(shots)await admin.page.screenshot({path:shots+`/portal-assistant-${theme}-${width}.png`,fullPage:true})
  }
 }
 await first.page.goto(base+'/offline.html');await first.page.getByRole('heading',{name:'Consulta sin conexión pendiente'}).waitFor()
 assert.deepEqual(errors,[])
 await Promise.all([first.context.close(),second.context.close(),admin.context.close()])
 console.log('PASS: two devices share home ordering; preferences and report lifecycle; restricted administration; calendar conflicts; offline remains disabled by default; desktop/mobile.')
}finally{await browser.close()}
