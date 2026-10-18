import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createServer} from 'vite'
import {runtime, ids, capitals} from '../workers/geoduelo/test/runtime.mjs'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright')
const root=new URL('../',import.meta.url).pathname
const runtime_=await runtime()
const endpoint=String(await runtime_.mf.ready).replace(/\/$/,'')
const server=await createServer({root,configFile:root+'vite.config.js',define:{'import.meta.env.VITE_GEODUELO_ONLINE_URL':JSON.stringify(endpoint)},server:{host:'127.0.0.1',port:5173,strictPort:true},plugins:[{
  name:'online-fixture',configureServer(server){server.middlewares.use('/__online',async(req,res)=>{
    const n=Number(new URL(req.url,'http://fixture').searchParams.get('seat')||0)
    res.setHeader('content-type','text/html');res.end(await server.transformIndexHtml('/__online-'+n,`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="game" style="height:100dvh"></div><script type="module">
      import {mountOfficialArcadeGame} from '/src/components/OfficialArcadeGame.jsx';
      const user={id:'${ids[n]}'},client={auth:{getSession:async()=>({data:{session:{access_token:user.id}}})},rpc:async()=>({data:null})};
      mountOfficialArcadeGame(document.getElementById('game'),{game:'geoduelo',client,user,soundEnabled:false});
      </script><style>.gm-react-game{height:100%;display:flex;flex-direction:column}.gm-geoduelo-frame{height:100%;flex:1}.gm-geoduelo-frame iframe{border:0;width:100%}</style></body></html>`))
  })}
}]})
let browser
try{
 await server.listen()
 browser=await chromium.launch({headless:true,args:['--no-sandbox']})
 let a=await browser.newPage({viewport:{width:1440,height:900}}),b=await browser.newPage({viewport:{width:390,height:844}})
 const errors=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message))
 await a.goto('http://127.0.0.1:5173/__online?seat=0');await a.getByRole('button',{name:'Online',exact:true}).click()
 await a.getByRole('button',{name:'Buscar rival',exact:true}).waitFor();await a.evaluate(()=>document.fonts.ready)
 await fs.mkdir(root+'.impeccable/review',{recursive:true});await a.screenshot({path:root+'.impeccable/review/online-desktop.png',fullPage:true})
 await b.goto('http://127.0.0.1:5173/__online?seat=1');await b.getByRole('button',{name:'Online',exact:true}).click();await b.evaluate(()=>document.fonts.ready)
 await b.screenshot({path:root+'.impeccable/review/online-mobile.png',fullPage:true})
 assert.equal(await b.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 if(!process.env.MODES_ONLY){
 await a.getByRole('button',{name:'Crear sala privada',exact:true}).click()
 const code=await a.getByRole('status',{name:'Código de sala'}).textContent().catch(()=>a.locator('output').textContent())
 await b.getByLabel('Código de sala',{exact:true}).fill(code.trim());await b.getByRole('button',{name:'Entrar',exact:true}).click()
 try { await a.getByRole('button',{name:'Estoy listo',exact:true}).click({timeout:10000});await b.getByRole('button',{name:'Estoy listo',exact:true}).click({timeout:10000}) }
 catch(e){console.log('A',await a.locator('body').innerText());console.log('B',await b.locator('body').innerText());throw e}
 for(let round=0;round<10;round++){
   await a.getByText(`Ronda ${round+1} de 10 · Capitales`,{exact:true}).waitFor({timeout:15000})
   await b.getByText(`Ronda ${round+1} de 10 · Capitales`,{exact:true}).waitFor({timeout:15000})
   const question=await a.locator('.geo-online-play h2').textContent();const country=question.replace('¿Cuál es la capital de ','').replace(/\?$/,'')
   const correct=capitals.find(c=>c.country===country).capital
   const options=await b.locator('.geo-online-options button').allTextContents();const wrong=options.find(o=>o!==correct)
   await a.getByRole('button',{name:correct,exact:true}).click();await b.getByRole('button',{name:wrong,exact:true}).click()
   await a.getByText(`Respuesta: ${correct}.`,{exact:false}).waitFor()
   if(round===1){
     const previous=a
     a=await browser.newPage({viewport:{width:1440,height:900}})
     a.on('pageerror',e=>errors.push(e.message))
     await a.goto('http://127.0.0.1:5173/__online?seat=0')
     await a.getByRole('button',{name:'Online',exact:true}).click()
     await a.getByRole('button',{name:'Buscar rival',exact:true}).click()
     await previous.getByText('La partida se abrió en otra pestaña.',{exact:false}).waitFor()
     await previous.getByRole('button',{name:'Offline',exact:true}).click()
     await previous.close()
   }
   if(round===0){await a.screenshot({path:root+'.impeccable/review/online-match-desktop.png',fullPage:true});await b.screenshot({path:root+'.impeccable/review/online-match-mobile.png',fullPage:true})}
 }
 await a.getByText('Resultado online guardado en tu cuenta.',{exact:true}).waitFor({timeout:15000})
 assert.equal(runtime_.results.length,1);assert.ok(runtime_.results[0].score_one>900)
 await a.getByRole('button',{name:'Volver a Online',exact:true}).click();await a.getByRole('button',{name:'Buscar rival',exact:true}).waitFor()
 await b.getByRole('button',{name:'Volver a Online',exact:true}).click()
 }
 const modes=['country','cap','place','who','cur','lang','falso','dist','tz','rank','mixto']
 for(const mode of modes){
   if(mode==='country'){
     for(const pattern of ['**/juegos/geoduelo/vendor/d3.v3.min.js','**/juegos/geoduelo/world.json']){
       let failed=false
       await a.route(pattern,route=>{if(!failed){failed=true;return route.fulfill({status:503,body:'Unavailable'})}return route.continue()})
     }
   }
   await a.getByRole('button',{name:'Crear sala privada',exact:true}).click()
   const code=await a.locator('output').textContent()
   await a.getByLabel('Modo de juego',{exact:true}).selectOption(mode,{timeout:8000}).catch(async e=>{console.log('Config body:',await a.locator('body').innerText());throw e})
   await b.getByLabel('Código de sala',{exact:true}).fill(code.trim())
   await b.getByRole('button',{name:'Entrar',exact:true}).click()
   await b.getByLabel('Modo de juego',{exact:true}).waitFor()
   assert.equal(await b.getByLabel('Modo de juego',{exact:true}).isDisabled(),true)
   assert.equal(await b.getByLabel('Modo de juego',{exact:true}).inputValue(),mode)
   if(mode==='country'){
     await a.screenshot({path:root+'.impeccable/review/modes-setup-desktop.png',fullPage:true})
     await b.screenshot({path:root+'.impeccable/review/modes-setup-mobile.png',fullPage:true})
   }
   await a.getByRole('button',{name:'Estoy listo',exact:true}).click();await b.getByRole('button',{name:'Estoy listo',exact:true}).click()
   for(const page of [a,b]){
     await page.locator('.geo-round-meta').filter({hasText:'Ronda 1 de 10'}).first().waitFor()
     const globe=page.frameLocator('iframe.geo-online-globe')
     if(await page.locator('iframe.geo-online-globe').count()){
       if(mode==='country'&&page===a){
         await globe.getByRole('button',{name:'Reintentar mapa',exact:true}).click()
         await globe.getByRole('button',{name:'Reintentar mapa',exact:true}).click()
       }
       await globe.locator('#status').waitFor({state:'hidden'})
       await page.waitForTimeout(100)
     }
     if(mode==='country')await page.screenshot({path:root+`.impeccable/review/modes-globe-${page===a?'desktop':'mobile'}.png`,fullPage:true})
     if(await page.getByRole('button',{name:'Confirmar ubicación',exact:true}).count()){
       await globe.locator('canvas').focus();await page.keyboard.press('Enter')
       await page.getByRole('button',{name:'Confirmar ubicación',exact:true}).click()
     }else if(await page.getByLabel('Tu estimación en kilómetros').count()){
       await page.getByLabel('Tu estimación en kilómetros').fill('1000');await page.getByRole('button',{name:'Confirmar distancia',exact:true}).click()
     }else if(await page.getByRole('button',{name:'Confirmar orden',exact:true}).count()){
       for(const option of await page.locator('.geo-online-options button').all())await option.click()
       await page.getByRole('button',{name:'Confirmar orden',exact:true}).click()
     }else await page.locator('.geo-online-options button').first().click()
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,mode+' overflow')
   }
   await a.getByText('Respuesta:',{exact:false}).waitFor()
   await a.getByRole('button',{name:'Abandonar partida',exact:true}).click()
   await a.getByRole('button',{name:'Crear sala privada',exact:true}).waitFor()
   await b.getByRole('button',{name:'Volver a Online',exact:true}).click()
   console.log('Browser mode passed:',mode)
 }
 await b.getByRole('button',{name:'Offline',exact:true}).click();await b.locator('iframe').waitFor()
 assert.deepEqual(errors,[])
 console.log(process.env.MODES_ONLY ? 'PASS browser: all online modes, host/guest selection, map failure recovery, keyboard, mobile overflow, no JS errors' : 'PASS browser: full 10-round match, final save, reconnect, all online modes, map recovery, local switch, mobile overflow, no JS errors')
}finally{await browser?.close();await server.close();await runtime_.mf.dispose()}
