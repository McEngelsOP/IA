import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {CARRERAS} from '../../src/institutions/esan/carreras.js'
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
 await db.exec(readFileSync('supabase/system_catalog_seed.sql','utf8'))
 await db.exec(readFileSync('supabase/system_catalog_seed.sql','utf8'))
 const as=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role)}
 return {db,as}
}
