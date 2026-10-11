// Run against Vite with VITE_SUPABASE_URL=https://setup-fixture.supabase.co
// and a fixture anon key. All Auth/Data requests are intercepted, never live.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? `${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/fixture.cjs` : import.meta.url)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, executablePath: process.env.SETUP_BROWSER, args: ['--no-sandbox'] })
const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
const authKey = 'sb-setup-fixture-auth-token', sessionId = 'idle-fixture', time = Date.now(), minute = 60000
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', app_metadata: { provider: 'email' }, user_metadata: { carrera: 'ia' }, created_at: new Date(time).toISOString() }
const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url')
const session = { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, session_id: sessionId, exp: Math.floor(time / 1000) + 86400, role: 'authenticated' })}.fixture`, refresh_token: 'fixture', expires_at: Math.floor(time / 1000) + 86400, expires_in: 86400, token_type: 'bearer', user }
const errors = []
async function fixture(age = 0, seed = true, offline = false) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })
  const reads = [], logouts = []
  await context.addInitScript(({ session, authKey, sessionId, at, seed }) => {
    if (localStorage.getItem('fixture-seeded')) return
    localStorage.setItem('fixture-seeded', '1')
    if (seed) {
      localStorage.setItem(authKey, JSON.stringify(session))
      if (at !== null) localStorage.setItem(`${authKey}:web-activity:v1:${sessionId}`, JSON.stringify({ at }))
    }
  }, { session, authKey, sessionId, at: age === null ? null : time - age, seed })
  await context.route('https://setup-fixture.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    let data = [], status = 200
    if (path === '/auth/v1/user') data = user
    else if (path === '/auth/v1/logout') {
      logouts.push(url.searchParams.get('scope'))
      if (offline) { await route.abort(); return }
      await route.fulfill({ status: 204 }); return
    } else if (path.endsWith('/functions/v1/auth-by-code')) data = { ok: true, session }
    else if (path.startsWith('/rest/')) {
      reads.push(path)
      if (path.endsWith('/profiles')) data = [{ carrera: 'ia', created_at: user.created_at }]
      else if (path.endsWith('/progress')) data = [{ done: ['calc1'], plan: ['fis1'] }]
      else if (path.endsWith('/student_setup')) data = [{ completed_at: new Date(time).toISOString(), preferences: {}, draft: {} }]
      else if (path.endsWith('/rpc/focus_daily_summary')) data = { seconds: 0, completed_count: 0, interrupted_count: 0 }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  })
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message))
  await page.clock.install({ time })
  return { context, page, reads, logouts }
}
async function expired(f) {
  await f.page.waitForURL(/login\.html\?reason=inactivity/)
  await f.page.getByText('Tu sesión se cerró tras 30 minutos sin actividad.', { exact: false }).waitFor()
  assert.equal(await f.page.evaluate(key => localStorage.getItem(key), authKey), null)
  assert.equal(await f.page.locator('#studentCode').isEnabled(), true)
  assert(f.logouts.every(scope => scope === 'local'))
}
try {
  // Returning directly to either entry after seven hours exposes no private reads.
  for (const entry of ['pagina.html', 'login.html']) {
    const f = await fixture(7 * 3600000); await f.page.goto(`${base}/${entry}`); await expired(f)
    assert.equal(f.reads.length, 0, 'stale session must not load academic data')
    await f.context.close()
  }
  // Existing sessions with no activity record require a fresh login once.
  const legacy = await fixture(null); await legacy.page.goto(`${base}/pagina.html`); await expired(legacy); assert.equal(legacy.reads.length, 0); await legacy.context.close()
  const fresh = await fixture(0, false); await fresh.page.goto(`${base}/login.html`)
  await fresh.page.locator('#studentCode').waitFor({ state: 'visible' })
  await fresh.page.waitForFunction(() => !document.getElementById('studentCode').disabled)
  await fresh.page.locator('#studentCode').fill('25100000'); await fresh.page.locator('#password').fill('fixture-password')
  await fresh.page.locator('#loginForm [type=submit]').click(); await fresh.page.waitForURL(/pagina\.html/)
  await fresh.page.locator('#h-tab-graficos').waitFor()
  assert(fresh.reads.length > 0)
  await fresh.page.clock.fastForward(29 * minute); await fresh.page.keyboard.press('Tab')
  await fresh.page.clock.fastForward(29 * minute); assert.match(fresh.page.url(), /pagina\.html/)
  await fresh.page.clock.fastForward(minute + 100); await expired(fresh); await fresh.context.close()
  // Reload preserves the old deadline rather than granting another 30 minutes.
  const reload = await fixture(25 * minute); await reload.page.goto(`${base}/pagina.html`); await reload.page.locator('#h-tab-graficos').waitFor()
  await reload.page.reload(); await reload.page.locator('#h-tab-graficos').waitFor()
  await reload.page.clock.fastForward(5 * minute + 100); await expired(reload); await reload.context.close()
  // Even a network failure at logout clears the browser credentials.
  const offline = await fixture(0, true, true); await offline.page.goto(`${base}/pagina.html`); await offline.page.locator('#h-tab-graficos').waitFor()
  await offline.page.clock.fastForward(30 * minute + 2000); await expired(offline); await offline.context.close()
  assert.deepEqual(errors, [])
  console.log('PASS web session browser: fresh login, 30-minute idle, trusted activity, seven-hour return, legacy session, reload deadline, offline logout; no private reads before reauthentication')
} finally { await browser.close() }
