import test from 'node:test'
import assert from 'node:assert/strict'
import { academicRecordModel, renderAcademicRecord } from '../src/features/account/academicRecordReport.js'

const catalog = { key: 'ia', version: 'v1', nombre: 'Ingeniería en Inteligencia Artificial', uni: 'Universidad ESAN', cursos: [
  { id: 'intro', n: 'Introducción', cr: 0, c: 0 }, { id: 'a', n: 'Álgebra', cr: 4, c: 1 },
  { id: 'b', n: 'Biología', cr: 2, c: 2 }, { id: 'c', n: 'Cálculo', cr: 3, c: 2 }
] }
const fixture = () => ({ product: 'Lyra', formatVersion: 1, exportedAt: '2026-10-24T02:00:00Z',
  profiles: [{ carrera: 'ia', curriculum_version: 'v1', full_name: 'Estudiante de prueba', student_code: '25000001' }],
  progress: [{ done: ['intro', 'a'], plan: ['c'] }],
  grades: [{ course_id: 'intro', grade: 20 }, { course_id: 'a', grade: '16' }, { course_id: 'b', grade: 0 }],
  course_status: [{ course_id: 'a', status: 'aprobado', times_taken: 1, passed_at: '2026-10-23', personal_note: 'Comentario' }, { course_id: 'b', status: 'desaprobado' }, { course_id: 'c', status: 'matriculado' }],
  student_setup: [{ preferences: { semester: 2, credits: 20 }, draft: { preserved: true } }],
  calendar_events: [{ title: 'Clase', date: '2026-10-23', start_time: '08:00:00', end_time: '10:00:00', repeat_rule: 'weekly', repeat_until: '2026-12-10' }],
  calendar_tasks: [{ title: 'Entregar trabajo', due_date: '2026-10-24', completed: false }]
})

test('report uses real credits, includes zero grades and separates planning from enrollment', () => {
  const record = fixture(), before = JSON.stringify(record), model = academicRecordModel(record, catalog)
  assert.equal(model.completedCount, 2)
  assert.equal(model.completedCredits, 4)
  assert.equal(model.weighted, 64 / 6)
  assert.equal(model.enrolledCount, 1)
  assert.equal(model.rows.find(row => row.id === 'c').grade, null)
  assert.equal(model.rows.find(row => row.id === 'b').grade, 0)
  assert.equal(model.rows.find(row => row.id === 'c').planned, true)
  assert.equal(JSON.stringify(record), before)
})

test('legacy and missing-version records retain ids without using an unrelated curriculum', () => {
  for (const patch of [{ carrera: 'retired-career' }, { curriculum_version: 'v0' }]) {
    const record = fixture(); Object.assign(record.profiles[0], patch)
    const model = academicRecordModel(record, catalog)
    assert.equal(model.catalog, null)
    assert.equal(model.rows.length, 4)
    assert.equal(model.completedCredits, null)
    assert.equal(model.weighted, null)
    assert.match(renderAcademicRecord(record, catalog), /No está disponible el catálogo/)
  }
  const record = fixture(); record.progress[0].done.push('orphan')
  assert.equal(academicRecordModel(record, catalog).completedCredits, null)
})

test('self-contained HTML escapes personal text and preserves the complete original backup', () => {
  const record = fixture(), hostile = '</script><img src=x onerror=alert(1)> & "hola"'
  record.profiles[0].full_name = hostile
  record.course_status[0].personal_note = hostile
  record.calendar_events[0].title = hostile
  record.calendar_tasks[0].title = hostile
  const html = renderAcademicRecord(record, catalog)
  assert(!html.includes(hostile))
  assert(html.includes('&lt;/script&gt;&lt;img'))
  const payload = html.match(/<script type="application\/json" id="academic-record-data">([\s\S]*?)<\/script>/)[1]
  assert.deepEqual(JSON.parse(payload), record)
  assert.match(html, /@media print/)
  assert.match(html, /<html lang="es">/)
  assert.match(html, /23 oct[^<]*2026/)
  assert.match(html, /08:00 — 10:00/)
  assert.match(html, /Semanal/)
})

test('empty records remain readable and missing grades never become zero', () => {
  const html = renderAcademicRecord({ exportedAt: '2026-10-23T15:00:00Z' })
  assert.match(html, /Aún no hay cursos/)
  assert.match(html, /No hay eventos guardados/)
  assert.match(html, /No hay tareas guardadas/)
  assert(!html.includes('undefined'))
  const record = fixture(); record.grades = [{ course_id: 'a', grade: null }, { course_id: 'b', grade: 'invalid' }]
  const model = academicRecordModel(record, catalog)
  assert(model.rows.every(row => row.grade === null))
  assert.equal(model.weighted, null)
})
