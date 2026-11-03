import test from 'node:test'
import assert from 'node:assert/strict'
import { GRADE_SCALES, parseGrade, formatGrade, validGrade, weightedGrade, evaluationResult } from '../src/core/academic/grading.js'
import { calendarRisks, inQuietHours, dueReminders } from '../src/core/calendar/prevention.js'
import { compareCurricula } from '../src/core/academic/curriculumVersions.js'
import { createPreferenceSync } from '../src/shared/lib/preferenceSync.js'
test('institution scales, zero grades, letters and strict evaluation weights',()=>{
 assert.equal(parseGrade('100',GRADE_SCALES.hundred),100)
 assert(Number.isNaN(parseGrade('100',GRADE_SCALES.twenty)))
 assert.equal(parseGrade('0',GRADE_SCALES.twenty),0)
 assert.equal(parseGrade('B',GRADE_SCALES.letters),3)
 assert(Number.isNaN(parseGrade('E',GRADE_SCALES.letters)))
 assert.equal(formatGrade(3,GRADE_SCALES.letters),'B')
 assert(!validGrade(3.5,GRADE_SCALES.letters))
 assert.equal(weightedGrade([{grade:10,credits:1},{grade:20,credits:3}]),17.5)
 assert.equal(weightedGrade([{grade:10,credits:1},{grade:20,credits:3}],{...GRADE_SCALES.twenty,weighting:'equal'}),15)
 assert.deepEqual(evaluationResult([{w:50,s:10},{w:50,s:null}],15),{kind:'pending',needed:20})
 assert.equal(evaluationResult([{w:20,s:10}],10).kind,'invalid')
})
const event=(id,start,end,extra={})=>({id,title:id,date:'2026-11-02',start_time:start,end_time:end,event_type:'clase',...extra})
test('preventive calendar respects touching boundaries, recurrence, deadlines and quiet hours',()=>{
 const events=[event('a','08:00','09:00',{repeat_rule:'weekly',repeat_until:'2026-11-09'}),event('b','08:30','09:30'),event('c','09:30','10:00')]
 const tasks=Array.from({length:4},(_,i)=>({id:i,title:'Entrega',due_date:'2026-11-04',completed:false}))
 const risks=calendarRisks(events,tasks,'2026-11-02',28)
 assert.equal(risks.conflicts.length,1);assert.equal(risks.busyWeeks.length,1)
 assert.equal(calendarRisks(events,[],'2026-11-16',7).conflicts.length,0)
 assert(inQuietHours(new Date('2026-11-03T04:00:00Z'),{quietStart:'22:00',quietEnd:'07:00',timeZone:'America/Lima'}))
 assert(!inQuietHours(new Date('2026-11-02T13:00:00Z'),{quietStart:'22:00',quietEnd:'07:00',timeZone:'America/Lima'}))
 assert.deepEqual(dueReminders(events,tasks,{enabled:false}),[])
 const reminders=dueReminders(events,tasks,{enabled:true,weekly:true,leadMinutes:30,timeZone:'America/Lima'},new Date('2026-11-02T13:00:00Z'))
 assert(reminders.some(r=>r.key==='event:a:2026-11-02'));assert(reminders.some(r=>r.key==='week:2026-11-02'))
})
test('curriculum diff reports credits and prerequisites without modifying progress',()=>{
 const before={cursos:[{id:'a',n:'A',cr:4,r:[]},{id:'b',n:'B',cr:3,r:['a']}]}
 const after={cursos:[{id:'b',n:'B',cr:4,r:[]},{id:'c',n:'C',cr:3,r:[]}]}
 const diff=compareCurricula(before,after)
 assert.deepEqual(diff.added.map(c=>c.id),['c']);assert.deepEqual(diff.removed.map(c=>c.id),['a']);assert.deepEqual(diff.changed[0].fields,['cr','r'])
})
test('two devices merge independent preferences, reconnect and never mix accounts',async()=>{
 let remote={},current='student',fail=false
 const storage=()=>{const d=new Map();return{getItem:k=>d.get(k)||null,setItem:(k,v)=>d.set(k,v)}}
 const client={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{values:remote},error:null})})})}),auth:{getUser:async()=>({data:{user:{id:current}}})},rpc:async(name,{p_patch})=>{if(fail)return{error:{message:'offline'}};remote={...remote,...p_patch};return{data:{values:remote}}}}
 const a=createPreferenceSync({client,storage:storage()}),b=createPreferenceSync({client,storage:storage()})
 await a.start('student');await b.start('student');a.set('theme','dark');b.set('homeOrder',['stats']);await a.flush();await b.flush();await a.refresh()
 assert.equal(a.get('theme'),'dark');assert.deepEqual(a.get('homeOrder'),['stats'])
 fail=true;a.set('diagnosis',{t:16});await a.flush();assert.equal(a.get('diagnosis').t,16);fail=false;await a.refresh();assert.equal(remote.diagnosis.t,16)
 a.stop();b.stop();current='different';remote={theme:'light'};await a.start('different');assert.equal(a.get('theme'),'light');assert.equal(a.get('diagnosis'),undefined);a.stop()
})
