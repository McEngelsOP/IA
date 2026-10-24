import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import { CARRERAS, CARRERA_KEYS } from '../src/institutions/esan/carreras.js'

const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
const screenshots = process.env.WORKSPACE_SCREENSHOTS
if (screenshots) await mkdir(screenshots,{recursive:true})
const browser = await chromium.launch({headless:true,executablePath:process.env.SETUP_BROWSER,args:['--no-sandbox']})
const errors=[]
const now=Date.now(),user={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{}}
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
const session={access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,session_id:'workspace',exp:Math.floor(now/1000)+3600,role:'authenticated'})}.fixture`,refresh_token:'fixture',expires_at:Math.floor(now/1000)+3600,expires_in:3600,token_type:'bearer',user}
async function fixture(career='ia',width=1440,{failSave=false}={}){
 const context=await browser.newContext({viewport:{width,height:width<860?844:1000},reducedMotion:'reduce',acceptDownloads:true})
 let plan=['calc2'],advisor=null,writes=0
 await context.addInitScript(({session,now})=>{localStorage.setItem('sb-setup-fixture-auth-token',JSON.stringify(session));localStorage.setItem('sb-setup-fixture-auth-token:web-activity:v1:workspace',JSON.stringify({at:now}))},{session,now})
 await context.route('https://setup-fixture.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();let data=[],status=200
  if(path==='/auth/v1/user')data=user
  else if(path.endsWith('/profiles'))data=[{id:user.id,carrera:career,alias:'Engels',institution_id:career==='pucp-mecatronica'?null:'esan',curriculum_version:CARRERAS[career]?.version}]
  else if(path.endsWith('/progress'))data=[{done:['mat0','com0','calc1','prog1','fia'],plan}]
  else if(path.endsWith('/grades'))data=[{course_id:'calc1',grade:16}]
  else if(path.endsWith('/course_status'))data=career==='ia'?[{course_id:'fis1',status:'matriculado'}]:[]
  else if(path.endsWith('/student_setup'))data=[{completed_at:new Date(now).toISOString(),preferences:{semester:4,credits:16},draft:{}}]
  else if(path.endsWith('/rpc/save_academic_plan')){writes++;if(failSave){status=500;data={message:'fixture save failed'}}else{plan=body.p_plan;data={plan}}}
  else if(path.endsWith('/functions/v1/study-advisor')){advisor=body;data={answer:'La proyección usa tu malla y distingue los cursos actuales.',usage:{canSend:true}}}
  else if(path.endsWith('/rpc/get_course_difficulty_stats'))data={total_votes:0,avg_rating:null}
  else if(path.endsWith('/rpc/focus_active_session'))data=null
  else if(path.endsWith('/rpc/focus_daily_summary'))data={seconds:0,completed_count:0,interrupted_count:0,sessions:[]}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 })
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`${base}/pagina.html`)
 await page.locator(career==='pucp-mecatronica'?'[data-a="hexport"]':'#home-hero-title').waitFor()
 return {context,page,get plan(){return plan},get advisor(){return advisor},get writes(){return writes}}
}
async function navigate(page,name,width=1440){if(width<=860)await page.locator('#trig').click();await page.locator(`#nav [data-n="${name}"]`).click()}
async function screenshot(page,name){if(screenshots){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${screenshots}/${name}.png`})}}
try{
 const f=await fixture(),{page}=f
 assert.deepEqual(await page.locator('#nav>.it .l').allTextContents(),['Inicio','Mi carrera','Mi semestre','Planificar','Asistente'])
 await page.getByRole('button',{name:'Abrir perfil',exact:true}).click()
 const activeDownload=page.waitForEvent('download');await page.getByRole('menuitem',{name:'Exportar registro académico',exact:true}).click();const activeReport=await activeDownload
 assert.match(activeReport.suggestedFilename(),/^lyra-registro-academico-\d{4}-\d{2}-\d{2}\.html$/)
 const documentPage=await f.context.newPage();await documentPage.setContent(await readFile(await activeReport.path(),'utf8'))
 assert((await documentPage.locator('main').innerText()).includes('Cálculo I'));assert(!(await documentPage.locator('main').innerText()).includes('No está disponible el catálogo'))
 for(const width of [1440,390,320]){
  await documentPage.setViewportSize({width,height:1000});await screenshot(documentPage,`registro-${width}`)
  assert(await documentPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Report overflow at ${width}px`)
 }
 await documentPage.evaluate(()=>{window.print=()=>{window.printCalled=true}});await documentPage.getByRole('button',{name:'Imprimir / Guardar como PDF',exact:true}).click();assert(await documentPage.evaluate(()=>window.printCalled))
 await documentPage.emulateMedia({media:'print'});assert.equal(await documentPage.locator('.actions').isVisible(),false)
 if(screenshots)await documentPage.pdf({path:`${screenshots}/registro.pdf`,format:'A4',preferCSSPageSize:true})
 await documentPage.close()
 await screenshot(page,'inicio-desktop')
 await navigate(page,'Mi carrera');await page.locator('.oc-source').waitFor();await page.locator('.oc-source summary').click()
 assert((await page.locator('.oc-source').innerText()).includes(CARRERAS.ia.version))
 await navigate(page,'Mi semestre');await page.locator('.sc-datebar').waitFor()
 assert.equal(await page.getByRole('button',{name:/Importar horario de Excel/}).count(),1)
 await page.getByRole('tab',{name:'Notas y objetivos',exact:true}).click();await page.locator('#semester-grades .notas, #semester-grades .rh').waitFor()
 await page.getByRole('button',{name:'Diagnóstico',exact:true}).click();assert.equal(await page.locator('.dg').count(),1)
 await screenshot(page,'notas-desktop')
 await page.locator('#semester-tab-grades').focus();await page.keyboard.press('ArrowRight');await page.locator('.h-enrollment-list').waitFor()
 assert.equal(await page.locator('#semester-tab-courses').getAttribute('aria-selected'),'true')
 await navigate(page,'Planificar');await page.locator('.bj-st').first().waitFor()
 assert((await page.locator('.b-wrap').innerText()).includes('Por verificar'))
 await page.locator('.bj-st').filter({hasText:'Comparar'}).click();await page.locator('.bj-st').filter({hasText:'Planificar'}).click()
 assert(!(await page.locator('.b-cycles').innerText()).includes('Física I'))
 await screenshot(page,'planificar-desktop')
 await page.getByRole('button',{name:'Sumar próximo semestre a mi plan'}).click();await page.getByRole('button',{name:'Confirmar y guardar'}).click()
 await page.getByText('Primer ciclo de la proyección guardado en tu plan.',{exact:true}).waitFor();assert.equal(f.writes,1);assert(!f.plan.includes('fis1'))
 await navigate(page,'Asistente');await page.locator('.a-compose, .a-input, textarea').first().waitFor()
 await page.locator('textarea').fill('¿Cómo ves mi plan para el próximo semestre?');await page.getByRole('button',{name:'Enviar pregunta',exact:true}).click()
 await page.getByText('La proyección usa tu malla y distingue los cursos actuales.',{exact:true}).waitFor()
 assert.equal(f.advisor.careerId,'ia');assert.equal(f.advisor.careerVersion,CARRERAS.ia.version);assert.deepEqual(f.advisor.enrolledCourseIds,['fis1'])
 assert.equal(f.advisor.currentSemester,4);assert.equal(f.advisor.completedCredits,12)
 assert(f.advisor.courses.every(c=>Array.isArray(c.prerequisites)))
 assert(!JSON.stringify(f.advisor).includes(user.email))
 await page.goBack();await page.getByRole('heading',{name:'Planificar',exact:true}).waitFor()
 await f.context.close()
 const failed=await fixture('ia',1440,{failSave:true});await navigate(failed.page,'Planificar');await failed.page.locator('.bj-st').filter({hasText:'Planificar'}).click();await failed.page.getByRole('button',{name:'Sumar próximo semestre a mi plan'}).click();await failed.page.getByRole('button',{name:'Confirmar y guardar'}).click();await failed.page.getByText('No se pudo guardar. Tu plan anterior se conserva; reintenta.',{exact:true}).waitFor();assert.deepEqual(failed.plan,['calc2']);await failed.context.close()
 for(const width of [390,320]){
  const m=await fixture('ia',width);await navigate(m.page,'Mi semestre',width);await m.page.getByRole('tab',{name:'Notas y objetivos',exact:true}).click();await screenshot(m.page,`semestre-${width}`)
  assert(await m.page.locator('#page').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  await navigate(m.page,'Planificar',width);await m.page.locator('.bj-st').first().waitFor();await screenshot(m.page,`planificar-${width}`)
  assert(await m.page.locator('#page').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await m.context.close()
 }
 for(const key of CARRERA_KEYS){const c=await fixture(key);await navigate(c.page,'Mi carrera');await c.page.locator('.oc-source').waitFor();assert.equal(await c.page.locator('[data-course]').count()>0,true,key);await c.context.close()}
 const retired=await fixture('pucp-mecatronica');assert.equal(await retired.page.locator('#h-career').count(),0)
 const downloading=retired.page.waitForEvent('download');await retired.page.getByRole('button',{name:'Exportar registro académico',exact:true}).click();const download=await downloading
 assert.match(download.suggestedFilename(),/\.html$/)
 const report=await retired.context.newPage();await report.setContent(await readFile(await download.path(),'utf8'))
 const exported=await report.locator('#academic-record-data').evaluate(el=>JSON.parse(el.textContent));assert.equal(exported.profiles[0].carrera,'pucp-mecatronica');assert.deepEqual(exported.progress[0].done,['mat0','com0','calc1','prog1','fia'])
 await report.getByRole('heading',{name:'Registro académico',exact:true}).waitFor();assert((await report.locator('main').innerText()).includes('No está disponible el catálogo'))
 const backupDownload=report.waitForEvent('download');await report.getByRole('button',{name:'Descargar respaldo de datos (JSON)',exact:true}).click();const backup=await backupDownload
 assert.deepEqual(JSON.parse(await readFile(await backup.path(),'utf8')),exported);await retired.context.close()
 const registration=await browser.newPage();registration.on('pageerror',e=>errors.push(e.message));await registration.route('https://setup-fixture.supabase.co/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));await registration.goto(`${base}/login.html`);assert.equal(await registration.locator('#registerCareer option[value="pucp-mecatronica"]').count(),0);assert.equal(await registration.locator('#registerCareer option').count(),19);await registration.close()
 assert.deepEqual(errors,[])
 console.log('PASS: 18 ESAN catalogs, five destinations, semester grades, keyboard tabs, conditional planning, persistence/error recovery, assistant context, back navigation, 320/390px layouts, retired-account export, ESAN-only registration.')
}finally{await browser.close()}
