import test from 'node:test'
import assert from 'node:assert/strict'
import { generateAdvisorAnswer, DEFAULT_GEMINI_MODEL } from '../supabase/functions/study-advisor/providers.ts'
const providers=[{name:'gemini',model:DEFAULT_GEMINI_MODEL,key:'fixture'},{name:'groq',model:'fixture-model',key:'fixture'},{name:'openrouter',model:'openrouter/free',key:'fixture'}]
const settings={providers,system:'fixture',context:'fixture',history:[],reserve:async()=>({allowed:true}),report:async()=>{}}
test('deployed advisor falls back from Gemini to Groq without unbounded retries',async()=>{
 const calls=[];const result=await generateAdvisorAnswer({...settings,fetch:async(url,init)=>{calls.push({url,payload:JSON.parse(init.body)});return calls.length===1?new Response(JSON.stringify({error:{message:'quota'}}),{status:429}):new Response(JSON.stringify({choices:[{message:{content:'Respuesta de prueba'}}]}),{status:200})}})
 assert.equal(result.answer,'Respuesta de prueba');assert.equal(result.attempts,2);assert.match(calls[1].url,/groq/);assert.equal(calls[1].payload.max_completion_tokens,1800)
})
test('all providers exhausted makes at most four attempts with a bounded timeout signal',async()=>{
 let calls=0;const result=await generateAdvisorAnswer({...settings,providers:[{...providers[0],model:'different-model'},...providers.slice(1)],fetch:async(url,init)=>{calls++;assert(init.signal);return new Response('{}',{status:503})}})
 assert(calls<=4);assert(result.error);assert.equal(result.attempts,calls)
})
test('server cooldown avoids requests to unavailable providers',async()=>{
 let calls=0;const result=await generateAdvisorAnswer({...settings,reserve:async()=>({allowed:false,retryAfterSeconds:60}),fetch:async()=>{calls++;throw Error('should not fetch')}})
 assert.equal(calls,0);assert.equal(result.error,'rate_limited')
})
