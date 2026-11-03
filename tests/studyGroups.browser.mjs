import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { MESSAGE_PAGE_SIZE } from '../src/features/groups/studyGroups.js'

const browser = await chromium.launch({ headless: true, executablePath: process.env.SETUP_BROWSER, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto((process.env.SETUP_BASE_URL || 'http://127.0.0.1:5181') + '/tests/fixtures/empty.html')
  await page.evaluate(async size => {
    const { mountOfficialStudyGroups } = await import('/src/features/groups/OfficialStudyGroups.jsx')
    const room = { id: 'room', course_id: 'math', name: 'Repaso de álgebra', is_member: true, is_owner: true, member_count: 1 }
    const messages = Array.from({ length: size * 2 }, (_, i) => ({
      id: `message-${String(i).padStart(3, '0')}`, nickname: 'Compañero', body: `Mensaje ${i}`,
      created_at: new Date(Date.UTC(2026, 10, 1, 12, i)).toISOString()
    }))
    window.regressionModerated = false
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'student' } } }) },
      rpc: async (name, args) => {
        if (name === 'list_study_rooms' || name === 'study_room_info') return { data: [room] }
        if (name === 'list_study_members') return { data: [{ nickname: 'Estudiante', member_key: 'self', is_self: true }] }
        if (name === 'read_study_messages') {
          const before = args.before_id ? messages.findIndex(message => message.id === args.before_id) : messages.length
          return { data: messages.slice(Math.max(0, before - size), before) }
        }
        if (name === 'read_study_message_changes') return { data: window.regressionModerated ? [{ ...messages[0], body: 'Mensaje eliminado por moderación.' }] : [] }
        throw new Error('Unexpected RPC: ' + name)
      }
    }
    mountOfficialStudyGroups(document.getElementById('root'), { client, user: { id: 'student' }, courses: [{ id: 'math', n: 'Álgebra' }], nickname: 'Estudiante', onBusy() {} })
  }, MESSAGE_PAGE_SIZE)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForFunction(size => document.querySelectorAll('.sg-message').length === size, MESSAGE_PAGE_SIZE)
  await page.getByRole('button', { name: 'Cargar mensajes anteriores' }).click()
  await page.waitForFunction(size => document.querySelectorAll('.sg-message').length === size * 2, MESSAGE_PAGE_SIZE)
  assert.equal(await page.getByRole('alert').count(), 0, 'Loading old messages must not produce a ReferenceError or a false failure')
  await page.getByRole('button', { name: 'Cargar mensajes anteriores' }).click()
  await page.waitForFunction(() => !document.querySelector('.sg-earlier'))
  assert.equal(await page.locator('.sg-message').count(), MESSAGE_PAGE_SIZE * 2)
  await page.evaluate(() => { window.regressionModerated = true })
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
  await page.getByText('Mensaje eliminado por moderación.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('alert').count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: group history pagination, end of history and moderated older messages')
} finally { await browser.close() }
