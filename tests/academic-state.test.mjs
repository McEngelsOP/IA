import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMalla, previewCompleted, validPlan, canTake, canPlan } from '../src/core/academic/curriculumGraph.js'
const courses=[{id:'a',n:'A',r:[],cr:4,c:1},{id:'b',n:'B',r:['a'],cr:4,c:2},{id:'c',n:'C',r:['b'],cr:4,c:3}]
const m=buildMalla({cursos:courses})
test('unmarking an approval preserves other recorded approvals',()=>{
 const change=previewCompleted(m,new Set(['a','b']),'a')
 assert.deepEqual([...change.next],['b'])
 assert.deepEqual(change.removed.map(c=>c.id),['a'])
})
test('marking a course never invents prerequisite approvals',()=>{
 assert.deepEqual([...previewCompleted(m,new Set(),'b').next],['b'])
})
test('enrolled courses cannot be included in the future plan',()=>{
 const statuses={a:{status:'matriculado'}}
 assert.equal(canTake(m.byId.a,new Set(),0,statuses),false)
 assert.equal(canPlan(m,m.byId.a,new Set(),statuses),false)
 assert.deepEqual([...validPlan(m,new Set(['a','b','c']),new Set(),statuses)],['b'])
})
test('future eligibility updates after removing an approval or enrollment',()=>{
 assert.deepEqual([...validPlan(m,new Set(['b']),new Set(['a']))],['b'])
 assert.deepEqual([...validPlan(m,new Set(['b']),new Set())],[])
 assert.deepEqual([...validPlan(m,new Set(['b']),new Set(),{a:{status:'desaprobado'}})],[])
})

import { projectSemesters } from '../src/core/academic/semesterProjection.js'
test('projection excludes courses in progress and starts with their successors',()=>{
 const result=projectSemesters(courses,[],8,['a'])
 assert.deepEqual(result.semesters.map(t=>t.courses.map(c=>c.id)),[['b'],['c']])
 assert.equal(result.remaining,0)
})
test('credit thresholds include current enrollment only in the conditional future plan',()=>{
 const withThreshold=buildMalla({cursos:[...courses,{id:'d',n:'D',r:[],rc:8,cr:3,c:3}]})
 const statuses={b:{status:'matriculado'}}
 assert.equal(canTake(withThreshold.byId.d,new Set(['a']),4,statuses),false)
 assert.equal(canPlan(withThreshold,withThreshold.byId.d,new Set(['a']),statuses),true)
 assert.equal(canPlan(withThreshold,withThreshold.byId.d,new Set(),statuses),false)
})
test('projection never unlocks a prerequisite within the same semester',()=>{
 assert.deepEqual(projectSemesters(courses,[],24).semesters.map(t=>t.courses.map(c=>c.id)),[['a'],['b'],['c']])
})
