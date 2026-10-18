import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionCache } from '../src/lib/sessionCache.js'
import { CARRERAS as SOURCE } from '../src/data/carreras.js'
import { loadCareer, CARRERAS } from '../src/lib/careerLoader.js'
import { calendarWindow, calendarFilter, readCalendarPages } from '../src/lib/calendarQueries.js'
import { occurs } from '../src/lib/calendarModel.js'
import { visiblePolling } from '../src/lib/visiblePolling.js'

test('every isolated career is identical to the approved catalogue, coalesced and rejects unknown keys',async()=>{
 for(const [key,value] of Object.entries(SOURCE)) { const [a,b]=await Promise.all([loadCareer(key),loadCareer(key)]);assert.equal(a,b);assert.deepEqual(a,value);assert.equal(CARRERAS[key],a) }
 await assert.rejects(loadCareer('__proto__'),/INVALID_CAREER/)
})
test('private cache isolates users, coalesces reads, expires, rejects errors and cannot revive cleared data',async()=>{
 let time=1,calls=0;const cache=createSessionCache({now:()=>time,ttl:30,limit:2});const read=()=>{calls++;return calls}
 assert.deepEqual(await Promise.all([cache.read('a','key',read),cache.read('a','key',read)]),[1,1]);assert.equal(await cache.read('b','key',read),2)
 time=32;assert.equal(await cache.read('a','key',read),3);cache.clear();assert.equal(cache.size,0)
 let resolve;const pending=cache.read('a','old',()=>new Promise(r=>resolve=r));await Promise.resolve();cache.clear();resolve(9);await pending;assert.equal(cache.size,0)
 await assert.rejects(cache.read('a','error',()=>{throw Error('offline')}));assert.equal(await cache.read('a','error',()=>7),7)
})
test('calendar covers complete grid and server filter includes crossing events and old active weekly series',()=>{
 const range=calendarWindow('2026-10-18');assert.equal(range.start,'2026-09-28');assert.equal(range.end,'2026-11-01')
 const filter=calendarFilter(range.start,range.end);assert.match(filter,/end_date.gte.2026-09-28/);assert.match(filter,/repeat_until.is.null/)
 assert.equal(occurs({date:'2026-01-05',repeat_rule:'weekly'},'2026-10-19'),true)
 assert.equal(occurs({start_date:'2026-09-01',end_date:'2026-11-20'},'2026-10-18'),true)
 assert.equal(occurs({date:'2026-01-05',repeat_rule:'weekly',repeat_until:'2026-08-01'},'2026-10-19'),false)
})
test('calendar scopes every page to user, period and 100 rows; unmount aborts reads',async()=>{
 const calls=[];const client={from(table){const q={select(){return q},eq(k,v){calls.push([table,k,v]);return q},or(v){calls.push(['filter',v]);return q},order(){return q},range(a,b){calls.push(['range',a,b]);return q},abortSignal(signal){calls.push(['signal',signal]);return q},then(resolve){resolve({data:[],error:null})}};return q}}
 await readCalendarPages(client,'student','calendar_events','id',{start:'2026-01-01',end:'2026-01-31'});assert.deepEqual(calls[0],['calendar_events','student_id','student']);assert.deepEqual(calls.at(-1),['range',0,99])
 const c=new AbortController();c.abort();await assert.rejects(readCalendarPages(client,'student','calendar_events','id',{start:'2026-01-01',end:'2026-01-31',signal:c.signal}),{name:'AbortError'})
})
test('polling has one timer, no overlapping reads, sleeps hidden and disposes both listeners',async()=>{
 let time=0,next=0,reads=0,finish;const timers=new Map(),events=new Map();const surface={hidden:false,addEventListener:(e,f)=>events.set(e,f),removeEventListener:e=>events.delete(e)}
 const stop=visiblePolling(()=>{reads++;return new Promise(r=>finish=r)},{doc:surface,win:surface,now:()=>time,schedule:f=>{timers.set(++next,f);return next},cancel:id=>timers.delete(id)})
 assert.equal(timers.size,1);[...timers.values()][0]();assert.equal(reads,1);events.get('focus')();assert.equal(timers.size,0)
 surface.hidden=true;events.get('visibilitychange')();finish();await Promise.resolve();await Promise.resolve();assert.equal(timers.size,0)
 surface.hidden=false;time=20000;events.get('visibilitychange')();assert.equal(timers.size,1);stop();assert.equal(timers.size,0);assert.equal(events.size,0)
})
test('automatic chat updates bound the DOM and explicit older-page reads preserve requested history',async()=>{
 const {chatWindow}=await import('../src/lib/studyGroups.js')
 const rows=Array.from({length:250},(_,i)=>({id:String(i).padStart(4,'0'),created_at:new Date(1700000000000+i*1000).toISOString()}))
 const result=chatWindow(rows.slice(0,190),rows.slice(180));assert.equal(result.messages.length,200);assert.equal(result.messages[0].id,'0050');assert.equal(result.messages.at(-1).id,'0249');assert.equal(result.trimmed,true)
 assert.equal(chatWindow(rows.slice(0,190),rows.slice(180),true).messages.length,250)
})
