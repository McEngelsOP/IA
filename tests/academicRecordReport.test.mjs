import test from 'node:test'
import assert from 'node:assert/strict'
import { academicRecordModel } from '../src/features/account/academicRecordReport.js'
import { createAcademicRecordPdf } from '../src/features/account/academicRecordPdf.js'

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
  }
  const record = fixture(); record.progress[0].done.push('orphan')
  assert.equal(academicRecordModel(record, catalog).completedCredits, null)
})

test('download is a real PDF and contains no executable HTML or PDF scripts', () => {
  const record = fixture(), hostile = '</script><img src=x onerror=alert(1)> & "hola"'
  record.profiles[0].full_name = hostile
  record.course_status[0].personal_note = hostile
  const before = JSON.stringify(record)
  const pdf = createAcademicRecordPdf(record, catalog)
  const bytes = Buffer.from(pdf.output('arraybuffer'))
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.equal(pdf.output('blob').type, 'application/pdf')
  assert(!bytes.includes(Buffer.from('/JavaScript')))
  assert(!bytes.includes(Buffer.from('/EmbeddedFiles')))
  assert.equal(JSON.stringify(record), before)
})

test('PDF paginates extensive records and handles empty data', () => {
  const empty = createAcademicRecordPdf({ exportedAt: '2026-10-23T15:00:00Z' })
  assert(empty.getNumberOfPages() >= 1)
  const record = fixture()
  record.calendar_tasks = Array.from({ length: 150 }, (_, i) => ({ title: `Tarea ${i}: revisión de cálculos y análisis`, due_date: '2026-10-24', completed: false }))
  const pdf = createAcademicRecordPdf(record, catalog)
  assert(pdf.getNumberOfPages() > 3)
  assert(pdf.getFontList().LyraReport.includes('bold'))
  record.grades = [{ course_id: 'a', grade: null }, { course_id: 'b', grade: 'invalid' }]
  const model = academicRecordModel(record, catalog)
  assert(model.rows.every(row => row.grade === null))
  assert.equal(model.weighted, null)
})
