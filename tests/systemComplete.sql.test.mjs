import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { CARRERAS } from '../src/institutions/esan/carreras.js'
const admin='11111111-1111-4111-8111-111111111111',student='22222222-2222-4222-8222-222222222222',moderator='33333333-3333-4333-8333-333333333333'
export async function setupDatabase() {
 const db=new PGlite()
 await db.exec(`create role anon; create role authenticated;create schema auth;create schema private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated;
 create table profiles(id uuid primary key,institution_id text,carrera text,curriculum_version text,is_admin boolean);
 create function public.is_app_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and is_admin)$$;
 create function public.protect_curriculum_assignment() returns trigger language plpgsql set search_path='' as $$begin if false then null; elsif auth.uid() is not null and (new.institution_id is distinct from old.institution_id or new.curriculum_version is distinct from old.curriculum_version) then raise exception 'CURRICULUM_ASSIGNMENT_LOCKED';end if;return new;end$$;
 create trigger protect_curriculum_assignment before update on profiles for each row execute function protect_curriculum_assignment();
 create table curriculum_versions(institution_id text,career_key text,version text,source_hash text,source_document text,primary key(institution_id,career_key,version));
 create table progress(student_id uuid primary key,done text[],plan text[],updated_at timestamptz default now());
 create table grades(student_id uuid references profiles(id),course_id text,grade numeric check(grade>=0 and grade<=20),updated_at timestamptz default now(),primary key(student_id,course_id));
 create table course_status(student_id uuid,course_id text,status text,primary key(student_id,course_id));
 create table private.advisor_provider_usage(provider text,requests timestamptz[],last_status text,last_model text,last_duration_ms int,retry_until timestamptz,updated_at timestamptz,daily_limit int);
 alter table profiles enable row level security;create policy own_profile on profiles to authenticated using(id=auth.uid()) with check(id=auth.uid());grant select,update(institution_id,curriculum_version) on profiles to authenticated;
 alter table curriculum_versions enable row level security;create policy catalog_read on curriculum_versions for select to authenticated using(true);grant select on curriculum_versions to authenticated;
 insert into profiles values('${admin}','esan','ia','${CARRERAS.ia.version}',true),('${student}','esan','ia','${CARRERAS.ia.version}',false),('${moderator}','esan','ia','${CARRERAS.ia.version}',false);
 insert into progress values('${student}',array['calc1'],array['calc2'],now());`)
 for(const c of Object.values(CARRERAS)) await db.query('insert into curriculum_versions values($1,$2,$3,$4,$5)',[c.institutionId,c.key,c.version,c.sourceHash,c.source])
 await db.exec(readFileSync('supabase/system_complete.sql','utf8'))
 for(const c of Object.values(CARRERAS)) await db.query('update curriculum_versions set catalog=$1,published_at=now() where career_key=$2 and version=$3',[c,c.key,c.version])
 const as=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role)}
 return {db,as}
}
test('server validation, account isolation, scoped moderation and lossless version upgrade',async()=>{
 const {db,as}=await setupDatabase()
 try {
  assert.equal((await db.query('select count(*)::int n from curriculum_versions where catalog is not null')).rows[0].n,18)
  await as(student)
  await assert.rejects(()=>db.query('select save_lyra_preferences($1,$2)',[{theme:'dark'},admin]),/NO_AUTH/)
  await db.query('select save_lyra_preferences($1,$2)',[{theme:'light'},student])
  await db.query('select save_lyra_preferences($1,$2)',[{homeOrder:['stats','hero']},student])
  assert.deepEqual((await db.query('select values from student_preferences')).rows[0].values,{theme:'light',homeOrder:['stats','hero']})
  await assert.rejects(()=>db.query("insert into student_preferences(student_id) values($1)",[admin]),/row-level security/)
  await assert.rejects(()=>db.query('select save_lyra_preferences($1,$2)',[{is_admin:true},student]),/INVALID_PREFERENCES/)
  for(const call of ['service_dashboard()','set_moderator($1,\'esan\',\'academic\',true)']) await assert.rejects(()=>db.query('select '+call,call.includes('$1')?[student]:[]),/FORBIDDEN/)
  await db.query("insert into incident_reports(student_id,institution_id,category,body) values($1,'esan','academic','Curso que necesita revisión')",[student])
  await as(moderator)
  assert.equal((await db.query('select count(*)::int n from incident_reports')).rows[0].n,0)
  await as(admin)
  await assert.rejects(()=>db.query('select set_institution_grading($1,$2)',['bad',{kind:'numeric',min:null,max:null,passing:null,decimals:2,weighting:'credits'}]),/INVALID_GRADE_SCALE/)
  await db.query("select set_moderator($1,'esan','academic',true)",[moderator])
  await as(moderator)
  const report=(await db.query('select id from incident_reports')).rows[0]
  assert(report)
  await db.query("select resolve_report($1,'investigating')",[report.id])
  await assert.rejects(()=>db.query('select service_dashboard()'),/FORBIDDEN/)
  const next=structuredClone(CARRERAS.ia);next.version='test-next';next.sourceHash='verified-test-source';next.cursos.find(c=>c.id==='calc1').n='Cálculo I revisado'
  await db.query('select publish_curriculum($1,2027,$2)',[next,'Plan de prueba'])
  const bad=structuredClone(next);bad.version='bad-cycle';bad.cursos.find(c=>c.id==='mat0').r=['calc1']
  await assert.rejects(()=>db.query('select publish_curriculum($1,null,null)',[bad]),/CYCLIC_CURRICULUM/)
  bad.version='bad-reference';bad.cursos.find(c=>c.id==='mat0').r=['unknown']
  await assert.rejects(()=>db.query('select publish_curriculum($1,null,null)',[bad]),/UNKNOWN_PREREQUISITE/)
  bad.version='bad-credit';bad.cursos.find(c=>c.id==='mat0').r=[];bad.total=999
  await assert.rejects(()=>db.query('select publish_curriculum($1,null,null)',[bad]),/INVALID_TOTAL_CREDITS/)
  await as(student)
  await assert.rejects(()=>db.query("update profiles set curriculum_version='test-next' where id=$1",[student]),/CURRICULUM_ASSIGNMENT_LOCKED/)
  await db.query('select upgrade_curriculum($1,$2,$3)',[CARRERAS.ia.version,'test-next',student])
  assert.equal((await db.query('select curriculum_version from profiles')).rows[0].curriculum_version,'test-next')
  assert.equal((await db.query('select count(*)::int n from curriculum_transitions')).rows[0].n,1)
  await as(moderator)
  const renamed=structuredClone(next);renamed.version='test-renamed';renamed.cursos.forEach(c=>{if(c.id==='calc1')c.id='calculus1';c.r=c.r.map(id=>id==='calc1'?'calculus1':id)})
  await db.query('select publish_curriculum($1,2028,$2)',[renamed,'Plan con equivalencia'])
  await as(student)
  await assert.rejects(()=>db.query('select upgrade_curriculum($1,$2,$3)',['test-next','test-renamed',student]),/EQUIVALENCE_REVIEW_REQUIRED/)
  await as(moderator)
  await db.query('select set_curriculum_equivalences($1,$2,$3,$4,$5)',['esan','ia','test-next','test-renamed',{calc1:'calculus1'}])
  await as(student)
  await db.query('select upgrade_curriculum($1,$2,$3)',['test-next','test-renamed',student])
  assert.equal((await db.query('select count(*)::int n from curriculum_transitions')).rows[0].n,2)
  await as(admin)
  await db.query("select set_moderator($1,'esan','academic',false)",[moderator])
  await as(moderator)
  await assert.rejects(()=>db.query('select publish_curriculum($1,null,null)',[bad]),/FORBIDDEN/)
  await as('', 'anon')
  await assert.rejects(()=>db.query('select save_lyra_preferences($1,$2)',[{},student]),/permission denied/)
  await db.exec('reset role')
  await db.query("insert into grades(student_id,course_id,grade) values($1,'calc1',16)",[student])
  await assert.rejects(()=>db.query("insert into grades(student_id,course_id,grade) values($1,'prog1',70)",[student]),/GRADE_OUT_OF_SCALE/)
  await assert.rejects(()=>db.query("update curriculum_versions set catalog=jsonb_set(catalog,'{total}','999') where version='test-next'"),/IMMUTABLE_CURRICULUM/)
  const done=(await db.query('select done from progress where student_id=$1',[student])).rows[0].done
  assert.deepEqual(done,['calculus1'])
 }finally{await db.close()}
})
