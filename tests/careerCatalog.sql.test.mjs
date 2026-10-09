import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { CARRERAS } from '../src/data/carreras.js'
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')
const read = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8')
const db = new PGlite()
await db.exec(`
create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
`)
await db.exec(read('setup.sql'))
await db.exec(`alter table profiles add column carrera text constraint old_career_check check(carrera in ('ia','industrial','marketing','pucp-mecatronica'));
alter table profiles add column alias text;
create table progress(student_id uuid primary key,done text[],plan text[]);
create table course_status(student_id uuid,course_id text,status text,times_taken int);
create table course_comments(author_id uuid);
create table professors(id uuid,created_by uuid);
create table professor_tags(student_id uuid);
create table professor_votes(professor_id uuid,student_id uuid,vote int);
create table tools(id uuid,created_by uuid);
create table tool_likes(tool_id uuid);
create table game_scores(student_id uuid,game text,score int,season text);
create function temporada_actual() returns text language sql as $$select 'fixture'::text$$;
grant select,update on profiles to authenticated;
`)
await db.exec(read('carrera.sql').slice(read('carrera.sql').indexOf('create or replace function public.lock_carrera()')))
const historic='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
await db.query('insert into auth.users values($1,$2,$3)',[historic,'historic@example.invalid',{student_code:'25123456',carrera:'ia'}])
await db.query('update profiles set carrera=$1 where id=$2',['ia',historic])
await db.query('insert into progress values($1,$2,$3)',[historic,['calc1'],['prog1']])
// The migration also works without the optional sections installed.
await db.exec(read('careers_catalog.sql'));await db.exec(read('careers_catalog.sql'))
assert.deepEqual((await db.query('select done,plan from progress where student_id=$1',[historic])).rows[0],{done:['calc1'],plan:['prog1']})
await db.exec(read('focus_sessions.sql'));await db.exec(read('logros.sql'))
await db.exec(read('careers_catalog.sql'));await db.exec(read('careers_catalog.sql'))
const as=async uid=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated')}
let index=0
for(const [key,career] of Object.entries(CARRERAS)){
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)")
  index++
  const uid=`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`
  const code=(key==='pucp-mecatronica'?'20':'25')+String(index).padStart(6,'0')
  await db.query('insert into auth.users values($1,$2,$3)',[uid,`career${index}@example.invalid`,{student_code:code,carrera:key}])
  assert.equal((await db.query('select carrera from profiles where id=$1',[uid])).rows[0].carrera,key)
  const course=career.cursos.find(c=>c.cr>0)
  await db.query('insert into course_status values($1,$2,$3,1)',[uid,course.id,'matriculado'])
  await db.query('insert into progress values($1,$2,$3)',[uid,career.cursos.slice(0,-1).map(c=>c.id),[]])
  await as(uid)
  const session=(await db.query("select start_focus_session($1,$2,300,'custom','digital','cat') as data",[uid,course.id])).rows[0].data
  assert.equal(session.career,key)
  let earned=(await db.query('select reclamar_logros() as achievement')).rows.map(r=>r.achievement)
  assert(!earned.includes('malla-completa'))
  await assert.rejects(()=>db.query('update profiles set carrera=$1 where id=$2',[key==='ia'?'software':'ia',uid]),/La carrera no se puede cambiar/)
  await db.exec('reset role')
  await db.query('update progress set done=$1 where student_id=$2',[career.cursos.map(c=>c.id),uid])
  await as(uid)
  earned=(await db.query('select reclamar_logros() as achievement')).rows.map(r=>r.achievement)
  assert(earned.includes('malla-completa'),key)
}
await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)")
for(const [career,code,expected] of [['unknown','25111111',/INVALID_CAREER/],[null,'25111111',/INVALID_CAREER/],['software','20111111',/invalid student code/],['pucp-mecatronica','25111111',/invalid student code/]]){
  await assert.rejects(()=>db.query('insert into auth.users values(gen_random_uuid(),$1,$2)',['bad@example.invalid',{student_code:code,carrera:career}]),expected)
}
await db.exec('set role anon')
await assert.rejects(()=>db.exec("select start_focus_session(gen_random_uuid(),null,300,'custom','digital','cat')"),/permission denied/)
await db.close()
console.log('PASS: 19 registration triggers, Focus enrollment and full-curriculum achievements; legacy progress preserved; repeated migration with/without optional sections; invalid career/university rejected; career lock and anonymous permissions preserved')
