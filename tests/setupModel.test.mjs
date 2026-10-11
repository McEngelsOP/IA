import test from 'node:test'
import assert from 'node:assert/strict'
import { newSetup, changeSemester, completedCourses, togglePending, parseCSV, detectColumns, scheduleRows, scheduleEvents, timeValue } from '../src/lib/setupModel.js'
const career = { key: 'fixture', cursos: [{ id: 'pre', c: 0, n: 'Pre', cr: 0 }, { id: 'a', c: 1, n: 'Matemática I', cr: 4 }, { id: 'b', c: 2, n: 'Datos', cr: 3 }, { id: 'c', c: 3, n: 'Curso C', cr: 4 }] }
test('semester setup preserves pending exceptions and does not complete current or pre-formation courses', () => {
  let d = changeSemester(career, newSetup(career), 3)
  assert.deepEqual(completedCourses(career.cursos, d), ['a', 'b'])
  d = togglePending(d, 'a', 1)
  assert.deepEqual(completedCourses(career.cursos, d), ['b'])
  assert.deepEqual(d.enrolled, ['c'])
  assert.deepEqual(togglePending(d, 'c', 3), d)
  assert.deepEqual(changeSemester(career, d, 1).pending, ['a'])
})
test('CSV import supports BOM, semicolons and quoted separators', () => {
  const rows = parseCSV('\uFEFFdía;inicio;fin;curso;aula\r\nLun;08:00;10:00;"Datos; análisis";"A, 101"')
  assert.equal(rows[1][3], 'Datos; análisis'); assert.equal(rows[1][4], 'A, 101')
  assert.throws(() => parseCSV('día,curso\nLunes,"Sin cerrar'))
})
test('preview rejects invalid days, inverted times, duplicates and reused columns', () => {
  const rows = parseCSV('día,inicio,fin,curso,aula\nLun,8:00,10:00,Matemática I,A\nLun,8:00,10:00,Matemática I,A\nOtro,8:00,7:00,Datos,B')
  const mapping = detectColumns(rows[0]), parsed = scheduleRows(rows, mapping, career.cursos)
  assert.equal(parsed[0].courseId, 'a'); assert.equal(parsed[0].issue, '')
  assert.equal(parsed[1].issue, 'Clase duplicada'); assert.equal(parsed[2].issue, 'Día inválido')
  assert.throws(() => scheduleRows(rows, { ...mapping, end: mapping.start }, career.cursos))
})
test('Excel fractional hours and am/pm are normalized without a timezone shift', () => {
  assert.equal(timeValue(0.375), '09:00'); assert.equal(timeValue('12:30 am'), '00:30')
  assert.equal(timeValue('1:15 pm'), '13:15'); assert.equal(timeValue('09:75'), '')
})
test('weekly import chooses first occurrence on or after start and uses stable IDs', () => {
  const d = { token: 'fixture', scheduleStart: '2026-10-14', scheduleEnd: '2026-12-01', schedule: [{ day: 0, start: '08:00', end: '10:00', title: 'Datos', room: 'A', courseId: 'b', issue: '' }] }
  const [event] = scheduleEvents(d)
  assert.equal(event.date, '2026-10-19'); assert.equal(event.repeat_until, '2026-12-01')
  assert.equal(event.id, scheduleEvents(d)[0].id); assert.equal(event.index, 0)
  assert.throws(() => scheduleEvents({ ...d, scheduleEnd: '2026-10-15' }))
})
