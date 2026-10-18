import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')
const { PGlite } = require(process.env.PGLITE_PATH || '@electric-sql/pglite')
const root = new URL('../', import.meta.url).pathname
const db = new PGlite()
const uid = '10000000-0000-4000-8000-000000000001'
await db.exec(`create role anon;create role authenticated;create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table profiles(id uuid primary key,alias text);
  insert into auth.users values('${uid}');insert into profiles values('${uid}','Cuenta de prueba');
  set request.jwt.claim.sub='${uid}';`)
await db.exec(await fs.readFile(root + 'supabase/arcade.sql', 'utf8'))
for (let i = 0; i < 2; i++) await db.exec(await fs.readFile(root + 'supabase/geoduelo.sql', 'utf8'))
const calls = []
let rankEnabled = false
const server = await createServer({ root, configFile: root + 'vite.config.js', server: { host: '127.0.0.1', port: 5189 }, plugins: [{
  name: 'geoduelo-test-fixture',
  configureServer(server) {
    server.middlewares.use('/__geo-rpc', async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk
      const { name, args } = JSON.parse(body)
      calls.push({ name, args })
      res.setHeader('Content-Type', 'application/json')
      try {
        if (name === 'submit_game_score' && !rankEnabled) throw new Error('BAD_GAME')
        const query = name === 'my_game_score' ? 'select public.my_game_score($1) as score' : 'select public.submit_game_score($1,$2) as score'
        const { rows } = await db.query(query, name === 'my_game_score' ? [args.g] : [args.g, args.s])
        res.end(JSON.stringify({ data: rows[0].score, error: null }))
      } catch (e) { res.end(JSON.stringify({ data: null, error: { message: e.message } })) }
    })
    server.middlewares.use('/__geo-test', async (req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end(await server.transformIndexHtml('/__geo-test', `<html><head></head><body><div id="game" style="height:700px"></div><script type="module">
        import {mountOfficialArcadeGame} from '/src/components/OfficialArcadeGame.jsx';
        const client={auth:{getUser:async()=>({data:{user:{id:'${uid}'}}})},rpc:async(name,args)=>fetch('/__geo-rpc',{method:'POST',body:JSON.stringify({name,args})}).then(r=>r.json())};
        window.destroyGame=mountOfficialArcadeGame(document.querySelector('#game'),{game:'geoduelo',client,user:{id:'${uid}'},playerName:'Cuenta de prueba',soundEnabled:false});
        addEventListener('message',e=>{if(e.data?.action==='complete')window.lastComplete=e.data;});
      </script><style>.gm-react-game{height:100%;display:flex;flex-direction:column}.gm-geoduelo-frame{flex:1;min-height:0}.gm-geoduelo-frame iframe{height:100%;width:100%;border:0}</style></body></html>`))
    })
  }
}] })
await server.listen()
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  page.on('pageerror', e => console.error('Browser:', e.message))
  let failMap = true
  await page.route('**/juegos/geoduelo/world.json', async route => { if (failMap) { failMap = false; await route.abort() } else await route.continue() })
  await page.route('**/juegos/geoduelo/index.html', async route => {
    let html = await fs.readFile(root + 'public/juegos/geoduelo/index.html', 'utf8')
    html = html.replace('bind();ui();', 'window.__geo={G,curItem};bind();ui();')
    await route.fulfill({ body: html, contentType: 'text/html' })
  })
  await page.goto('http://127.0.0.1:5189/__geo-test')
  await page.locator('iframe').waitFor()
  const f = await page.locator('iframe').contentFrame().locator('body').evaluateHandle(el => el.ownerDocument.defaultView).then(async h => {
    await h.dispose()
    return page.frames().find(f => f.url().includes('geoduelo/index.html'))
  })
  await f.locator('#load-err').waitFor()
  await f.locator('#bRetry').click()
  await f.locator('#m-menu').waitFor()
  assert.equal(await f.locator('#n0').inputValue(), 'Cuenta de prue')
  await f.locator('[data-cat="elegir"]').click()
  await f.locator('[data-mode="who"]').click()
  await f.locator('label[for="r5"]').click()
  await f.locator('#setup button[type="submit"]').click()
  for (let i = 0; i < 10; i++) {
    if (i % 2) await f.locator('[data-bet="3"]').click()
    await f.locator('[data-act="reveal"]').click()
    if (i === 4 || i === 8) await f.locator('#bPass').click()
    else { const index = await f.evaluate(() => __geo.curItem().opts.findIndex(o => o.ok)); await f.locator(`.opt[data-i="${index}"]`).click() }
    await f.locator('[data-act="next"]').click()
  }
  await page.getByText('El ranking de Geoduelo aún no está habilitado.', { exact: false }).waitFor()
  const scores = await f.evaluate(() => __geo.G.players.map(p => p.score))
  assert.ok(scores[1] > scores[0], 'The guest must win the fixture')
  const submits = () => calls.filter(c => c.name === 'submit_game_score')
  assert.deepEqual(submits()[0].args, { g: 'geoduelo', s: scores[0] })
  const message = await page.evaluate(() => window.lastComplete)
  await f.evaluate(m => parent.postMessage(m, location.origin), message)
  await page.evaluate(m => postMessage({ ...m, matchId: 'foreign-source' }, location.origin), message)
  await f.evaluate(m => parent.postMessage({ ...m, session: 'foreign-session', matchId: 'foreign-session' }, location.origin), message)
  await page.waitForTimeout(100)
  assert.equal(submits().length, 1, 'Duplicates and messages from other sources are ignored')
  rankEnabled = true
  await page.getByRole('button', { name: 'Reintentar guardado' }).click()
  await page.getByText('Puntaje guardado en la temporada actual.', { exact: false }).waitFor()
  assert.equal(submits().length, 2)
  const saved = (await db.query('select game,score,alias,season from game_scores')).rows
  assert.equal(saved.length, 1)
  assert.equal(saved[0].score, scores[0])
  assert.equal(saved[0].alias, 'Cuenta de prueba')
  // Existing games retain their RPC behavior, scores preserve the season maximum.
  for (const game of ['dino', 'galaxia', 'memoria']) await db.query('select submit_game_score($1,$2)', [game, 123])
  await db.query('select submit_game_score($1,$2)', ['geoduelo', 1])
  assert.equal((await db.query("select score from game_scores where game='geoduelo'")).rows[0].score, scores[0])
  assert.equal((await db.query("select has_function_privilege('anon','submit_game_score(text,integer)','EXECUTE') as access")).rows[0].access, false)
  assert.equal((await db.query("select has_column_privilege('authenticated','game_scores','student_id','SELECT') as access")).rows[0].access, false)
  await page.evaluate(() => window.destroyGame())
  assert.equal(await page.locator('iframe').count(), 0)
  console.log(JSON.stringify({ passed: ['manual SQL idempotency', 'map recovery', 'seat 1 attribution', 'failed save and retry', 'message validation and deduplication', 'guest privacy', 'season maximum', 'existing games', 'SQL permissions', 'unmount cleanup'], scores, saved }, null, 2))
} finally { await browser.close(); await server.close(); await db.close() }
