import { test } from 'node:test'
import assert from 'node:assert/strict'
import { civil, addDays, monday, todayLima, monthDays, occurs, layoutEvents, validateEvent } from '../src/core/calendar/calendarModel.js'

test('fechas civiles: días inválidos, bisiestos y cambio de año', () => {
  assert.equal(civil('2026-02-30'), null)
  assert.equal(civil('2024-02-29').toISOString().slice(0, 10), '2024-02-29')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(monday('2027-01-03'), '2026-12-28')
  assert.equal(addDays('2026-03-08', 1), '2026-03-09')
  assert.equal(monthDays('2026-10-08').length, 35)
})

test('el día del usuario se calcula en Lima, aunque UTC ya esté en el día siguiente', () => {
  assert.equal(todayLima(new Date('2026-10-09T02:00:00Z')), '2026-10-08')
})

test('repetición semanal respeta inicio, día de semana y fecha final', () => {
  const event = { date: '2026-10-08', repeat_rule: 'weekly', repeat_until: '2026-10-22' }
  assert(occurs(event, '2026-10-22'))
  assert(!occurs(event, '2026-10-29'))
  assert(!occurs(event, '2026-10-09'))
  assert(!occurs(event, '2026-10-01'))
})

test('rangos anteriores sobreviven al cambio de calendario', () => {
  const event = { start_date: '2026-12-30', end_date: '2027-01-03' }
  assert(occurs(event, '2027-01-02'))
  assert(!occurs(event, '2027-01-04'))
})

test('eventos simultáneos no se ocultan entre sí; los contiguos comparten columna', () => {
  const events = [
    { id: 1, start_time: '08:00', end_time: '10:00' },
    { id: 2, start_time: '09:00', end_time: '11:00' },
    { id: 3, start_time: '10:00', end_time: '12:00' },
    { id: 4, start_time: '13:00', end_time: '14:00' }
  ]
  assert.deepEqual(layoutEvents(events).map(e => [e.lane, e.lanes]), [[0, 2], [1, 2], [0, 2], [0, 1]])
})

test('rechaza horas invertidas, fechas inexistentes y series con fecha final anterior', () => {
  assert(validateEvent({ title: 'Clase', date: '2026-10-08', start_time: '10:00', end_time: '09:00' }))
  assert(validateEvent({ title: 'Entrega', date: '2026-02-30' }))
  assert(validateEvent({ title: 'Clase', date: '2026-10-08', repeat_rule: 'weekly', repeat_until: '2026-10-01' }))
  assert.equal(validateEvent({ title: 'Entrega', date: '2026-10-08', start_time: null, end_time: null }), '')
})
