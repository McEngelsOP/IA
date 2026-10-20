import test from 'node:test'
import assert from 'node:assert/strict'
import { newSetup, resumeSetupStep, changeSemester, completedCourses, togglePending, scheduleEvents, timeValue } from '../src/features/onboarding/setupModel.js'
const career = { key: 'fixture', cursos: [{ id: 'pre', c: 0, n: 'Pre', cr: 0 }, { id: 'a', c: 1, n: 'Matemática I', cr: 4 }, { id: 'b', c: 2, n: 'Datos', cr: 3 }, { id: 'c', c: 3, n: 'Curso C', cr: 4 }] }
test('resuming old setup drafts preserves their equivalent step after removing mention', () => {
  assert.equal(resumeSetupStep({ step: 3 }), 3)
  assert.equal(resumeSetupStep({ step: 4 }), 3)
  assert.equal(resumeSetupStep({ step: 5 }), 4)
  assert.equal(resumeSetupStep({ step: 6 }), 5)
  assert.equal(resumeSetupStep({ step: 7 }), 6)
  assert.equal(resumeSetupStep({ step: 5, setupVersion: 2 }), 5)
})
test('semester setup preserves pending exceptions and does not complete current or pre-formation courses', () => {
  let d = changeSemester(career, newSetup(career), 3)
  assert.deepEqual(completedCourses(career.cursos, d), ['a', 'b'])
  d = togglePending(d, 'a', 1)
  assert.deepEqual(completedCourses(career.cursos, d), ['b'])
  assert.deepEqual(d.enrolled, ['c'])
  assert.deepEqual(togglePending(d, 'c', 3), d)
  assert.deepEqual(changeSemester(career, d, 1).pending, ['a'])
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
