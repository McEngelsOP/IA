import test from 'node:test'
import assert from 'node:assert/strict'
import { createCommunicationsHandler } from '../api/communications.js'
const id='11111111-1111-4111-8111-111111111111'
const env={VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SUPABASE_ANON_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'private-fixture',BREVO_API_KEY:'brevo-fixture',BREVO_SENDER_EMAIL:'lyra@example.invalid'}
const message={userId:id,expectedEmail:'student@example.invalid',subject:'Gracias',preview:'<script>preview</script>',message:'Hola <script>alert(1)</script>\n\nGracias por tu feedback.'}
function fixture({admin=true,authError=false,recipient={},fetchError=false,upstream=201,outcome={messageId:'fixture-message'},variables=env}={}){
 const calls=[]
 const handler=createCommunicationsHandler({env:variables,createClient:(url,key)=>({auth:{getUser:async()=>({data:{user:authError?null:{id:'admin'}},error:authError}),admin:{getUserById:async userId=>{calls.push({userId,key});return{data:{user:{id,email:message.expectedEmail,email_confirmed_at:'2026-01-01',...recipient}}}}}},rpc:async()=>({data:admin})}),fetch:async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});if(fetchError)throw Error('timeout');return{ok:upstream===201,status:upstream,json:async()=>outcome}}})
 async function run(method='POST',body=message,token=true){const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(body){this.body=body;return this}};await handler({method,body,headers:token?{authorization:'Bearer fixture'}:{}},res);return res}
 return {run,calls}
}
test('only verified administrators can use configuration or sending; no provider calls',async()=>{for(const method of ['GET','POST']){for(const options of [{admin:false},{admin:null},{authError:true}]){const f=fixture(options);assert([401,403].includes((await f.run(method)).statusCode));assert.equal(f.calls.length,0)}const f=fixture();assert.equal((await f.run(method,message,false)).statusCode,401);assert.equal(f.calls.length,0)}})
test('configuration is private, readiness does not send, missing credentials fail closed',async()=>{const f=fixture();const r=await f.run('GET');assert.equal(r.body.ready,true);assert(!JSON.stringify(r.body).includes('brevo-fixture'));assert.equal(f.calls.length,0);const empty=fixture({variables:{...env,BREVO_API_KEY:''}});assert.equal((await empty.run('GET')).body.ready,false);assert.equal((await empty.run()).statusCode,503);assert.equal(empty.calls.length,0)})
test('accepts exactly one registered confirmed Auth recipient and escapes HTML',async()=>{const f=fixture();const r=await f.run();assert.equal(r.statusCode,200);assert.equal(r.body.accepted,true);assert.equal(f.calls[0].userId,id);assert.equal(f.calls[0].key,'private-fixture');const sent=f.calls[1].body;assert.deepEqual(sent.to,[{email:message.expectedEmail}]);assert(!sent.htmlContent.includes('<script>'));assert(sent.htmlContent.includes('&lt;script&gt;'));assert.equal(sent.textContent,message.message);assert.equal(f.calls[1].options.redirect,'error');const again=await f.run();assert.equal(again.statusCode,200);assert.equal(f.calls[1].body.headers.idempotencyKey,f.calls[3].body.headers.idempotencyKey)})
test('rejects arbitrary recipients, malformed input, subject injection and unconfirmed or stale emails',async()=>{for(const body of [{...message,to:['other@example.invalid']},{...message,userId:'invalid'},{...message,subject:'Hello\r\nBcc:other@example.invalid'},{...message,message:' '},{...message,message:'a'.repeat(5001)},'{']){const f=fixture();assert.equal((await f.run('POST',body)).statusCode,400);assert.equal(f.calls.length,0)}for(const recipient of [{email_confirmed_at:null},{email:'changed@example.invalid'},{is_anonymous:true},{banned_until:'2999-01-01'}]){const f=fixture({recipient});assert.equal((await f.run()).statusCode,409);assert.equal(f.calls.length,1)}})
test('upstream acceptance is distinct from delivery and uncertain sends never retry automatically',async()=>{for(const [options,expected] of [[{fetchError:true},'delivery_unknown'],[{upstream:400,outcome:{code:'duplicate_parameter'}},'duplicate'],[{upstream:400,outcome:{message:'contains-secret'}},'provider_rejected'],[{outcome:{}},'delivery_unknown']]){const f=fixture(options);const r=await f.run();assert.equal(r.body.error,expected);assert.equal(f.calls.length,2);assert(!JSON.stringify(r.body).includes('contains-secret'))}})

test('trims copied configuration and reports missing or malformed variables without their values',async()=>{
 const variables=Object.fromEntries(Object.entries(env).map(([key,value])=>[key,` \n${value}\n `]))
 const valid=fixture({variables});assert.equal((await valid.run('GET')).body.ready,true)
 assert.equal((await valid.run()).statusCode,200)
 assert.equal(valid.calls[0].key,env.SUPABASE_SERVICE_ROLE_KEY)
 assert.equal(valid.calls[1].options.headers['api-key'],env.BREVO_API_KEY)
 assert.equal(valid.calls[1].body.sender.email,env.BREVO_SENDER_EMAIL)
 for(const [name,value] of [['BREVO_SENDER_EMAIL','invalid sender'],['BREVO_API_KEY','private\nfixture'],['SUPABASE_SERVICE_ROLE_KEY','private fixture'],['BREVO_SENDER_NAME','Lyra\r\nHeader']]){
  const f=fixture({variables:{...env,[name]:value}}),status=await f.run('GET')
  assert.equal(status.body.ready,false);assert.deepEqual(status.body.invalid,[name])
  assert(!JSON.stringify(status.body).includes(value))
  assert.equal((await f.run()).statusCode,503);assert.equal(f.calls.length,0)
 }
})

test('provider errors give actionable categories without exposing upstream messages or secrets',async()=>{
 for(const [upstream,outcome,expected] of [
  [401,{message:'secret-key'},'provider_authentication'],[403,{message:'secret-key'},'provider_forbidden'],
  [402,{message:'secret-key'},'provider_credits'],[429,{message:'secret-key'},'provider_rate_limited'],
  [400,{code:'invalid_parameter',message:'sender secret-key'},'provider_sender'],
  [500,{message:'secret-key'},'delivery_unknown'],[201,null,'delivery_unknown']
 ]){
  const f=fixture({upstream,outcome}),response=await f.run()
  assert.equal(response.statusCode,502);assert.equal(response.body.error,expected)
  assert(!JSON.stringify(response.body).includes('secret-key'));assert.equal(f.calls.length,2)
 }
})

test('rejects non-object payloads and control characters before resolving a recipient',async()=>{
 for(const body of [[],1,null,{...message,preview:'hidden\0value'},{...message,expectedEmail:'bad\0email@example.invalid'}]){
  const f=fixture();assert.equal((await f.run('POST',body)).statusCode,400);assert.equal(f.calls.length,0)
 }
})
