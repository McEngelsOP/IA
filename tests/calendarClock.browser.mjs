import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true, executablePath: process.env.SETUP_BROWSER, args: ['--no-sandbox'] })
const base = process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181'
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-11-03T12:59:30Z') })
  await page.goto(base + '/tests/fixtures/empty.html')
  await page.evaluate(async () => {
    const { mountOfficialCalendar } = await import('/src/features/semester/OfficialCalendar.jsx')
    const user = { id: 'calendar-clock' }
    const events = [
      { id: 'a', title: 'Primera clase', date: '2026-11-03', start_time: '08:00', end_time: '09:00', event_type: 'clase' },
      { id: 'b', title: 'Segunda clase', date: '2026-11-03', start_time: '09:00', end_time: '10:00', event_type: 'clase' }
    ]
    const client = {
      auth: { getUser: async () => ({ data: { user } }) },
      rpc: async () => ({ data: false }),
      from(table) {
        const query = { select() { return query }, eq() { return query }, order() { return query }, range: async () => ({ data: table === 'calendar_events' ? events : [] }) }
        return query
      }
    }
    window.unmountCalendar = mountOfficialCalendar(document.getElementById('root'), { client, user, courses: [], onBusy() {} })
  })
  const next = page.locator('.rem .rtn'), date = page.getByLabel('Ir a fecha', { exact: true })
  await next.waitFor()
  assert.equal(await next.innerText(), 'Primera clase')
  await page.clock.fastForward(31_000)
  assert.equal(await next.innerText(), 'Segunda clase', 'Upcoming class must advance without interacting with the page')
  await page.clock.fastForward(60 * 60 * 1000)
  await page.getByText('Sin clases próximas registradas.', { exact: true }).waitFor()
  await page.clock.fastForward(15 * 60 * 60 * 1000)
  assert.equal(await date.inputValue(), '2026-11-04', 'The current day follows midnight in Lima')
  await date.fill('2026-10-15')
  await page.clock.fastForward(24 * 60 * 60 * 1000)
  assert.equal(await date.inputValue(), '2026-10-15', 'A date chosen by the user stays selected')
  await page.evaluate(() => window.unmountCalendar())
  await page.clock.fastForward(60_000)
  assert.deepEqual(errors, [])
  console.log('PASS: upcoming class updates unattended; Lima midnight follows today and preserves manually selected dates; timer cleanup.')
} finally { await browser.close() }
