import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CARRERAS, CARRERA_KEYS } from '../src/data/carreras.js'
import { CAREER_OPTIONS, CAREER_KEYS } from '../src/data/careerOptions.js'
import { AREAS } from '../src/data/areas.js'
import { buildMalla, canTake, completedCredits } from '../src/lib/curriculumGraph.js'
import { enrolledFocusCourses } from '../src/lib/focusModel.js'
import { generateCurricula } from '../scripts/generateCurricula.mjs'

test('generated catalog is current, with all 18 distinct ESAN careers and existing PUCP', () => {
  assert.deepEqual(generateCurricula({ check: true }), { careers: 19, added: 15 })
  assert.deepEqual(CARRERA_KEYS, CAREER_KEYS)
  assert.equal(Object.values(CAREER_OPTIONS).filter(c => c.uni === 'Universidad ESAN').length, 18)
  assert.equal(new Set(Object.values(CAREER_OPTIONS).map(c => c.nombre)).size, 19)
})
for (const key of CAREER_KEYS) test(`${key}: credits, graph, availability and enrolled courses`, () => {
  const career = CARRERAS[key], graph = buildMalla(career)
  assert.equal(career.nombre, CAREER_OPTIONS[key].nombre)
  assert.equal(career.total, CAREER_OPTIONS[key].total)
  assert.equal(career.cursos.reduce((sum, c) => sum + c.cr, 0), career.total)
  assert.equal(new Set(career.cursos.map(c => c.id)).size, career.cursos.length)
  const visiting = new Set(), visited = new Set()
  function visit(course) {
    assert(!visiting.has(course.id), `Cycle at ${course.n}`)
    if (visited.has(course.id)) return
    visiting.add(course.id)
    for (const id of course.r) { assert(graph.byId[id], `Missing ${id}`); visit(graph.byId[id]) }
    visiting.delete(course.id); visited.add(course.id)
  }
  for (const course of career.cursos) {
    assert(AREAS[course.a]); assert(career.ciclos[course.c]); visit(course)
    assert(Number.isFinite(graph.byId[course.id].x)); assert(Number.isFinite(graph.byId[course.id].y))
    if (course.r.length || course.rc) assert.equal(canTake(course, new Set(), 0), false)
  }
  assert(career.cursos.some(c => canTake(c, new Set(), 0)))
  assert.equal(completedCredits(graph, new Set(career.cursos.map(c => c.id))), career.total)
  const sample = career.cursos.filter(c => c.cr > 0).slice(0, 3)
  const enrolled = Object.fromEntries(sample.map(c => [c.id, { status: 'matriculado' }]))
  assert.equal(enrolledFocusCourses(career.cursos, enrolled).length, sample.length)
  assert.deepEqual(enrolledFocusCourses(career.cursos, {}), [])
})
test('source spelling and compound names keep every prerequisite and credit requirement', () => {
  const find = (key, name) => CARRERAS[key].cursos.find(c => c.n === name)
  const economy = find('administracion-finanzas', 'Economía General')
  assert.deepEqual(economy.r.map(id => CARRERAS['administracion-finanzas'].cursos.find(c => c.id === id).n), ['Administración General', 'Cálculo I'])
  const psychology = find('psicologia', 'Pruebas de Personalidad y Constructos del Yo')
  assert.equal(psychology.r.length, 2)
  assert(psychology.r.includes(find('psicologia', 'Principios de Evaluación, Pruebas de Inteligencia y de Procesos Cognitivos').id))
  assert.equal(find('software', 'Trabajo de Tesis I').rc, 140)
  assert.equal(find('software', 'Electivo Internacional I').cr, 1.5)
  assert.equal(find('administracion', 'Gestión de Negocios Internacionales').r[0], find('administracion', 'Global Supply Chain Managemnet').id)
  assert.equal(find('software', 'Taller: Desarrollo de Competencias Personales I').id, 'tdcpe1')
  assert.notEqual(find('software', 'Electivo I').id, find('derecho', 'Electivo I').id)
})
