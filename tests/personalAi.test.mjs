import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundle=await build({entryPoints:[new URL('../supabase/functions/study-advisor/aiRouting.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'})
const {loadAiRoute}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
function fixture(mode,owned=[]){
  const calls=[]
  const server={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='ai_key_read'?{mode,providers:owned}:name.endsWith('report')?null:{allowed:true,remaining:9},error:null}}}
  const client={rpc:async(name,args)=>{calls.push({name,args});return {data:{allowed:true,remaining:2},error:null}}}
  const env=name=>({GEMINI_API_KEY:'shared-google',GROQ_API_KEY:'shared-groq',OPENROUTER_API_KEY:'shared-router'})[name]
  return {server,client,env,userId:'owner-1',calls}
}
test('personal mode never mixes shared credentials; missing own providers are skipped',async()=>{
  const f=fixture('personal',[{name:'groq',key:'my-groq'}]);const r=await loadAiRoute(f)
  assert.deepEqual(r.providers.map(p=>[p.name,p.key]),[['groq','my-groq']]);assert.equal(r.personal,true)
  await r.usage(true);await r.reserve('groq','model');await r.report('groq','model','ok',0,100)
  assert.deepEqual(f.calls.map(c=>c.name),['ai_key_read','ai_personal_usage','ai_personal_reserve','ai_personal_report'])
  assert(f.calls.every(c=>c.args.p_user_id==='owner-1'))
})
test('personal mode with no active keys cannot silently charge shared providers',async()=>{
  const r=await loadAiRoute(fixture('personal'));assert.deepEqual(r.providers,[])
})
test('system mode keeps the shared limits and does not use stored personal keys',async()=>{
  const f=fixture('system',[{name:'groq',key:'my-groq'}]);const r=await loadAiRoute(f)
  assert.equal(r.providers[1].key,'shared-groq');await r.usage(true);await r.reserve('groq','model');await r.report('groq','model','ok',0,100)
  assert.deepEqual(f.calls.map(c=>c.name),['ai_key_read','advisor_usage','advisor_provider_reserve','advisor_provider_report'])
})
test('credential database failure stops routing instead of changing the selected mode',async()=>{
  const f=fixture('system');f.server.rpc=async()=>({data:null,error:{message:'failure'}})
  await assert.rejects(()=>loadAiRoute(f),/credentials_unavailable/)
})
