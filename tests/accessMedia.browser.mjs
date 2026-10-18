import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser=await chromium.launch({headless:true,executablePath:process.env.REVIEW_BROWSER||'/usr/bin/chromium',args:['--no-sandbox']})
const base=process.env.REVIEW_BASE_URL||'http://127.0.0.1:5184'
try {
 for(const mode of ['blocked','pending','reduced','saveData']) {
  const context=await browser.newContext({viewport:{width:1536,height:730},reducedMotion:mode==='reduced'?'reduce':'no-preference'})
  if(mode==='saveData')await context.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true,effectiveType:'4g'}}))
  let videoRequests=0, release
  const errors=[]
  await context.route('**/*.mp4',async route=>{
   videoRequests++
   if(mode==='pending')await new Promise(resolve=>{release=resolve})
   await route.abort()
  })
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+'/login.html',{waitUntil:'domcontentloaded'})
  await page.locator('#studentCode').fill('25101823')
  assert(await page.locator('#studentCode').isEnabled())
  await page.getByRole('button',{name:'Crea tu cuenta',exact:true}).click()
  await page.locator('#registerScreen').waitFor({state:'visible'})
  assert(await page.locator('#registerScreen input').first().isEnabled())
  await page.getByRole('button',{name:'Volver a iniciar sesión',exact:false}).click()
  await page.locator('#forgot').click();await page.locator('#forgotScreen').waitFor({state:'visible'})
  assert(await page.locator('#forgotScreen input').isEnabled())
  assert.equal(await page.evaluate(()=>scrollY),0)
  if(['reduced','saveData'].includes(mode))assert.equal(videoRequests,0)
  else assert(videoRequests>0)
  assert.deepEqual(errors,[])
  release?.();await context.close()
 }
 console.log('PASS forms remain available with blocked/pending video; reduced motion and saveData make no video requests.')
} finally {await browser.close()}
