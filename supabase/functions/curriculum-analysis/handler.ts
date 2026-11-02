import { configuredProviders, generateAdvisorAnswer } from '../study-advisor/providers.ts';
import { SYSTEM, POLICY_VERSION, parseAssessment, inspectRows, decide, analysisContext } from './policy.mjs';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type, x-curriculum-worker-secret','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function createCurriculumHandler({createClient,env,fetch:fetchImpl=fetch}:{createClient:any;env:(key:string)=>string|undefined;fetch?:typeof fetch}) {
 return async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  try{
   const reader=req.body?.getReader();let raw='';let bytes=0;const decoder=new TextDecoder();
   if(reader)while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2048){await reader.cancel();return json({error:'request_too_large'},413)}raw+=decoder.decode(value,{stream:true})}
   let body;try{body=JSON.parse(raw)}catch{return json({error:'bad_request'},400)}
   if(!body||!['analyze','worker'].includes(body.action)||body.action==='analyze'&&!uuid(body.curriculumId))return json({error:'bad_request'},400);
   const url=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),service=env('SUPABASE_SERVICE_ROLE_KEY');
   if(!url||!anon||!service)return json({error:'configuration_missing'},503);
   const started=Date.now();const bounded:typeof fetch=(input,init={})=>fetchImpl(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(Math.max(1,55000-(Date.now()-started))),...(init.signal?[init.signal]:[])])});
   const server=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:bounded}});
   let owner:string|null=null;
   if(body.action==='worker'){
    const secret=env('CURRICULUM_WORKER_SECRET');
    if(!secret||secret.length<32||req.headers.get('x-curriculum-worker-secret')!==secret)return json({error:'unauthorized'},401);
   }else{
    const authorization=req.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return json({error:'unauthorized'},401);
    const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization},fetch:bounded}});
    const auth=await client.auth.getUser();if(auth.error||!auth.data?.user)return json({error:'unauthorized'},401);owner=auth.data.user.id;
    // RLS hides submissions belonging to another user, even from moderators on this endpoint.
    const own=await client.from('custom_curricula').select('owner_id').eq('id',body.curriculumId).maybeSingle();
    if(own.error||own.data?.owner_id!==owner)return json({error:'not_found'},404);
   }
   const claim=await server.rpc('claim_curriculum_analysis',{p_curriculum:body.action==='analyze'?body.curriculumId:null,p_owner:owner});
   if(claim.error)return json({error:'queue_unavailable'},503);
   const job=claim.data;if(!job)return json({status:'no_work'});
   let result:any;
   const context=analysisContext(job);
   if(job.attempts>3||!job.source_text?.trim()||context.length>120000){
    result={policy:POLICY_VERSION,decision:'review',summary:job.attempts>3?'El análisis no pudo finalizar tras varios intentos. Revisión por moderación.':!job.source_text?.trim()?'Falta el texto original para contrastar los cursos. Revisión por moderación.':'El documento supera el tamaño de análisis automático. Se conservará completo para moderación.',issues:[],assessments:[],failures:[]};
   }else{
    const providers=configuredProviders(name=>name==='ADVISOR_PROVIDER_ORDER'?(env('CURRICULUM_PROVIDER_ORDER')||'gemini,groq,openrouter'):env(name));
    const assessments:any[]=[],failures:any[]=[];
    const rules=inspectRows(job.rows,job.source_text);
    async function assess(provider:any){
     const response=await generateAdvisorAnswer({providers:[provider],system:SYSTEM,context,history:[],fetch:bounded,maxAttempts:1,maxOutputTokens:2400,deadlineMs:18000,
      validateAnswer:a=>!!parseAssessment(a,job.rows.length),
      reserve:async(p,m)=>{const r=await server.rpc('curriculum_provider_reserve',{p_provider:p,p_model:m});return r.error?null:r.data},
      report:async(p,m,s,w,d)=>{await server.rpc('curriculum_provider_report',{p_provider:p,p_model:m,p_status:s,p_retry_after_seconds:w,p_duration_ms:d})}});
     const parsed=response.answer?parseAssessment(response.answer,job.rows.length):null;
     if(parsed)assessments.push({...parsed,provider:provider.name,model:response.model||provider.model});else failures.push({provider:provider.name,error:response.error||'invalid_response'});
    }
    await Promise.all(providers.slice(0,2).map(assess));
    // The third provider resolves uncertainty. Never retry a document after a safety refusal.
    if(providers[2]&&!failures.some(f=>f.error==='content_blocked')&&decide(assessments,rules,failures).decision==='review')await assess(providers[2]);
    result=decide(assessments,rules,failures);
    if(!providers.length)result.summary='Los proveedores integrados no están configurados. La malla quedó en revisión por moderación.';
   }
   const done=await server.rpc('finish_curriculum_analysis',{p_job:job.job_id,p_token:job.lease_token,p_result:result});
   if(done.error||done.data!==true)return json({error:'save_unconfirmed'},503);
   return json({status:'completed',decision:result.decision});
  }catch{return json({error:'analysis_unavailable'},503)}
 };
}
