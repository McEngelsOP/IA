import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir} from 'node:fs/promises'
const browser=await chromium.launch({headless:true,executablePath:process.env.SETUP_BROWSER,args:['--no-sandbox']})
const base=process.env.SETUP_BASE_URL||'http://127.0.0.1:5181',shots='/tmp/lyra-integration-review';await mkdir(shots,{recursive:true})
const id='11111111-1111-4111-8111-111111111111',cid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now=Date.now(),errors=[]
const user={id,email:'student@example.invalid',role:'authenticated',aud:'authenticated',app_metadata:{provider:'email'},user_metadata:{}}
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url')
const session={access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,session_id:'integration',exp:Math.floor(now/1000)+3600,role:'authenticated'})}.fixture`,refresh_token:'fixture',expires_in:3600,expires_at:Math.floor(now/1000)+3600,token_type:'bearer',user}
const row={code:'MAT1',name:'Matemáticas',credits:'4',cycle:'1',type:'curso',requirements:'Ninguno'}
let prefs={},assigned=false,submissions=0,signups=[],alias='Engels',aliasChanged=null
async function fixture(width=1440,auth=true,theme='light'){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',hasTouch:width<860})
 await context.addInitScript(({auth,session,theme,now})=>{localStorage.setItem('lyra-theme',theme);if(auth){localStorage.setItem('sb-setup-fixture-auth-token',JSON.stringify(session));localStorage.setItem('sb-setup-fixture-auth-token:web-activity:v1:integration',JSON.stringify({at:now}))}},{auth,session,theme,now})
 await context.route('https://setup-fixture.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();let data=[],status=200
  if(path==='/auth/v1/user')data=user
  else if(path==='/auth/v1/signup'){signups.push(body);data={user,session:null}}
  else if(path.endsWith('/profiles'))data=[{id,institution_id:'u-fixture',university_name:'Universidad Prueba',external_career:'Ingeniería',carrera:assigned?cid:null,custom_curriculum_id:assigned?cid:null,curriculum_version:assigned?cid:null,alias,alias_changed_at:aliasChanged}]
  else if(path.endsWith('/institution_rules'))data=[{grade_scale:{kind:'numeric',min:0,max:20,passing:10.5,decimals:2,weighting:'credits'}}]
  else if(path.endsWith('/custom_curricula'))data=assigned?[{id:cid,owner_id:id,institution_id:'u-fixture',career_name:'Ingeniería',status:'pending',validation_state:'review',rows:[row],source_name:'Malla.txt',markdown:'# Ingeniería',updated_at:new Date().toISOString(),analysis_summary:{summary:'Los proveedores no coinciden.',issues:[]}}]:[]
  else if(path.endsWith('/student_setup'))data=[{completed_at:new Date(now).toISOString(),preferences:{semester:1},draft:{}}]
  else if(path.endsWith('/student_preferences'))data=[{values:prefs}]
  else if(path.endsWith('/rpc/search_universities'))data=[]
  else if(path.endsWith('/rpc/save_lyra_preferences')){prefs={...prefs,...body.p_patch};data={values:prefs}}
  else if(path.endsWith('/rpc/submit_curriculum_v2')){assigned=true;submissions++;data=cid}
  else if(path.endsWith('/rpc/moderation_access'))data={admin:false,scopes:[]}
  else if(path.endsWith('/rpc/is_curriculum_moderator'))data=false
  else if(path.endsWith('/rpc/ai_access_policy'))data={access:{sharedEligible:false,personalRequired:true},usage:{canSend:false}}
  else if(path.endsWith('/rpc/change_profile_alias')){alias=body.p_alias;aliasChanged=new Date().toISOString();data={alias,changed_at:aliasChanged}}
  else if(path.endsWith('/functions/v1/curriculum-analysis'))data={status:'completed',decision:'review'}
  else if(path.endsWith('/rpc/focus_active_session'))data=null
  if(route.request().headers().accept?.includes('application/vnd.pgrst.object'))data=Array.isArray(data)?data[0]||null:data
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 })
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return{page,context}
}
try{
 for(const width of [1440,390])for(const theme of ['light','dark']){
  const {page,context}=await fixture(width,false,theme);await page.goto(base+'/login.html');await page.locator('#loginForm').waitFor();await page.locator('#studentCode').fill('student@example.invalid');assert.equal(await page.locator('#studentCode').inputValue(),'student@example.invalid');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.equal(await page.evaluate(()=>localStorage.getItem('lyra-theme')),theme)
  const alpha=await page.locator('.panel').evaluate(el=>getComputedStyle(el).backgroundColor);assert(!alpha.endsWith(', 1)')&&!/^rgb\(/.test(alpha),alpha)
  await page.screenshot({path:`${shots}/access-${width}-${theme}.png`});await page.locator('[data-view="registerScreen"]').click();await page.locator('#registerUniversityType').selectOption('other');assert.equal(await page.locator('#registerCareer').isVisible(),false);assert.equal(await page.locator('#registerCode').isVisible(),false)
  await page.locator('#registerUniversity').fill('Universidad Prueba');await page.locator('#registerExternalCareer').fill('Ingeniería');await page.locator('#registerEmail').fill('student@example.invalid');await page.locator('#registerPassword').fill('fixture-password');await page.locator('#registerConfirm').fill('fixture-password');await page.locator('#registerForm button[type=submit]').click();await page.getByRole('heading',{name:/Revisa tu correo/}).waitFor()
  assert.equal(signups.at(-1).data.institution_id,'other');assert.equal(signups.at(-1).data.carrera,undefined)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${shots}/login-${width}-${theme}.png`});await context.close()
 }
 for(const width of [1440,390]){
  assigned=false;alias='Engels';aliasChanged=null;const {page,context}=await fixture(width);await page.goto(base+'/pagina.html');await page.getByRole('heading',{name:'Prepara tu malla'}).waitFor();await page.locator('#act').click();assert.equal(await page.locator('[data-a=profile]').count(),1);await page.locator('#act').click()
  await page.getByLabel('Texto de la malla').fill('Código;Curso;Créditos;Ciclo;Tipo;Requisitos\nMAT1;Matemáticas;4;1;curso;Ninguno');await page.getByRole('button',{name:'Convertir y extraer datos'}).click();await page.getByLabel('Revisé los datos', {exact:false}).check();await page.getByRole('button',{name:'Guardar malla y configurar mi avance'}).click();await page.locator('#home-hero-title').waitFor()
  assert.equal(await page.locator('.hw[data-w=hero]').count(),0);await page.getByRole('button',{name:'Personalizar Inicio'}).click()
  for(const block of ['stats','notas']){await page.locator(`.hw[data-w="${block}"] .w-options`).click();await page.locator('[data-home-size=compact]').click()}
  const boxes=await Promise.all(['stats','notas'].map(v=>page.locator(`.hw[data-w="${v}"]`).boundingBox()));assert.equal(Math.round(boxes[0].y),Math.round(boxes[1].y))
  await page.locator('.hw[data-w=stats] .w-options').click();await page.getByRole('button',{name:'Eliminar bloque «Resumen»',exact:true}).click();await page.locator('#act').click();await page.locator('[data-home-restore]').click();assert.equal(await page.locator('.hw[data-w=stats]').count(),1)
  const sizeHandle=page.locator('.hw[data-w=stats] .w-resize');await sizeHandle.scrollIntoViewIfNeeded();await sizeHandle.focus();await sizeHandle.press('ArrowRight')
  const initialHeight=await page.evaluate(()=>JSON.parse(localStorage.getItem('lyra-home-layout-v1:11111111-1111-4111-8111-111111111111')).frames.stats.height)
  for(let step=0;step<8;step++)await sizeHandle.press('ArrowDown')
  await page.waitForTimeout(700);assert.equal(prefs.homeLayout.sizes.stats,'custom');assert.equal(prefs.homeLayout.frames.stats.height,initialHeight+192,JSON.stringify({width,initialHeight,frame:prefs.homeLayout.frames.stats}))
  const metrics=page.locator('.hw[data-w=stats] .h-summary .st'),metricBoxes=await Promise.all([metrics.nth(0).boundingBox(),metrics.nth(1).boundingBox()]);assert.equal(Math.round(metricBoxes[0].y),Math.round(metricBoxes[1].y),'Custom summaries adapt into two columns')
  await page.locator('.hw[data-w=stats]').scrollIntoViewIfNeeded();await page.screenshot({path:`${shots}/resize-${width}.png`})
  await page.waitForTimeout(700);assert(prefs.homeLayout);await page.locator('#act').click();await page.screenshot({path:`${shots}/home-${width}.png`});assert.equal(await page.locator('[data-a=arcade]').count(),width<860?0:1,JSON.stringify({errors,menu:await page.locator('#menu').innerHTML(),url:page.url()}));await page.locator('[data-a=profile]').click();await page.getByRole('heading',{name:'Mi perfil',exact:true}).waitFor();await page.getByText('En revisión por moderación',{exact:true}).waitFor()
  await page.getByLabel('Apodo público').fill('Estudiante');await page.getByRole('button',{name:'Guardar apodo'}).click();await page.waitForFunction(()=>document.querySelector('input[autocomplete=nickname]')?.disabled);await page.screenshot({path:`${shots}/profile-${width}.png`})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await context.close()
 }
 const {page,context}=await fixture(390,false);await page.goto(base+'/juegos/geoduelo/index.html');await page.waitForURL(url=>url.pathname==='/pagina.html');await context.close();assert.equal(submissions,2);assert.deepEqual(errors,[]);console.log('PASS: external registration and draft import, fixed hero, compact packing, delete/restore + cloud, profile review, mobile game guards; desktop/mobile, dark login independent of the stored portal theme.')
}finally{await browser.close()}
