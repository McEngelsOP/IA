import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const built=await build({entryPoints:['supabase/functions/curriculum-analysis/handler.ts'],bundle:true,platform:'node',format:'esm',write:false})
const {createCurriculumHandler}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))
const id='11111111-1111-4111-8111-111111111111'
function fixture({owner=true,providers=true,missingSource=false,uncertain=false,nonCurriculum=false}={}){
 const calls=[],requests=[];let saved
 const server={rpc:async(name,args)=>{calls.push(name);return{data:name==='claim_curriculum_analysis'?{job_id:id,lease_token:id,attempts:1,university:'Universidad Prueba',career:'Ingeniería',source_text:missingSource?'':'Matemáticas MAT1 4 créditos 1 ciclo',rows:[{code:'MAT1',name:'Matemáticas',credits:'4',cycle:'1',requirements:'Ninguno'}]}:name==='curriculum_provider_reserve'?{allowed:true}:name==='finish_curriculum_analysis'?(saved=args.p_result,true):null}}}
 const client={auth:{getUser:async()=>({data:{user:{id}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:owner?{owner_id:id}:null})})})})}
 const env=k=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',CURRICULUM_WORKER_SECRET:'fixture-worker-secret-long-enough-32',...(providers?{GEMINI_API_KEY:'fixture',GROQ_API_KEY:'fixture',OPENROUTER_API_KEY:'fixture'}:{})})[k]
 const handler=createCurriculumHandler({env,createClient:(_url,key)=>key==='service'?server:client,fetch:async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});const content=JSON.stringify({kind:nonCurriculum?'not_curriculum':uncertain?'uncertain':'curriculum',confidence:.95,summary:'Evaluación de prueba',issues:[]});return Response.json(String(url).includes('googleapis')?{candidates:[{content:{parts:[{text:content}]}}]}:{choices:[{message:{content}}]})}})
 const send=(body={action:'analyze',curriculumId:id},headers={Authorization:'Bearer fixture'})=>handler(new Request('https://fixture.invalid',{method:'POST',headers,body:JSON.stringify(body)}))
 return{send,calls,requests,get saved(){return saved}}
}
test('analysis requires ownership or worker secret and bounds the request before reserving providers',async()=>{
 const f=fixture({owner:false});assert.equal((await f.send()).status,404);assert.deepEqual(f.calls,[])
 assert.equal((await f.send({action:'worker'},{})).status,401);assert.deepEqual(f.calls,[])
 assert.equal((await f.send({action:'analyze',curriculumId:id,padding:'x'.repeat(2100)})).status,413)
})
test('two integrated providers approve coherent curricula; uncertain third vote remains human review',async()=>{
 const f=fixture();assert.equal((await f.send()).status,200);assert.equal(f.saved.decision,'approved');assert.equal(f.requests.length,2)
 const uncertain=fixture({uncertain:true});await uncertain.send();assert.equal(uncertain.saved.decision,'review');assert.equal(uncertain.requests.length,3)
 const invalid=fixture({nonCurriculum:true});await invalid.send();assert.equal(invalid.saved.decision,'rejected');assert.equal(invalid.requests.length,2)
})
test('missing providers/source go to human review without consuming a student key',async()=>{
 for(const options of [{providers:false},{missingSource:true}]){const f=fixture(options);await f.send({action:'worker'},{'x-curriculum-worker-secret':'fixture-worker-secret-long-enough-32'});assert.equal(f.saved.decision,'review');assert.equal(f.requests.length,0)}
})
