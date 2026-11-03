import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true, executablePath: process.env.SETUP_BROWSER, args: ['--no-sandbox'] })
const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
async function mount(page) {
  await page.goto(base + '/tests/fixtures/empty.html')
  await page.addStyleTag({ content: `body{margin:0;font:16px system-ui}#app{--txt:#28252f;--ic:#7352a5;--bg:#fff;--panel:#fff;--tile:#f5f3f8;--bar-b:#d0c7dc;--tile-p:#d0c7dc;--sh:#0002;--on:#7352a5;--on-t:#fff}#page{height:calc(100dvh - 32px);overflow:auto;padding:16px}.h-home{max-width:1100px;margin:auto}.blk{padding:24px;background:var(--tile);border-radius:24px;box-sizing:border-box}.h-btn{padding:8px;border:1px solid #ccc;border-radius:12px;background:white}.sample{height:260px}.sample p{overflow-wrap:anywhere}button{cursor:pointer}*{box-sizing:border-box}` })
  await page.evaluate(async () => {
    const { createHomeBoard } = await import('/src/features/home/homeBoard.js')
    document.body.innerHTML = '<div id="app"><div id="menu"></div><main id="page"><div class="h-home" id="home"><section class="h-hero">La paloma permanece fija</section><p class="h-foot">Fin</p></div></main></div>'
    window.saves = []
    const board = createHomeBoard({ owner: () => 'resize-browser', registered: () => true, announce() {}, navigate() {}, onSave: value => window.saves.push(structuredClone(value)) })
    window.homeBoardFixture = board
    const items = ['hoy','stats','notas','racha','semestre','panel'].map(id => {
      const node = document.createElement('section');node.className='blk sample';node.innerHTML='<h2>'+id+'</h2><p>Contenido completo del bloque</p>'
      return { id, name: id, elements: [node], summary: () => ({ value: '16', label: 'Resumen del bloque', detail: 'Los datos se adaptan al espacio disponible.' }) }
    })
    board.mount(document.getElementById('home'), items)
  })
}
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: width === 1440 ? 'no-preference' : 'reduce', hasTouch: width < 600 })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await mount(page)
    await page.getByRole('button', { name: 'Personalizar Inicio', exact: true }).click()
    const block=page.locator('.hw[data-w=stats]'), handle=block.locator('.w-resize')
    await handle.scrollIntoViewIfNeeded();await handle.focus();await handle.press('ArrowLeft')
    await page.waitForFunction(() => document.querySelector('.hw[data-w=stats]').dataset.size === 'custom')
    await handle.press('ArrowDown')
    await page.waitForTimeout(300)
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('lyra-home-layout-v1:resize-browser')))
    assert.equal(saved.frames.stats.span, width === 1440 ? 9 : 6)
    assert.equal(saved.frames.stats.height,284)
    await handle.scrollIntoViewIfNeeded()
    let box=await handle.boundingBox()
    await page.mouse.move(box.x+22,box.y+22);await page.mouse.down();await page.mouse.move(box.x-100,box.y+110,{steps:8})
    await page.waitForFunction(()=>document.querySelector('.hw[data-w=stats]').dataset.resizing==='true')
    assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('lyra-home-layout-v1:resize-browser')))).frames.stats.height,284,'A gesture saves only after release')
    await page.mouse.up()
    const resized=await page.evaluate(()=>JSON.parse(localStorage.getItem('lyra-home-layout-v1:resize-browser')))
    assert(resized.frames.stats.height>saved.frames.stats.height)
    await page.getByRole('button',{name:'Deshacer · Tamaño',exact:true}).click()
    assert.deepEqual((await page.evaluate(()=>JSON.parse(localStorage.getItem('lyra-home-layout-v1:resize-browser')))).frames.stats,saved.frames.stats)
    await handle.scrollIntoViewIfNeeded();await page.waitForTimeout(300);box=await handle.boundingBox()
    await page.mouse.move(box.x+22,box.y+22);await page.mouse.down();await page.mouse.move(box.x+100,box.y+90,{steps:5})
    await page.waitForFunction(()=>document.querySelector('.hw[data-w=stats]').dataset.resizing==='true')
    await page.keyboard.press('Escape');await page.mouse.up()
    assert.deepEqual((await page.evaluate(()=>JSON.parse(localStorage.getItem('lyra-home-layout-v1:resize-browser')))).frames.stats,saved.frames.stats)
    if(width===390){
      await handle.scrollIntoViewIfNeeded();box=await handle.boundingBox()
      const touch=await context.newCDPSession(page),x=box.x+22,y=box.y+22
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]})
      await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+70}]})
      await page.waitForFunction(()=>document.querySelector('.hw[data-w=stats]').dataset.resizing==='true')
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach()
      assert((await page.evaluate(()=>JSON.parse(localStorage.getItem('lyra-home-layout-v1:resize-browser')))).frames.stats.height>saved.frames.stats.height)
      await page.getByRole('button',{name:'Deshacer · Tamaño',exact:true}).click()
    }
    await page.getByRole('button',{name:'Restablecer diseño',exact:true}).click()
    assert.equal(await block.getAttribute('data-size'),'wide')
    await page.getByRole('button',{name:'Deshacer · Diseño',exact:true}).click()
    assert.equal(await block.getAttribute('data-size'),'custom')
    await block.locator('.w-options').click();await page.locator('[data-home-size=medium]').click()
    assert.equal(await block.getAttribute('data-size'),'medium')
    await page.getByRole('button',{name:'Listo',exact:true}).click()
    assert.equal(await handle.isVisible(),false)
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    await mount(page)
    assert.equal(await page.locator('.hw[data-w=stats]').getAttribute('data-size'),'medium')
    await page.getByRole('button',{name:'Personalizar Inicio',exact:true}).click()
    await handle.focus();for(let step=0;step<4;step++)await handle.press('ArrowDown')
    await page.evaluate(()=>window.homeBoardFixture.reveal('stats'))
    assert.equal(await block.getAttribute('data-size'),'wide')
    await page.waitForTimeout(300)
    const fullHeight=await block.locator('.hw-content').evaluate(node=>node.getBoundingClientRect().height)
    await handle.focus();await handle.press('ArrowDown')
    const afterReveal=await page.evaluate(()=>JSON.parse(localStorage.getItem('lyra-home-layout-v1:resize-browser')).frames.stats.height)
    assert.equal(afterReveal,Math.round(fullHeight)+24,'After expanding a block, resize must start from its visible size')
    assert.deepEqual(errors,[])
    await context.close()
  }
  console.log('PASS: live resize, keyboard sizes, commit on release, Escape, undo, reset, presets and reload at 1440/390/320px')
} finally { await browser.close() }
