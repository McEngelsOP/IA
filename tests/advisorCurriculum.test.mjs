import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const compiled=await build({entryPoints:[new URL('../supabase/functions/study-advisor/handler.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false})
const {createAdvisorHandler}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const catalog=JSON.parse(readFileSync(new URL('../supabase/functions/study-advisor/catalog.json',import.meta.url)))
let selectedPlan=[],selectedEnrolled=[]
const client={auth:{getUser:async()=>({data:{user:{id:'fixture'}}})},rpc:async name=>({data:name==='advisor_check_moderation'?{allowed:true}:{canSend:true}}),from(table){
 const query={select(){return this},eq(){return this},limit(){return this},maybeSingle(){return this},then(resolve){return Promise.resolve({data:table==='profiles'?{carrera:'ia',curriculum_version:catalog.ia.version}:table==='progress'?{done:[],plan:selectedPlan}:table==='student_setup'?{preferences:{}}:selectedEnrolled.map(id=>({course_id:id,status:'matriculado'}))}).then(resolve)}};return query
}}
const handler=createAdvisorHandler({createClient:()=>client,catalog,env:key=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fixture'})[key],fetch:async()=>{throw new Error('Rules must not call a model')}})
const request=body=>new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({careerId:'ia',careerVersion:catalog.ia.version,...body})})

test('advisor reports unknown elective requirements from its server catalog',async()=>{
 selectedEnrolled=[]; const elective=Object.values(catalog.ia.courses).find(c=>!c.prerequisitesKnown)
 selectedPlan=[elective.id]; const response=await handler(request({question:`¿Qué requiere ${elective.name}?`,courses:[{id:elective.id}]}))
 assert.equal(response.status,200)
 const result=await response.json()
 assert.match(result.answer,/pendientes de verificar/)
 assert.equal(result.source,'curriculum')
})
test('advisor refuses an incompatible curriculum revision',async()=>{
 const response=await handler(request({careerVersion:'unavailable',question:'¿Qué requiere Cálculo II?',courses:[{id:'calc2'}]}))
 assert.equal(response.status,409)
 assert.equal((await response.json()).error,'curriculum_version_mismatch')
})
test('advisor can explain a current course without an invented future plan',async()=>{
 selectedPlan=[];selectedEnrolled=['fis1']; const response=await handler(request({question:'¿Qué requiere Física I?',courses:[],enrolledCourseIds:['fis1']}))
 assert.equal(response.status,200)
 assert.match((await response.json()).answer,/Física I/)
})
