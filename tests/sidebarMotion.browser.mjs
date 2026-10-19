// Run against Vite with fixture-only Supabase credentials; no account required.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const require = createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? `${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/fixture.cjs` : import.meta.url)
const { chromium } = require('playwright')
const browser = await chromium.launch({headless:true,executablePath:process.env.SETUP_BROWSER,args:['--no-sandbox']})
const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
const output = process.env.SIDEBAR_SCREENSHOTS
if (output) await mkdir(output,{recursive:true})
const errors = []
async function open(width=1440,reduced=false,dark=false) {
  const page = await browser.newPage({viewport:{width,height:1000},reducedMotion:reduced?'reduce':'no-preference',colorScheme:dark?'dark':'light'})
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('https://setup-fixture.supabase.co/**',route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}))
  await page.goto(`${base}/pagina.html`)
  await page.locator('#nav>.it').first().waitFor()
  await page.waitForTimeout(500)
  return page
}
async function shot(page,name) {
  if (output) await page.screenshot({path:`${output}/${name}.png`})
}
async function sampleToggle(page,selector) {
  return page.evaluate(async selector=>{
    const start=performance.now(),frames=[]
    document.querySelector(selector).click()
    await new Promise(resolve=>{
      function frame(now) {
        frames.push({time:now-start,width:document.querySelector('#side').getBoundingClientRect().width,padding:parseFloat(getComputedStyle(document.querySelector('#page')).paddingLeft),top:document.querySelector('#top').getBoundingClientRect().left,icon:document.querySelector('#nav .ic').getBoundingClientRect().left})
        if(now-start<500)requestAnimationFrame(frame);else resolve()
      }
      requestAnimationFrame(frame)
    })
    return frames
  },selector)
}
try {
  const page=await open()
  await shot(page,'desktop-full')
  await page.locator('#bRail').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  assert.equal(await page.locator('#app').getAttribute('data-side'),'rail')
  assert.equal(await page.evaluate(()=>document.activeElement.id),'brand')
  assert.equal(await page.locator('#bRail').isVisible(),false)
  assert.equal(await page.locator('#nav>.it').first().evaluate(el=>getComputedStyle(el.querySelector('.l')).visibility),'hidden')
  await shot(page,'desktop-rail')
  for (const [selector,closing] of [['#brand',false],['#bRail',true]]) {
    const frames=await sampleToggle(page,selector)
    assert(frames.some(f=>f.width>80&&f.width<270),'panel must pass through intermediate widths')
    assert(frames.every(f=>Math.abs(f.padding-f.width-24)<1),'content and sidebar stay synchronized')
    assert(frames.every(f=>Math.abs(f.top-f.padding)<1),'header follows the same curve')
    assert(Math.max(...frames.map(f=>f.icon))-Math.min(...frames.map(f=>f.icon))<3,'icons do not jump to a different alignment')
    for(let i=1;i<frames.length;i++)assert(closing?frames[i].width<=frames[i-1].width+.1:frames[i].width>=frames[i-1].width-.1,'motion does not overshoot')
    assert(Math.abs(frames.at(-1).width-(closing?72:280))<1)
    console.log(`${closing?'collapse':'expand'}: ${frames.length} frames, max frame gap ${Math.round(Math.max(...frames.slice(1).map((f,i)=>f.time-frames[i].time)))}ms`)
  }
  // Interrupt twice before either transition finishes; CSS resumes from the current geometry.
  await page.locator('#brand').evaluate(el=>el.click())
  await page.waitForTimeout(65)
  await page.locator('#bRail').evaluate(el=>el.click())
  await page.waitForTimeout(65)
  await page.locator('#brand').evaluate(el=>el.click())
  await page.waitForTimeout(500)
  assert.equal(await page.locator('#side').evaluate(el=>el.getBoundingClientRect().width),280)
  assert.equal(await page.locator('#nav>.it').first().evaluate(el=>getComputedStyle(el.querySelector('.l')).visibility),'visible')
  const group=page.locator('#nav>.it[aria-expanded]').first()
  await group.click()
  await page.waitForTimeout(500)
  await page.locator('#bRail').click()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('#nav .sub button').first().isVisible(),false)
  await page.locator('#brand').click()
  await page.waitForTimeout(500)
  assert.equal(await group.getAttribute('aria-expanded'),'true')
  assert.equal(await page.locator('#nav .sub button').first().isVisible(),true)
  await page.close()

  for(const [width,dark] of [[390,false],[320,true],[860,false]]) {
    const mobile=await open(width,false,dark)
    assert.equal(await mobile.locator('#app').getAttribute('data-side'),'hidden')
    assert.equal(await mobile.locator('#side').evaluate(el=>el.inert),true)
    const frames=await mobile.evaluate(async()=>{
      document.querySelector('#trig').click()
      const values=[];const start=performance.now()
      await new Promise(resolve=>{function frame(t){const el=document.querySelector('#side'),style=getComputedStyle(el);values.push({opacity:Number(style.opacity),matrix:style.transform,filter:style.filter});if(t-start<430)requestAnimationFrame(frame);else resolve()}requestAnimationFrame(frame)})
      return values
    })
    assert(frames.some(f=>f.opacity>0&&f.opacity<1),'drawer fades gradually')
    assert(frames.every(f=>f.filter==='none'),'drawer does not animate blur')
    assert.equal(await mobile.locator('#page').evaluate(el=>el.inert),true)
    assert(await mobile.locator('#brand .lyra-logo-full').isVisible())
    assert(await mobile.locator('#side').evaluate(el=>el.scrollWidth<=el.clientWidth+1))
    await shot(mobile,`mobile-${width}`)
    await mobile.keyboard.press('Escape')
    await mobile.waitForTimeout(350)
    assert.equal(await mobile.evaluate(()=>document.activeElement.id),'trig')
    assert.equal(await mobile.locator('#side').evaluate(el=>el.inert),true)
    assert.equal(await mobile.locator('#page').evaluate(el=>el.inert),false)
    await mobile.setViewportSize({width:1440,height:1000})
    await mobile.waitForTimeout(500)
    assert.equal(await mobile.locator('#app').getAttribute('data-side'),'full')
    assert.equal(await mobile.locator('#side').evaluate(el=>el.getBoundingClientRect().width),280)
    await mobile.close()
  }
  for(const width of [1440,390]) {
    const reduced=await open(width,true)
    await reduced.locator(width>860?'#bRail':'#trig').click()
    assert.equal(await reduced.locator('#side').evaluate(el=>getComputedStyle(el).transitionDuration),'0s')
    if(width>860)assert.equal(await reduced.locator('#side').evaluate(el=>el.getBoundingClientRect().width),72)
    await reduced.close()
  }
  assert.deepEqual(errors,[])
  console.log('PASS: synchronized intermediate geometry, anchored icons, interruption, keyboard focus, submenus, responsive drawer, themes and reduced motion.')
}finally{await browser.close()}
