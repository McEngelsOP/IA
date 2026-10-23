import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir} from 'node:fs/promises'
const browser=await chromium.launch({headless:true,executablePath:process.env.SETUP_BROWSER,args:['--no-sandbox']})
const base=process.env.SETUP_BASE_URL||'http://127.0.0.1:5181',A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222'
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base+'/tests/fixtures/assistant.html')
 const send=async()=>{await page.getByLabel('Pregunta para el asesor académico').fill('Crea una tarea para el informe');await page.getByRole('button',{name:'Enviar pregunta',exact:true}).click();await page.getByLabel('Revisar borrador').waitFor()}
 await send();assert.equal(await page.evaluate(()=>window.injected),undefined)
 assert.equal(await page.locator('.a-rep img').count(),0)
 // Draft editing survives reload; server only sees a bounded role/content history.
 await page.getByLabel('Título',{exact:true}).fill('Informe corregido')
 await page.getByLabel('Pregunta para el asesor académico').fill('Mi borrador sin enviar')
 await page.waitForFunction(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('lyra-assistant-local-v1');q.onsuccess=()=>r(q.result)});return await new Promise(r=>{const q=db.transaction('chats').objectStore('chats').getAll();q.onsuccess=()=>r(q.result.some(c=>c.draft==='Mi borrador sin enviar'&&c.messages.some(m=>m.proposal?.title==='Informe corregido')))})})
 await page.reload();await page.getByLabel('Revisar borrador').waitFor();assert.equal(await page.getByLabel('Título',{exact:true}).inputValue(),'Informe corregido')
 assert.equal(await page.getByLabel('Pregunta para el asesor académico').inputValue(),'Mi borrador sin enviar')
 await page.evaluate(()=>window.failSave=true);await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.getByText(/No se pudo confirmar el guardado/).waitFor()
 const first=await page.evaluate(()=>window.calls.find(c=>c.action==='save_draft').operationId)
 await page.reload();await page.getByLabel('Revisar borrador').waitFor();await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.getByText('Guardado en tu calendario y tareas.',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.calls.find(c=>c.action==='save_draft').operationId),first)
 await page.evaluate(id=>window.switchOwner(id),B);await page.getByRole('heading',{name:'Convierte tus dudas en un plan'}).waitFor();assert.equal(await page.getByLabel('Revisar borrador').count(),0)
 await page.evaluate(id=>window.switchOwner(id),A);await page.getByRole('button',{name:'Guardado',exact:true}).waitFor()
 await page.getByRole('button',{name:'Nuevo chat',exact:true}).first().click();await send();await page.getByText('Historial de este dispositivo',{exact:true}).click();await page.getByRole('button',{name:'Eliminar chat',exact:true}).waitFor({state:'visible'})
 await page.getByRole('button',{name:'Borrar historial',exact:true}).click();await page.getByRole('button',{name:'Sí, borrar',exact:true}).click();await page.getByRole('heading',{name:'Convierte tus dudas en un plan'}).waitFor()
 assert.equal(await page.getByLabel('Chats de este dispositivo').locator('option').count(),1)
 await send();await page.evaluate(()=>window.expired=true);await page.getByLabel('Pregunta para el asesor académico').fill('Hola');await page.getByRole('button',{name:'Enviar pregunta',exact:true}).click();await page.getByText(/Tu sesión venció/).waitFor();assert(await page.getByLabel('Revisar borrador').count())
 const shots=process.env.WORKSPACE_SCREENSHOTS;if(shots){await mkdir(shots,{recursive:true});await page.screenshot({path:shots+'/assistant-desktop.png',fullPage:true})}
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(shots)await page.screenshot({path:shots+`/assistant-${width}.png`,fullPage:true})}
 assert.deepEqual(errors,[]);console.log('PASS local chats: reload, account isolation, drafts, retry ID across reload, safe text, session expiry, deletion, 320/390 desktop layouts')
 await context.close()
}finally{await browser.close()}
