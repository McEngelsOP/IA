// Vite: fixture URL/key only. All Auth/Data calls are intercepted, never live.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const require = createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? `${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/fixture.cjs` : import.meta.url)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless:true, executablePath:process.env.SETUP_BROWSER, args:['--no-sandbox'] })
const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
const output = process.env.HOME_SCREENSHOTS
if (output) await mkdir(output, { recursive:true })
const now = Date.now(), authKey = 'sb-setup-fixture-auth-token', sessionId = 'home-companion-fixture'
const user = { id:'11111111-1111-4111-8111-111111111111', aud:'authenticated', role:'authenticated', email:'fixture@example.invalid', app_metadata:{ provider:'email' }, user_metadata:{ carrera:'ia' }, created_at:new Date(now).toISOString() }
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const session = { access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,session_id:sessionId,exp:Math.floor(now/1000)+86400,role:'authenticated'})}.fixture`, refresh_token:'fixture', expires_at:Math.floor(now/1000)+86400, expires_in:86400, token_type:'bearer', user }
const errors = []
async function fixture({ alias='Engels', width=1440, dark=false, reduced=false, authenticated=true } = {}) {
  const context = await browser.newContext({ viewport:{width,height:1000}, isMobile:width<=860, hasTouch:width<=860, colorScheme:dark?'dark':'light', reducedMotion:reduced?'reduce':'no-preference' })
  const reads = []
  if (authenticated) await context.addInitScript(({session,authKey,sessionId,now}) => {
    localStorage.setItem(authKey, JSON.stringify(session))
    localStorage.setItem(`${authKey}:web-activity:v1:${sessionId}`, JSON.stringify({at:now}))
  }, {session,authKey,sessionId,now})
  await context.route('https://setup-fixture.supabase.co/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    let data = []
    if (path === '/auth/v1/user') data = user
    else if (path.endsWith('/profiles')) { reads.push(url); data = [{ alias, carrera:'ia', created_at:user.created_at }] }
    else if (path.endsWith('/progress')) data = [{ done:['calc1'], plan:[] }]
    else if (path.endsWith('/grades')) data = [{ course_id:'calc1', grade:16 }]
    else if (path.endsWith('/course_status')) data = [{ course_id:'calc1', status:'llevado' }, {course_id:'fis1',status:'matriculado'}]
    else if (path.endsWith('/student_setup')) data = [{completed_at:new Date(now).toISOString(),preferences:{},draft:{}}]
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({time:now}); await page.clock.pauseAt(now)
  await page.goto(`${base}/pagina.html`)
  if (authenticated) await page.locator('.hoy').waitFor()
  else await page.locator('#home-hero-title').waitFor()
  return { context, page, reads }
}
async function shot(page, name) {
  if (output) { await page.waitForTimeout(650); await page.screenshot({path:`${output}/${name}.png`}) }
}
try {
  const { context, page, reads } = await fixture()
  assert.equal(await page.locator('#home-hero-title').innerText(), 'Tu avance, Engels.')
  assert(reads.some(url => url.searchParams.get('select').split(',').includes('alias')))
  assert.equal(await page.locator('.pal-companion').count(), 1)
  assert.equal(await page.locator('.pal-companion button').count(), 0)
  assert.equal(await page.locator('#bHide').isVisible(), false)
  await shot(page, 'desktop')
  const phases = [[2500,'sip'],[2900,'idle'],[1300,'walk'],[4500,'idle'],[1400,'alert'],[2300,'idle'],[1400,'ok'],[3200,'idle'],[2200,'idle'],[2400,'sip']]
  for (const [ms, state] of phases) {
    await page.clock.runFor(ms)
    assert.equal(await page.locator('#h-pal').getAttribute('data-s'), state)
  }
  await page.locator('#page').evaluate(el => el.scrollTop = 900); await page.waitForTimeout(100)
  assert.equal(await page.locator('#h-pal').getAttribute('data-offscreen'), 'true')
  const stopped = await page.locator('#h-pal').getAttribute('data-s')
  await page.clock.runFor(15000)
  assert.equal(await page.locator('#h-pal').getAttribute('data-s'), stopped)
  await page.locator('#page').evaluate(el => el.scrollTop = 0); await page.waitForTimeout(100)
  assert.equal(await page.locator('#h-pal').getAttribute('data-offscreen'), 'false')
  await page.locator('#bRail').click()
  assert.equal(await page.locator('#app').getAttribute('data-side'), 'rail')
  assert(await page.locator('#side').isVisible())
  assert(await page.locator('#nav>.it').count() >= 5)
  assert.equal(await page.locator('#trig').isVisible(), false)
  await page.locator('#brand').click()
  assert.equal(await page.locator('#app').getAttribute('data-side'), 'full')
  await page.locator('#bHide').evaluate(el => el.click())
  assert.equal(await page.locator('#app').getAttribute('data-side'), 'rail', 'desktop cannot enter hidden mode')
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.locator('#app').getAttribute('data-side'), 'hidden')
  await page.locator('#trig').click()
  assert(await page.locator('#brand .lyra-logo-full').isVisible())
  await page.locator('#bHide').click()
  await page.setViewportSize({width:1440,height:1000})
  assert.equal(await page.locator('#app').getAttribute('data-side'), 'rail')
  await context.close()
  for (const [width, dark, reduced] of [[390,false,false],[320,true,false],[390,false,true]]) {
    const f = await fixture({width,dark,reduced})
    assert.equal(await f.page.locator('#home-hero-title').innerText(), 'Tu avance, Engels.')
    assert(await f.page.locator('#trig .lyra-logo-trigger').isVisible())
    assert(await f.page.locator('#page').evaluate(el => el.scrollWidth <= el.clientWidth+1))
    const fits = await f.page.locator('.pal-companion').evaluate(el => {
      const box = el.getBoundingClientRect(), bubble = el.querySelector('.pal-bubble').getBoundingClientRect()
      return bubble.left >= box.left-2 && bubble.right <= box.right+2
    })
    assert(fits, 'dialogue stays inside the companion area')
    if (reduced) assert.equal(await f.page.locator('.pal-body').evaluate(el => getComputedStyle(el).animationName), 'none')
    await shot(f.page, `mobile-${width}-${dark?'dark':'light'}-${reduced?'reduce':'motion'}`)
    await f.page.locator('#trig').click()
    assert(await f.page.locator('#brand .lyra-logo-full').isVisible())
    await f.context.close()
  }
  for (const alias of ['', 'Nube & <img src=x onerror=alert(1)>']) {
    const f = await fixture({alias,width:390})
    assert.equal(await f.page.locator('#home-hero-title').innerText(), alias?`Tu avance, ${alias}.`:'Tu avance')
    assert.equal(await f.page.locator('#home-hero-title img').count(), 0, 'alias is escaped')
    assert(await f.page.locator('#page').evaluate(el => el.scrollWidth <= el.clientWidth+1))
    await f.context.close()
  }
  const guest = await fixture({authenticated:false})
  assert.equal(await guest.page.locator('#home-hero-title').innerText(), 'Tu avance')
  assert.equal(guest.reads.length, 0)
  await guest.context.close()
  const mobile = await browser.newPage({viewport:{width:390,height:844}})
  mobile.on('pageerror', error => errors.push(error.message))
  await mobile.goto(`${base}/ios-android.html`)
  assert(await mobile.locator('#trig .lyra-logo-trigger').isVisible())
  await mobile.close()
  assert.deepEqual(errors, [])
  console.log('PASS: alias from profile, escaped/empty/guest names, full automatic loop, offscreen pause/resume, desktop full/rail only, responsive drawer, Lyra logos and reduced motion.')
} finally { await browser.close() }
