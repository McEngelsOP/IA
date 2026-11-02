import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const ids={admin:'11111111-1111-4111-8111-111111111111',esan:'22222222-2222-4222-8222-222222222222',pending:'33333333-3333-4333-8333-333333333333',external:'44444444-4444-4444-8444-444444444444',unknown:'55555555-5555-4555-8555-555555555555'}
test('AI policy: protected verification, mandatory own keys, unified quotas, leases and legacy denial',async()=>{
 const db=new PGlite()
 const as=async(uid,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role '+role)}
 const rpc=async(sql,args=[]) => (await db.query('select '+sql+' as result',args)).rows[0].result
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;create schema vault;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,private,auth,vault to service_role;grant usage on schema public,auth to authenticated,anon;
   create table public.profiles(id uuid primary key,institution_id text,is_admin boolean default false);
   create function public.is_app_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and is_admin)$$;
   create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text);
   create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets;
   create function vault.create_secret(value text,label text,description text) returns uuid language plpgsql as $$declare sid uuid;begin insert into vault.secrets(secret)values(value)returning id into sid;return sid;end$$;
   create function vault.update_secret(sid uuid,value text) returns void language sql as $$update vault.secrets set secret=value where id=sid$$;
   create table private.advisor_limits(singleton boolean primary key,user_limit int,window_seconds int,global_minute_limit int,global_daily_limit int,requests timestamptz[] default '{}');
   insert into private.advisor_limits values(true,5,900,5,50,'{}');
   create function private.advisor_usage(p_consume boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
   declare uid uuid:=auth.uid();cfg private.advisor_limits;begin
    if uid is null then raise exception 'NO_AUTH';end if;
  select * into cfg from private.advisor_limits where singleton;
    return jsonb_build_object('allowed',true,'remaining',cfg.user_limit);
   end$$;
   create function public.advisor_usage(p_consume boolean default false) returns jsonb language sql as $$select private.advisor_usage(p_consume)$$;
   grant usage on schema private to authenticated;grant execute on function private.advisor_usage(boolean),public.advisor_usage(boolean) to authenticated;`)
  for(const [kind,id]of Object.entries(ids))await db.query('insert into profiles(id,institution_id,is_admin)values($1,$2,$3)',[id,kind==='external'?'other':kind==='unknown'?null:'esan',kind==='admin'])
  await db.exec(readFileSync('supabase/personal_ai_keys.sql','utf8'))
  await db.exec(readFileSync('supabase/ai_access_policy.sql','utf8'))
  await db.exec(readFileSync('supabase/ai_access_policy.sql','utf8'))
  for(const kind of ['esan','pending','external','unknown']){
   await as(ids[kind]);const policy=await rpc('ai_access_policy()');assert.equal(policy.access.sharedEligible,false);assert.equal(policy.access.mode,'personal')
   assert.equal((await rpc('advisor_usage(true)')).allowed,false)
   await assert.rejects(()=>rpc('ai_request_begin($1,$2,$3,$4)',[ids[kind],'system','chat',crypto.randomUUID()]),/permission denied/)
   await assert.rejects(()=>db.query('select * from private.ai_affiliations'),/permission denied/)
  }
  await as(ids.pending)
  await assert.rejects(()=>rpc('admin_set_ai_affiliation($1,true) ',[ids.pending]),/FORBIDDEN/)
  await as(ids.admin)
  await assert.rejects(()=>rpc('admin_set_ai_affiliation($1,true)',[ids.external]),/ESAN_AFFILIATION_REQUIRED/)
  await rpc('admin_set_ai_affiliation($1,true)',[ids.esan])
  await as(ids.esan);assert.equal((await rpc('ai_access_policy()')).access.sharedEligible,true)
  await as('', 'service_role')
  const own='fixture_key_personal_00000000000000'
  for(const kind of ['external','pending'])await rpc('ai_key_manage($1,$2,$3,$4)',[ids[kind],'save','groq',own])
  const externalRead=await rpc('ai_key_read($1)',[ids.external]);assert.equal(externalRead.mode,'personal');assert.equal(externalRead.providers[0].key,own)
  await assert.rejects(()=>rpc('ai_key_manage($1,$2,null,null,null,$3)',[ids.external,'mode','system']),/PERSONAL_KEY_REQUIRED/)
  assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.external,'system','chat',crypto.randomUUID()])).reason,'personal_key_required')
  const first=crypto.randomUUID(),second=crypto.randomUUID()
  assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.external,'personal','chat',first])).allowed,true)
  assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.external,'personal','schedule',second])).reason,'request_in_progress')
  await rpc('ai_request_finish($1,$2,true)',[ids.pending,first])
  assert.equal((await rpc('ai_usage($1,$2,$3)',[ids.external,'personal','chat'])).reason,'request_in_progress')
  await rpc('ai_request_finish($1,$2,false)',[ids.external,first])
  assert.equal((await rpc('ai_usage($1,$2,$3)',[ids.external,'personal','chat'])).dailyRemaining,199)
  assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.external,'personal','chat',first])).reason,'duplicate_request')
  const sys=crypto.randomUUID()
  assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.esan,'system','chat',sys])).dailyLimit,20)
  await rpc('ai_request_finish($1,$2,true)',[ids.esan,sys])
  // All tools contribute to the account window and day, including a failed request.
  for(let i=0;i<9;i++){const requestId=crypto.randomUUID();assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.external,'personal',i%2?'tasks':'chat',requestId])).allowed,true);await rpc('ai_request_finish($1,$2,true)',[ids.external,requestId])}
  assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.external,'personal','schedule',crypto.randomUUID()])).reason,'user_rate_limited')
  await rpc('ai_key_manage($1,$2,$3,$4)',[ids.external,'save','gemini',own])
  assert.equal((await rpc('ai_usage($1,$2,$3)',[ids.external,'personal','chat'])).remaining,0)
  // An expired request cannot hold the account forever or release a newer lease.
  const oldLease=crypto.randomUUID(),newLease=crypto.randomUUID()
  assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.pending,'personal','chat',oldLease])).allowed,true)
  await db.exec('reset role');await db.query("update private.ai_request_locks set expires_at=now()-interval '1 second' where user_id=$1",[ids.pending]);
  await as('', 'service_role');assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.pending,'personal','chat',newLease])).allowed,true)
  await rpc('ai_request_finish($1,$2,true)',[ids.pending,oldLease])
  assert.equal((await rpc('ai_usage($1,$2,$3)',[ids.pending,'personal','chat'])).reason,'request_in_progress')
  await rpc('ai_request_finish($1,$2,true)',[ids.pending,newLease])
  // Daily and extraction caps persist beyond the rolling window.
  await db.exec('reset role');await db.query('delete from private.ai_requests where user_id=$1',[ids.pending])
  await db.query("insert into private.ai_requests(id,user_id,source,resource,created_at) select gen_random_uuid(),$1,'personal','schedule',date_trunc('day',now() at time zone 'America/Lima') at time zone 'America/Lima' from generate_series(1,20)",[ids.pending])
  await as('', 'service_role');assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.pending,'personal','schedule',crypto.randomUUID()])).reason,'resource_limit')
  await db.exec('reset role');await db.query('delete from private.ai_requests where user_id=$1',[ids.pending])
  await db.query("insert into private.ai_requests(id,user_id,source,resource,created_at) select gen_random_uuid(),$1,'personal','chat',date_trunc('day',now() at time zone 'America/Lima') at time zone 'America/Lima' from generate_series(1,200)",[ids.pending])
  await as('', 'service_role');assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.pending,'personal','chat',crypto.randomUUID()])).reason,'daily_limit')
  // Existing shared pool caps include all accounts and old reservations.
  await db.exec('reset role');await db.query("update private.advisor_limits set requests=array_fill(now(),array[5])")
  await as('', 'service_role');assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.esan,'system','chat',crypto.randomUUID()])).reason,'global_rate_limited')
  await as(ids.admin);await rpc('admin_set_ai_affiliation($1,false)',[ids.esan])
  await as('', 'service_role');assert.equal((await rpc('ai_request_begin($1,$2,$3,$4)',[ids.esan,'system','chat',crypto.randomUUID()])).reason,'personal_key_required')
  await db.exec('reset role');assert.equal((await db.query("select count(*)::int n from private.ai_requests where user_id=$1",[ids.external])).rows[0].n,10)
  await as('', 'anon');await assert.rejects(()=>rpc('ai_access_policy()'),/permission denied/)
 }finally{await db.close()}
})
