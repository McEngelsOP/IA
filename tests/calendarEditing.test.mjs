import test from 'node:test'
import assert from 'node:assert/strict'
import { eventPayload, eventGeometry, layoutEvents, validateEvent, timedEventGroups } from '../src/core/calendar/calendarModel.js'

test('Editar desde la cuadrícula guarda solo columnas reales, igual que desde la agenda', () => {
  const event = { id: 'class-1', student_id: 'owner', title: 'Cálculo II', date: '2026-08-17', color: 'gris', event_type: 'clase', start_time: '10:30', end_time: '11:15', location: 'B-502', repeat_rule: 'weekly', repeat_until: '2026-12-11' }
  const drawn = layoutEvents([event])[0]
  assert.equal(drawn.start, 630)
  const edited = { ...drawn, end_time: '12:15', title: 'Cálculo actualizado' }
  const payload = eventPayload(edited)
  assert.equal(validateEvent(edited), '')
  assert.equal(payload.end_time, '12:15'); assert.equal(payload.title, 'Cálculo actualizado')
  for (const key of ['start', 'end', 'lane', 'lanes', 'id', 'student_id', 'occurrence', 'created_at']) assert.ok(!(key in payload))
  assert.deepEqual(payload, eventPayload({ ...event, end_time: '12:15', title: 'Cálculo actualizado' }))
})
test('La altura y la posición usan la misma escala que las líneas de horas', () => {
  assert.deepEqual(eventGeometry({start:630,end:675},7),{top:315,height:63.5})
  assert.equal(eventGeometry({start:630,end:735},7).height,153.5)
  assert.equal(eventGeometry({start:630,end:675},7).top-eventGeometry({start:570,end:615},7).top,90)
})
test('Quitar repetición y horas limpia los campos opcionales', () => {
  const p = eventPayload({title:' Tarea ',date:'2026-10-14',repeat_rule:'none',repeat_until:'2026-12-11'})
  assert.equal(p.repeat_until,null);assert.equal(p.start_time,null);assert.equal(p.course_id,null)
  assert.equal(p.title,'Tarea');assert.equal(p.location,'')
})

test('Dos clases separadas comparten columna; los cruces se agrupan sin duplicarlas', () => {
  const a = { id: 'a', title: 'Curso A', start_time: '10:30', end_time: '11:15' }
  const b = { id: 'b', title: 'Curso B', start_time: '14:30', end_time: '15:15' }
  assert.equal(timedEventGroups([b, a]).length, 2)
  const groups = timedEventGroups([{ ...a, end_time: '16:15' }, b])
  assert.equal(groups.length, 1);assert.deepEqual(groups[0].events.map(e => e.id), ['a', 'b'])
  assert.equal(groups[0].start, 630);assert.equal(groups[0].end, 975)
})
