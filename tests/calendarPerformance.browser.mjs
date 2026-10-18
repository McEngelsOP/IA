import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const base=process.env.REVIEW_BASE_URL||'http://127.0.0.1:5184'
const user={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{carrera:'ia'},created_at:'2026-01-01T00:00:00Z'}
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url')
const session={access_token:enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})+'.fixture',refresh_token:'fixture',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user}
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1366,height:657},reducedMotion:'reduce'}),page=await context.newPage()
await context.addInitScript(session=>{localStorage.setItem('sb-setup-fixture-auth-token',JSON.stringify(session));localStorage.setItem('sb-setup-fixture-auth-token:web-activity:v1:'+session.user.id,JSON.stringify({at:Date.now()}))},session)
page.setDefaultTimeout(10000)
const events=new Map(),tasks=new Map(),reads=[],writes=[];let fail=true
await context.route('https://setup-fixture.supabase.co/**',async route=>{
 const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').at(-1),body=req.postDataJSON();let data=[]
 if(name==='user')data=user
 else if(name==='profiles')data={carrera:'ia',created_at:user.created_at}
 else if(name==='student_setup')data={draft:{},preferences:{},completed_at:user.created_at}
 else if(['calendar_events','calendar_tasks'].includes(name)){
  const rows=name==='calendar_events'?events:tasks
  if(req.method()==='GET'){
   reads.push({name,search:url.search});assert.equal(url.searchParams.get('student_id'),'eq.'+user.id)
   if(name==='calendar_tasks'){assert(url.searchParams.getAll('due_date').some(v=>v.startsWith('gte.')));assert(url.searchParams.getAll('due_date').some(v=>v.startsWith('lte.')))}else assert(url.searchParams.has('or')||url.searchParams.has('date')||url.searchParams.has('start_date'))
   data=[...rows.values()]
  }else if(req.method()==='DELETE'){
   const id=url.searchParams.get('id').slice(3);data=rows.get(id)||null;rows.delete(id)
  }else{
   const value=Array.isArray(body)?body[0]:body;const id=value.id||url.searchParams.get('id')?.slice(3);writes.push(id)
   data={...rows.get(id),...value,id,student_id:user.id};rows.set(id,data)
   if(fail){await route.abort();return}
  }
 }
 await route.fulfill({status:200,json:data})
})
const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/pagina.html');await page.locator('.h-head').waitFor();await page.locator('#nav [data-n="Calendario/Horarios"]').click();await page.getByRole('button',{name:'Crear evento',exact:true}).click();await page.getByLabel('Título',{exact:true}).fill('Sesión de prueba');await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.getByRole('alert').first().waitFor();fail=false;assert.equal(events.size,1);assert.equal(await page.getByLabel('Título',{exact:true}).inputValue(),'Sesión de prueba');await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.locator('.sc-editor').waitFor({state:'hidden'});await page.getByRole('button',{name:'Crear evento',exact:true}).waitFor();assert.equal(events.size,1);assert.equal(writes[0],writes[1],'Lost reply created a duplicate event')
await page.locator('.sc-agenda-row').first().click();await page.getByLabel('Título',{exact:true}).fill('Sesión corregida');await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.locator('.sc-editor').waitFor({state:'hidden'});await page.getByRole('button',{name:'Crear evento',exact:true}).waitFor();assert.equal([...events.values()][0].title,'Sesión corregida')
await page.locator('.sc-agenda-row').first().click();await page.getByRole('button',{name:'Eliminar evento',exact:true}).click();await page.getByRole('button',{name:'Confirmar eliminación',exact:true}).click();await page.locator('.sc-editor').waitFor({state:'hidden'});await page.getByRole('button',{name:'Crear evento',exact:true}).waitFor();assert.equal(events.size,0)
await page.waitForLoadState('networkidle');const count=reads.length;await page.locator('#nav [data-n="Inicio"]').click();await page.locator('#nav [data-n="Calendario/Horarios"]').click();await page.locator('.sc-editor').waitFor({state:'hidden'});await page.getByRole('button',{name:'Crear evento',exact:true}).waitFor();assert.equal(reads.length,count,'Fresh calendar was queried again')
await page.getByRole('button',{name:'Añadir tarea',exact:true}).click();await page.getByLabel('Título',{exact:true}).fill('Tarea real de prueba aislada');await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.locator('.sc-editor').waitFor({state:'hidden'});await page.getByRole('button',{name:'Crear evento',exact:true}).waitFor();assert.equal(tasks.size,1)
assert.deepEqual(errors,[]);console.log('PASS scoped calendar reads, CRUD, lost-response idempotency, preserved draft, fresh cache and tasks; no real database writes.');await browser.close()
