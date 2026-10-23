import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',OP='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',EV='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
test('SQL: RLS, atomic saves, retries, conflicts, dates, event hours and anonymous denial',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;create table profiles(id uuid primary key);create table progress(student_id uuid primary key);insert into profiles values('${A}'),('${B}');alter table profiles enable row level security;create policy own_profile on profiles for all to authenticated using(auth.uid()=id) with check(auth.uid()=id);grant select,update on profiles to authenticated;`)
  await db.exec(readFileSync('supabase/sync_features.sql','utf8'))
  const sql=readFileSync('supabase/assistant_local.sql','utf8');await db.exec(sql);await db.exec(sql)
  const as=uid=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${uid}',false);set role authenticated;`)
  const task={kind:'task',title:'Informe',date:'2026-10-25',start_time:'',end_time:''}
  const save=(op,draft)=>db.query('select assistant_save_draft($1,$2::jsonb) result',[op,JSON.stringify(draft)])
  await as(A)
  assert.equal((await save(OP,task)).rows[0].result.replayed,false)
  assert.equal((await save(OP,task)).rows[0].result.replayed,true)
  assert.equal((await db.query('select * from calendar_tasks')).rows.length,1)
  await assert.rejects(()=>save(OP,{...task,title:'Otro'}),/OPERATION_CONFLICT/)
  await assert.rejects(()=>save(EV,{...task,date:'2026-02-30'}),/INVALID_DRAFT/)
  await assert.rejects(()=>save(EV,{...task,student_id:B}),/INVALID_DRAFT/)
  await assert.rejects(()=>save(EV,{...task,kind:'event',start_time:'14:00',end_time:'13:00'}),/INVALID_DRAFT/)
  assert.equal((await save(EV,{...task,kind:'event',start_time:'13:00',end_time:'14:00'})).rows[0].result.kind,'event')
  await as(B)
  for(const table of ['calendar_tasks','calendar_events','assistant_operations'])assert.equal((await db.query('select * from '+table)).rows.length,0)
  await assert.rejects(()=>db.query('insert into calendar_tasks(student_id,title,due_date) values($1,$2,$3)',[A,'Ataque','2026-10-25']),/row-level security/)
  await db.exec('reset role;set role anon;')
  await assert.rejects(()=>save(OP,task),/permission denied/)
 }finally{await db.close()}
})
