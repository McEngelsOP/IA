import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { CARRERAS } from '../src/institutions/esan/carreras.js'
const browser=await chromium.launch({headless:true,executablePath:process.env.SETUP_BROWSER,args:['--no-sandbox']})
try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()?.errorText))
 await page.goto(process.env.SETUP_BASE_URL+'/pagina.html');await page.getByRole('heading',{name:'Tu recorrido empieza aquí'}).waitFor()
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:10000})
 await page.reload();await page.getByRole('heading',{name:'Tu recorrido empieza aquí'}).waitFor()
 await page.evaluate(async catalog=>{
  const data={userId:'offline-fixture',profile:{alias:'Consulta offline'},catalog,done:['calc1'],events:[],tasks:[{id:'t1',title:'Informe sin conexión',due_date:'2026-11-02',completed:false}],academicAt:new Date().toISOString(),calendarAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
  await new Promise((resolve,reject)=>{const r=indexedDB.open('lyra-offline-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('accounts');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(data,'offline-fixture');tx.oncomplete=()=>{db.close();resolve()}}})
  localStorage.setItem('lyra-offline-owner','offline-fixture')
 },CARRERAS.ia)
 await context.setOffline(true);await page.goto(process.env.SETUP_BASE_URL+'/pagina.html')
 await page.getByRole('heading',{name:'Lyra · Consulta offline'}).waitFor({timeout:10000})
 await page.getByRole('button',{name:'Tareas',exact:true}).click();await page.getByText(/Informe sin conexión/).waitFor()
 await page.getByRole('button',{name:'Malla',exact:true}).click();await page.getByRole('heading',{name:'Ingeniería en Inteligencia Artificial'}).waitFor()
 const cached=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys())for(const req of await(await caches.open(name)).keys())result.push(req.url);return result})
 assert(cached.some(url=>url.endsWith('/offline.html')));assert(!cached.some(url=>url.includes('/rest/v1')||url.includes('/api/')))
 assert.deepEqual(errors,[]);await context.close()
 console.log('PASS: production service worker precaches offline page and its module graph; real network cut still opens tasks and curriculum; no authenticated API responses cached.')
}finally{await browser.close()}
