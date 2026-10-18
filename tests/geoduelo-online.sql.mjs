import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {PGlite}=require(process.env.PGLITE_PATH || '@electric-sql/pglite')
const db=new PGlite()
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002',c='10000000-0000-4000-8000-000000000003'
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create table auth.users(id uuid primary key);insert into auth.users values('${a}'),('${b}'),('${c}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`)
  const sql=await fs.readFile(new URL('../supabase/geoduelo-online.sql',import.meta.url),'utf8')
  await db.exec(sql);await db.exec(sql)
  const query='select public.record_geoduelo_online($1,$2,$3,$4,$5,$6,$7)'
  const id=crypto.randomUUID(),params=[id,a,b,1400,900,'completed',0]
  await db.exec('set role service_role');await db.query(query,params);await db.query(query,params);await db.exec('reset role')
  assert.equal((await db.query('select count(*)::int n from geoduelo_online_results')).rows[0].n,1)
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(db.query(query,[crypto.randomUUID(),a,b,1500,0,'completed',0]),/permission denied/)
    await assert.rejects(db.query(`insert into geoduelo_online_results values('${crypto.randomUUID()}','${a}','${b}',1,0,'completed',0,now())`),/permission denied/)
    await db.exec('reset role')
  }
  await db.exec(`set request.jwt.claim.sub='${a}';set role authenticated`)
  assert.equal((await db.query('select count(*)::int n from geoduelo_online_results')).rows[0].n,1)
  await db.exec(`reset role;set request.jwt.claim.sub='${c}';set role authenticated`)
  assert.equal((await db.query('select count(*)::int n from geoduelo_online_results')).rows[0].n,0)
  await db.exec('reset role;set role service_role')
  await assert.rejects(db.query(query,[crypto.randomUUID(),a,b,1501,0,'completed',0]),/BAD_RESULT/)
  await assert.rejects(db.query(query,[crypto.randomUUID(),a,b,1500,0,'completed',1]),/BAD_WINNER/)
  await assert.rejects(db.query(query,[crypto.randomUUID(),a,a,1500,0,'completed',0]),/BAD_RESULT/)
  console.log('PASS SQL: rerunnable, idempotent, server-only writes, participant RLS, bounds and winner validation')
} finally {await db.close()}
