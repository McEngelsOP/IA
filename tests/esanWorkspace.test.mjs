import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NAV, resolveRoute, validRoute } from '../src/app/navigation.js'
import { CAREER_KEYS, CAREER_OPTIONS } from '../src/institutions/esan/careerOptions.js'
import { CARRERAS } from '../src/institutions/esan/carreras.js'
import { isEsanStudentCode } from '../src/institutions/esan/config.js'
import { canTake, canPlan, buildMalla } from '../src/core/academic/curriculumGraph.js'
import { projectSemesters } from '../src/core/academic/semesterProjection.js'
import { readAcademicRecord } from '../src/features/account/exportAcademicRecord.js'

test('five primary destinations and backward-compatible academic routes', () => {
  assert.deepEqual(NAV.filter(n => !n.secondary).map(n => n.n), ['Inicio', 'Mi carrera', 'Mi semestre', 'Planificar', 'Asistente'])
  for (const [name,parent,page] of [['Malla Curricular',null,'Mi carrera'],['Calendario/Horarios',null,'Mi semestre'],['Brújula IA','Herramientas','Planificar'],['Asesor IA','Herramientas','Asistente'],['Recursos','Herramientas','Recursos']]) {
    assert.equal(resolveRoute(name,parent).page,page)
    assert(validRoute({page:parent||name,kid:parent?name:null}))
  }
  assert(!validRoute({page:'unknown'}))
})

test('all 18 ESAN catalogs have a reproducible release with unchanged course identifiers', () => {
  assert.equal(CAREER_KEYS.length,18)
  assert(!Object.hasOwn(CAREER_OPTIONS,'pucp-mecatronica'))
  for (const key of CAREER_KEYS) {
    const career=CARRERAS[key]
    const snapshot=JSON.parse(readFileSync(new URL(`../data/catalogs/esan/releases/${key}/${career.version}.json`,import.meta.url)))
    assert.equal(snapshot.institutionId,'esan')
    assert.deepEqual(snapshot.cursos,career.cursos)
    assert.equal(snapshot.total,career.total)
  }
  assert(isEsanStudentCode('25123456',new Date('2026-01-01T05:00:00Z')))
  assert(!isEsanStudentCode('27123456',new Date('2026-12-31T23:00:00Z')))
  assert(!isEsanStudentCode('20123456',new Date('2026-10-19T20:00:00Z')))
})

test('unverified electives cannot become unconditional recommendations', () => {
  const course={id:'e',n:'Electivo',r:[],cr:3,c:1,requirementNote:'Según electivo'}
  const graph=buildMalla({cursos:[course]})
  assert(!canTake(course,new Set(),200))
  assert(!canPlan(graph,course,new Set()))
  const result=projectSemesters([course],[],20)
  assert.equal(result.remaining,1);assert.deepEqual(result.unverified,['e'])
})

test('projection respects the chosen load and never changes real approvals', () => {
  const courses=[{id:'a',n:'A',r:[],cr:6,c:1},{id:'b',n:'B',r:['a'],cr:3,c:2}]
  const completed=[],enrolled=['a']
  const future=projectSemesters(courses,completed,3,enrolled)
  assert.deepEqual(future.conditionalOn,['a']);assert.deepEqual(future.semesters[0].courses.map(c=>c.id),['b'])
  assert.deepEqual(completed,[])
  assert.equal(projectSemesters(courses,[],3).semesters.length,0)
  assert.throws(()=>projectSemesters(courses,[],0),RangeError)
})

test('academic export paginates only the signed-in user and rejects partial exports', async () => {
  const reads=[]
  const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table){
    let offset=0
    const query={select(){return query},eq(column,id){reads.push({table,column,id});return query},order(){return query},async range(start){offset=start;return {data:table==='grades'&&offset===0?Array.from({length:500},(_,i)=>({course_id:String(i)})):[]}}}
    return query
  }}
  const result=await readAcademicRecord(client,'owner')
  assert.equal(result.grades.length,500);assert(reads.every(r=>r.id==='owner'))
  await assert.rejects(()=>readAcademicRecord(client,'other'),/SESSION_CHANGED/)
  const broken={...client,from(){const q={select(){return q},eq(){return q},order(){return q},range:async()=>({error:new Error('offline')})};return q}}
  await assert.rejects(()=>readAcademicRecord(broken,'owner'),/offline/)
})
