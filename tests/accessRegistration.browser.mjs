import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
const shots = process.env.ACCESS_REVIEW_DIR || '/tmp/lyra-registration-review'
await mkdir(shots, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.SETUP_BROWSER, args: ['--no-sandbox'] })
const errors = [], catalog = [
  { id: 'esan', name: 'Universidad ESAN', careers: [] },
  { id: 'u-known', name: 'Universidad de Prueba', careers: ['Ingeniería', 'Medicina'] },
  { id: 'u-empty', name: 'Universidad sin carreras publicadas', careers: [] },
]
async function fixture(width, height, failCatalog = false) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', hasTouch: width <= 860 })
  const calls = [], flags = { failCatalog }
  await context.route('https://setup-fixture.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().postDataJSON()
    calls.push({ path, body })
    let data = {}, status = 200
    if (path.endsWith('/rpc/registration_universities')) {
      data = flags.failCatalog ? { message: 'fixture unavailable', code: 'PGRST202' } : catalog
      status = flags.failCatalog ? 404 : 200
    } else if (path.endsWith('/rpc/search_universities')) data = []
    else if (path === '/auth/v1/signup') data = { user: { id: 'fixture', identities: [{ id: 'fixture' }] }, session: null }
    else if (path === '/auth/v1/token') { data = { error: 'invalid_grant', error_description: 'Invalid login credentials' }; status = 400 }
    else if (path.endsWith('/auth-by-code')) data = { ok: false, error: 'invalid_credentials' }
    else if (path !== '/auth/v1/recover') throw new Error('Unexpected auth request: ' + path)
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base + '/login.html')
  await page.waitForFunction(() => !document.querySelector('#studentCode').disabled)
  return { context, page, calls, flags }
}
async function register(page) {
  await page.locator('[data-view="registerScreen"]').click()
  await page.waitForFunction(() => document.querySelector('#universityLookup').hidden || !document.querySelector('#retryUniversities').hidden)
}
async function credentials(page, email) {
  await page.locator('#registerEmail').fill(email)
  await page.locator('#registerPassword').fill('fixture-pass12!')
  await page.locator('#registerConfirm').fill('fixture-pass12!')
}
async function submit(page, calls) {
  await page.locator('#registerForm [type="submit"]').click()
  await page.locator('#mailScreen:not([hidden])').waitFor()
  return calls.find(call => call.path === '/auth/v1/signup').body
}
async function geometry(page, width) {
  const result = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.register-group')].map(el => el.getBoundingClientRect().toJSON())
    const panel = document.querySelector('.panel').getBoundingClientRect()
    return { groups, panel: panel.toJSON(), noOverflow: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight }
  })
  assert(result.noOverflow, JSON.stringify(result))
  assert(result.panel.left >= 0 && result.panel.right <= width, JSON.stringify(result))
  if (width >= 1024) {
    assert(Math.abs(result.groups[0].top - result.groups[1].top) <= 1)
    assert(result.groups[1].left - result.groups[0].right >= 32)
  } else assert(result.groups[1].top > result.groups[0].bottom)
  for (const input of await page.locator('#registerForm input:visible, #registerForm select:visible, #registerForm [type="submit"]').all()) {
    await input.scrollIntoViewIfNeeded()
    const box = await input.boundingBox()
    assert(box.height >= 44 && box.y >= 0 && box.y + box.height <= page.viewportSize().height, JSON.stringify(box))
  }
  await page.locator('.stage').evaluate(el => { el.scrollTop = 0 })
}
try {
  for (const [width, height] of [[1920,1080],[1536,730],[1366,657],[1024,600],[768,1024],[390,844],[360,640]]) {
    const { context, page, calls } = await fixture(width, height)
    assert.equal(await page.locator('label[for="studentCode"]').textContent(), 'Código o correo')
    await page.locator('#forgot').click()
    assert.equal(await page.locator('label[for="recoveryCode"]').textContent(), 'Código o correo')
    await page.locator('#forgotScreen [data-view="loginScreen"]').click()
    await register(page)
    assert.equal(await page.locator('label[for="registerUniversityType"]').textContent(), 'Universidad')
    assert.deepEqual(await page.locator('#registerUniversityType option').evaluateAll(els => els.map(el => el.value)), ['esan','u-known','u-empty','other'])
    await geometry(page, width)
    if (width === 1536) await page.screenshot({ path: shots + '/registration-desktop.png' })
    await page.locator('#registerUniversityType').selectOption('u-known')
    assert.equal(await page.locator('#registerUniversity').isVisible(), false)
    assert.equal(await page.locator('#registerExternalCareer').isVisible(), false)
    await page.locator('#registerKnownCareer').selectOption('Medicina')
    await credentials(page, 'student@example.invalid')
    const known = await submit(page, calls)
    assert.deepEqual(known.data, { institution_id: 'other', university_name: 'Universidad de Prueba', external_career: 'Medicina' })
    await context.close()
    const manual = await fixture(width, height)
    await register(manual.page)
    await manual.page.locator('#registerUniversityType').selectOption('other')
    assert(await manual.page.locator('#registerUniversity').isVisible())
    assert(await manual.page.locator('#registerExternalCareer').isVisible())
    assert.equal(await manual.page.locator('#registerCode').isVisible(), false)
    await manual.page.locator('#registerUniversity').fill('Universidad Nueva')
    await manual.page.locator('#registerExternalCareer').fill('Enfermería')
    await credentials(manual.page, 'new@example.invalid')
    await geometry(manual.page, width)
    if (width === 390 || width === 1536) await manual.page.screenshot({ path: `${shots}/registration-other-${width}.png` })
    const other = await submit(manual.page, manual.calls)
    assert.equal(other.data.university_name, 'Universidad Nueva')
    assert.equal(other.data.external_career, 'Enfermería')
    await manual.context.close()
    console.log(`PASS registration, catalog, manual entry and viewport ${width}x${height}`)
  }
  const { context, page, calls, flags } = await fixture(1536, 730, true)
  await register(page)
  assert(await page.locator('#retryUniversities').isVisible())
  await page.locator('#registerUniversityType').selectOption('other')
  await page.locator('#registerUniversity').fill('Datos conservados')
  flags.failCatalog = false
  await page.locator('#retryUniversities').click()
  await page.waitForFunction(() => document.querySelector('#universityLookup').hidden)
  assert.equal(await page.locator('#registerUniversity').inputValue(), 'Datos conservados')
  assert.equal(await page.locator('#registerUniversityType').inputValue(), 'other')
  await page.locator('#registerUniversityType').selectOption('u-known')
  await page.locator('#registerKnownCareer').selectOption('other')
  assert(await page.locator('#registerExternalCareer').isVisible())
  await page.locator('#registerUniversityType').selectOption('u-empty')
  assert(await page.locator('#registerExternalCareer').isVisible())
  await page.locator('#registerUniversityType').selectOption('esan')
  assert.equal(await page.locator('#registerUniversity').isVisible(), false)
  await page.locator('#registerCode').fill('25101823')
  await page.locator('#registerCareer').selectOption('ia')
  await credentials(page, 'student@ue.edu.pe')
  const esan = await submit(page, calls)
  assert.equal(esan.data.student_code, '25101823')
  assert.equal(esan.data.carrera, 'ia')
  assert.equal(esan.data.institution_id, 'esan')
  await context.close()
  const recovery = await fixture(390, 844)
  await recovery.page.locator('#forgot').click()
  await recovery.page.locator('#recoveryCode').fill('student@example.invalid')
  await recovery.page.locator('#forgotForm [type="submit"]').click()
  await recovery.page.locator('#mailScreen:not([hidden])').waitFor()
  assert.equal(recovery.calls.find(call => call.path === '/auth/v1/recover').body.email, 'student@example.invalid')
  await recovery.context.close()
  assert.deepEqual(errors, [])
  console.log('PASS ESAN payload, catalog retry preserving input, other career, email recovery and zero page errors')
} finally { await browser.close() }
