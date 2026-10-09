import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FOCUS_PRESETS,enrolledFocusCourses,focusRemaining,focusDuration,focusMotivation,todayLima } from '../src/lib/focusModel.js'
test('only current enrolled courses from the selected career appear, alphabetically, without stale approvals',()=>{
 const courses=[{id:'z',n:'Zoología'},{id:'e2',n:'Estadística 2'},{id:'a',n:'Álgebra'},{id:'e10',n:'Estadística 10'},{id:'done',n:'Aprobado'},{id:'plan',n:'Planificado'}]
 const statuses={z:{status:'matriculado'},e2:{status:'matriculado'},a:{status:'matriculado'},e10:{status:'matriculado'},done:{status:'matriculado'},plan:{status:'pendiente'},otherCareer:{status:'matriculado'}}
 assert.deepEqual(enrolledFocusCourses(courses,statuses,new Set(['done'])).map(c=>c.id),['a','e2','e10','z'])
 assert.deepEqual(enrolledFocusCourses(courses,{}),[])
 assert.equal(courses[0].id,'z')
})
test('presets exclude the ten-second trial',()=>{
 assert.deepEqual(FOCUS_PRESETS.map(p=>p[0]),['p25','p45','p90','custom'])
 assert(FOCUS_PRESETS.filter(p=>p[0]!=='custom').every(p=>p[2]>=300))
})
test('remaining time catches delayed/background ticks and stops at zero',()=>{
 assert.equal(focusRemaining(10000,1000),9)
 assert.equal(focusRemaining(10000,9999),1)
 assert.equal(focusRemaining(10000,10000),0)
 assert.equal(focusRemaining(10000,15000),0)
})
test('a study day follows Lima across the UTC date boundary',()=>{
 assert.equal(todayLima(new Date('2026-10-09T04:59:59Z')),'2026-10-08')
 assert.equal(todayLima(new Date('2026-10-09T05:00:00Z')),'2026-10-09')
})
test('encouragement uses recorded time and distinguishes empty days and early endings',()=>{
 const day='2026-10-08'
 assert.match(focusMotivation({seconds:2700,completed_count:1},day,day),/Hoy sumaste 45 min/)
 assert.match(focusMotivation({seconds:600,completed_count:0},day,day),/Puedes retomar/)
 assert.match(focusMotivation({seconds:0},day,day),/próximo momento/)
 assert.match(focusMotivation({seconds:0},'2026-10-07',day),/No hay tiempo/)
 assert.match(focusMotivation({seconds:3600,completed_count:1},'2026-10-07',day),/7 de octubre de 2026/)
})
test('durations do not round seconds into invented full minutes',()=>{
 assert.equal(focusDuration(59),'59 s');assert.equal(focusDuration(60),'1 min');assert.equal(focusDuration(5400),'1 h 30 min')
})
