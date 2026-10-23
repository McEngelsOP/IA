import test from 'node:test'
import assert from 'node:assert/strict'
import { compactSheet, parseSchedule, classEvent, validateSemester, eventSignature, conflictingClasses } from '../src/core/calendar/scheduleImport.mjs'
import { occurs } from '../src/core/calendar/calendarModel.js'
test('Una serie semanal respeta inicio y fin sin generar filas por semana', () => {
  const r = { title: 'Cálculo', weekday: 2, start_time: '08:00', end_time: '10:00', location: 'Aula 3' }
  const e = classEvent(r, '2026-08-17', '2026-12-12')
  assert.equal(e.date, '2026-08-19'); assert.equal(e.repeat_until, '2026-12-12')
  assert.equal(occurs(e, '2026-08-12'), false); assert.equal(occurs(e, '2026-08-19'), true)
  assert.equal(occurs(e, '2026-12-09'), true); assert.equal(occurs(e, '2026-12-16'), false)
})
test('No inventa semestre, rechaza horas y días inválidos', () => {
  const data = { semester_start: null, semester_end: null, classes: [{ title: 'Física', weekday: 0, start_time: '08:00', end_time: '09:00' }] }
  assert.equal(parseSchedule(JSON.stringify(data)).semester_start, '')
  for (const field of [{ weekday: 7 }, { start_time: '25:00' }, { end_time: '07:59' }, { title: '' }]) {
    assert.throws(() => parseSchedule(JSON.stringify({ ...data, classes: [{ ...data.classes[0], ...field }] })))
  }
  assert.ok(validateSemester('2026-02-30', '2026-06-30'))
  assert.ok(validateSemester('2026-01-01', '2027-01-01'))
  assert.throws(() => classEvent({ ...data.classes[0], location: '', weekday: 6 }, '2026-10-14', '2026-10-14'))
})
test('Normaliza firmas para evitar duplicados y detecta cruces', () => {
  const a = { title: 'Física', weekday: 0, start_time: '08:00', end_time: '09:00', location: '' }
  const e = classEvent(a, '2026-08-17', '2026-12-12')
  assert.equal(eventSignature(e), eventSignature({ ...e, title: ' FÍSICA ', start_time: '08:00:00' }))
  assert.equal(conflictingClasses([a, { ...a, start_time: '08:30' }]), true)
  assert.equal(conflictingClasses([a, { ...a, start_time: '09:00', end_time: '10:00' }]), false)
})
test('Acota la hoja y elimina filas vacías sin almacenar el libro', () => {
  assert.equal(compactSheet([['Curso', null], ['', ''], ['Física', 0.5]]), '[["Curso",""],["Física","0.5"]]')
  assert.throws(() => compactSheet(Array.from({ length: 301 }, () => ['x'])))
  assert.throws(() => compactSheet([['x'.repeat(16001)]]))
  assert.throws(() => compactSheet([[]]))
})
