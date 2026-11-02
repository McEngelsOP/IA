-- Additive application services. Run on an installed Lyra schema.
create schema if not exists app_private;
create table if not exists public.student_preferences (
 student_id uuid primary key references public.profiles(id) on delete cascade,
 values jsonb not null default '{}' check(jsonb_typeof(values)='object' and octet_length(values::text)<=120000),
 updated_at timestamptz not null default now()
);
alter table public.student_preferences enable row level security;
revoke all on public.student_preferences from public,anon,authenticated;
grant select,insert,update on public.student_preferences to authenticated;
create policy preferences_read on public.student_preferences for select to authenticated using((select auth.uid())=student_id);
create policy preferences_insert on public.student_preferences for insert to authenticated with check((select auth.uid())=student_id);
create policy preferences_update on public.student_preferences for update to authenticated using((select auth.uid())=student_id) with check((select auth.uid())=student_id);
create or replace function public.save_lyra_preferences(p_patch jsonb,p_owner uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or auth.uid() is distinct from p_owner then raise exception 'NO_AUTH' using errcode='42501'; end if;
 if jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text)>100000 or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('homeLayout','homeOrder','glow','diagnosis','theme','sidebar','focus','notifications')) then raise exception 'INVALID_PREFERENCES'; end if;
 if p_patch ? 'theme' and p_patch->>'theme' not in ('light','dark') then raise exception 'INVALID_THEME'; end if;
 if p_patch ? 'sidebar' and p_patch->>'sidebar' not in ('full','rail') then raise exception 'INVALID_SIDEBAR'; end if;
 if p_patch ? 'homeOrder' and (jsonb_typeof(p_patch->'homeOrder')<>'array' or jsonb_array_length(p_patch->'homeOrder')>7 or exists(select 1 from jsonb_array_elements_text(p_patch->'homeOrder') k where k not in ('hero','hoy','stats','notas','racha','semestre','panel'))) then raise exception 'INVALID_ORDER'; end if;
 insert into public.student_preferences(student_id,values) values(auth.uid(),p_patch)
 on conflict(student_id) do update set values=student_preferences.values||excluded.values,updated_at=clock_timestamp()
 returning jsonb_build_object('values',values,'updated_at',updated_at) into result;
 return result;
end $$;
revoke all on function public.save_lyra_preferences(jsonb,uuid) from public,anon;
grant execute on function public.save_lyra_preferences(jsonb,uuid) to authenticated;

create table if not exists public.institution_rules (
 institution_id text primary key, grade_scale jsonb not null,
 updated_at timestamptz not null default now()
);
alter table public.institution_rules enable row level security;
revoke all on public.institution_rules from public,anon,authenticated;
grant select on public.institution_rules to authenticated;
create policy institution_rules_read on public.institution_rules for select to authenticated using(true);
insert into public.institution_rules values('esan','{"kind":"numeric","min":0,"max":20,"passing":10.5,"decimals":2,"weighting":"credits"}') on conflict do nothing;
create or replace function app_private.validate_grade() returns trigger language plpgsql security definer set search_path='' as $$
declare scale jsonb;
begin
 select r.grade_scale into scale from public.profiles p join public.institution_rules r on r.institution_id=p.institution_id where p.id=new.student_id;
 if scale is null then raise exception 'GRADE_SCALE_UNAVAILABLE'; end if;
 if new.grade is null or new.grade='NaN'::numeric or new.grade<(scale->>'min')::numeric or new.grade>(scale->>'max')::numeric or round(new.grade,(scale->>'decimals')::integer)<>new.grade or (scale->>'kind'='letters' and not exists(select 1 from jsonb_each_text(scale->'letters') kv where kv.value::numeric=new.grade)) then raise exception 'GRADE_OUT_OF_SCALE'; end if;
 return new;
end $$;
revoke all on function app_private.validate_grade() from public,anon,authenticated;
alter table public.grades drop constraint if exists grades_grade_check;
create trigger validate_institution_grade before insert or update on public.grades for each row execute function app_private.validate_grade();

alter table public.curriculum_versions add column if not exists catalog jsonb;
alter table public.curriculum_versions add column if not exists plan_year integer check(plan_year between 1900 and 2200);
alter table public.curriculum_versions add column if not exists plan_name text;
alter table public.curriculum_versions add column if not exists published_at timestamptz;
create or replace function app_private.validate_curriculum() returns trigger language plpgsql set search_path='' as $$
declare course jsonb; ids text[]; cyclic boolean;
begin
 if old.catalog is not null and (new.catalog is distinct from old.catalog or new.plan_year is distinct from old.plan_year or new.plan_name is distinct from old.plan_name or new.source_hash is distinct from old.source_hash or new.version is distinct from old.version or new.institution_id is distinct from old.institution_id or new.career_key is distinct from old.career_key) then raise exception 'IMMUTABLE_CURRICULUM'; end if;
 if new.catalog is null then raise exception 'CURRICULUM_CATALOG_REQUIRED'; end if;
 if jsonb_typeof(new.catalog->'ciclos') is distinct from 'object' or jsonb_typeof(new.catalog->'nombre') is distinct from 'string' or jsonb_typeof(new.catalog->'uni') is distinct from 'string' or jsonb_typeof(new.catalog->'source') is distinct from 'string' or (new.catalog ? 'foot' and jsonb_typeof(new.catalog->'foot') is distinct from 'string') then raise exception 'INVALID_CURRICULUM'; end if;
 if octet_length(new.catalog::text)>500000 or new.catalog->>'key' is distinct from new.career_key or new.catalog->>'version' is distinct from new.version or new.catalog->>'institutionId' is distinct from new.institution_id or new.catalog->>'sourceHash' is distinct from new.source_hash or jsonb_typeof(new.catalog->'cursos') is distinct from 'array' or jsonb_array_length(new.catalog->'cursos') not between 1 and 500 then raise exception 'INVALID_CURRICULUM'; end if;
 select array_agg(c->>'id') into ids from jsonb_array_elements(new.catalog->'cursos') c;
 if cardinality(ids)<>(select count(distinct v) from unnest(ids) v) or exists(select 1 from unnest(ids) v where v is null or length(v) not between 1 and 180) then raise exception 'DUPLICATE_COURSE_ID'; end if;
 for course in select * from jsonb_array_elements(new.catalog->'cursos') loop
  if jsonb_typeof(course->'id') is distinct from 'string' or jsonb_typeof(course->'n') is distinct from 'string' or jsonb_typeof(new.catalog->'ciclos'->(course->>'c')->'t') is distinct from 'string' or exists(select 1 from jsonb_array_elements(course->'r') v where jsonb_typeof(v) is distinct from 'string') then raise exception 'INVALID_COURSE'; end if;
  if coalesce(length(course->>'n'),0) not between 1 and 240 or jsonb_typeof(course->'cr') is distinct from 'number' or (course->>'cr')::numeric not between 0 and 100 or jsonb_typeof(course->'c') is distinct from 'number' or (course->>'c')::numeric not between 0 and 30 or jsonb_typeof(course->'r') is distinct from 'array' then raise exception 'INVALID_COURSE'; end if;
  if exists(select 1 from jsonb_array_elements_text(course->'r') r where not(r=any(ids)) or r=course->>'id') then raise exception 'UNKNOWN_PREREQUISITE'; end if;
 end loop;
 if (new.catalog->>'total')::numeric is distinct from (select sum((c->>'cr')::numeric) from jsonb_array_elements(new.catalog->'cursos') c) then raise exception 'INVALID_TOTAL_CREDITS'; end if;
 with recursive edges as (select c->>'id' a,r b from jsonb_array_elements(new.catalog->'cursos') c cross join lateral jsonb_array_elements_text(c->'r') r), walk as (
 select a,b from edges
 union select w.a,e.b from walk w join edges e on e.a=w.b
 ) select exists(select 1 from walk where a=b) into cyclic;
 if cyclic then raise exception 'CYCLIC_CURRICULUM'; end if;
 return new;
end $$;
revoke all on function app_private.validate_curriculum() from public,anon,authenticated;
create trigger validate_curriculum_catalog before insert or update on public.curriculum_versions for each row execute function app_private.validate_curriculum();

create table if not exists app_private.moderator_scopes (
 user_id uuid references public.profiles(id) on delete cascade,
 institution_id text not null, scope text not null check(scope in ('academic','support')),
 primary key(user_id,institution_id,scope)
);
alter table app_private.moderator_scopes enable row level security;
revoke all on app_private.moderator_scopes from public,anon,authenticated;
create or replace function app_private.can_moderate(p_institution text,p_scope text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (public.is_app_admin() or exists(select 1 from app_private.moderator_scopes where user_id=auth.uid() and institution_id=p_institution and scope=p_scope));
$$;
revoke all on function app_private.can_moderate(text,text) from public,anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.can_moderate(text,text) to authenticated;
create or replace function app_private.moderation_access() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('admin',public.is_app_admin(),'scopes',coalesce((select jsonb_agg(jsonb_build_object('institution',institution_id,'scope',scope)) from app_private.moderator_scopes where user_id=auth.uid()),'[]')) where auth.uid() is not null;
$$;
create or replace function public.moderation_access() returns jsonb language sql security invoker set search_path='' as $$select app_private.moderation_access()$$;
create or replace function app_private.set_moderator(p_user uuid,p_institution text,p_scope text,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_enabled then insert into app_private.moderator_scopes values(p_user,p_institution,p_scope) on conflict do nothing;
 else delete from app_private.moderator_scopes where user_id=p_user and institution_id=p_institution and scope=p_scope; end if;
end $$;
create or replace function public.set_moderator(p_user uuid,p_institution text,p_scope text,p_enabled boolean) returns void language sql security invoker set search_path='' as $$select app_private.set_moderator(p_user,p_institution,p_scope,p_enabled)$$;
create or replace function app_private.publish_curriculum(p_catalog jsonb,p_year integer,p_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not app_private.can_moderate(p_catalog->>'institutionId','academic') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.curriculum_versions where institution_id=p_catalog->>'institutionId' and career_key=p_catalog->>'key') then raise exception 'CAREER_NOT_REGISTERED'; end if;
 insert into public.curriculum_versions(institution_id,career_key,version,source_hash,source_document,catalog,plan_year,plan_name,published_at)
 values(p_catalog->>'institutionId',p_catalog->>'key',p_catalog->>'version',p_catalog->>'sourceHash',p_catalog->>'source',p_catalog,p_year,nullif(left(p_name,160),''),now());
end $$;
create or replace function public.publish_curriculum(p_catalog jsonb,p_year integer,p_name text) returns void language sql security invoker set search_path='' as $$select app_private.publish_curriculum(p_catalog,p_year,p_name)$$;

create table if not exists public.curriculum_transitions (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.profiles(id) on delete cascade,
 from_version text, to_version text not null, snapshot jsonb not null, created_at timestamptz default now()
);
alter table public.curriculum_transitions enable row level security;
revoke all on public.curriculum_transitions from public,anon,authenticated;
grant select on public.curriculum_transitions to authenticated;
create policy transitions_read on public.curriculum_transitions for select to authenticated using((select auth.uid())=student_id);
create or replace function app_private.upgrade_curriculum(p_expected text,p_target text,p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); profile public.profiles; target public.curriculum_versions; ids text[]; mapping jsonb; pair record;
begin
 if uid is null or uid is distinct from p_owner then raise exception 'NO_AUTH' using errcode='42501'; end if;
 select * into profile from public.profiles where id=uid for update;
 if profile.curriculum_version is distinct from p_expected or p_target=p_expected then raise exception 'CURRICULUM_CHANGED'; end if;
 select * into target from public.curriculum_versions where institution_id=profile.institution_id and career_key=profile.carrera and version=p_target and published_at is not null and catalog is not null;
 if not found then raise exception 'CURRICULUM_UNAVAILABLE'; end if;
 select array_agg(c->>'id') into ids from jsonb_array_elements(target.catalog->'cursos') c;
 select coalesce(e.mapping,'{}') into mapping from public.curriculum_equivalences e where institution_id=profile.institution_id and career_key=profile.carrera and from_version=p_expected and to_version=p_target;
 mapping:=coalesce(mapping,'{}');
 if exists(select 1 from public.progress p cross join lateral unnest(p.done) d where p.student_id=uid and not(d=any(ids)) and not(mapping ? d)) or exists(select 1 from public.course_status s where student_id=uid and status in ('matriculado','aprobado','convalidado') and not(course_id=any(ids)) and not(mapping ? course_id)) then raise exception 'EQUIVALENCE_REVIEW_REQUIRED'; end if;
 -- Ambiguous records are never collapsed or overwritten.
 for pair in select key,value from jsonb_each_text(mapping) loop
  if exists(select 1 from public.course_status a join public.course_status b on a.student_id=b.student_id where a.student_id=uid and a.course_id=pair.key and b.course_id=pair.value) or exists(select 1 from public.grades a join public.grades b on a.student_id=b.student_id where a.student_id=uid and a.course_id=pair.key and b.course_id=pair.value) then raise exception 'EQUIVALENCE_RECORD_CONFLICT'; end if;
 end loop;
 insert into public.curriculum_transitions(student_id,from_version,to_version,snapshot) values(uid,p_expected,p_target,jsonb_build_object(
 'mapping',mapping,'progress',(select to_jsonb(p) from public.progress p where student_id=uid),'grades',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from public.grades g where student_id=uid),'statuses',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.course_status s where student_id=uid)));
 update public.progress set done=array(select coalesce(mapping->>c,c) from unnest(done) c),plan=array(select coalesce(mapping->>c,c) from unnest(plan) c where c=any(ids) or mapping ? c) where student_id=uid;
 for pair in select key,value from jsonb_each_text(mapping) loop
  update public.course_status set course_id=pair.value where student_id=uid and course_id=pair.key;
  update public.grades set course_id=pair.value where student_id=uid and course_id=pair.key;
 end loop;
 update public.profiles set curriculum_version=p_target where id=uid;
end $$;
create or replace function public.upgrade_curriculum(p_expected text,p_target text,p_owner uuid) returns void language sql security invoker set search_path='' as $$select app_private.upgrade_curriculum(p_expected,p_target,p_owner)$$;
-- Keep the existing career and assignment guard; permit only privileged server routines.
DO $$declare definition text; begin
 select pg_get_functiondef('public.protect_curriculum_assignment()'::regprocedure) into definition;
 definition:=replace(definition,'elsif auth.uid() is not null and (new.institution_id','elsif auth.uid() is not null and current_user in (''authenticated'',''anon'',''authenticator'') and (new.institution_id');
 execute definition;
end $$;

create table if not exists public.incident_reports (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.profiles(id) on delete cascade,
 institution_id text not null, category text not null check(category in ('error','suggestion','academic')),
 body text not null check(length(body) between 10 and 2000), status text not null default 'open' check(status in ('open','investigating','resolved')),
 created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.incident_reports enable row level security;
revoke all on public.incident_reports from public,anon,authenticated;
grant select,insert on public.incident_reports to authenticated;
create policy reports_read on public.incident_reports for select to authenticated using((select auth.uid())=student_id or app_private.can_moderate(institution_id,case when category='academic' then 'academic' else 'support' end));
create policy reports_insert on public.incident_reports for insert to authenticated with check((select auth.uid())=student_id and status='open' and institution_id=(select p.institution_id from public.profiles p where id=(select auth.uid())));
create index reports_queue on public.incident_reports(institution_id,status,created_at desc);
create or replace function app_private.report_limit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where id=new.student_id for update;
 if (select count(*) from public.incident_reports where student_id=new.student_id and created_at>now()-interval '1 hour')>=10 then raise exception 'REPORT_RATE_LIMIT'; end if;
 new.created_at:=now();new.updated_at:=now();return new;
end $$;
create trigger incident_report_limit before insert on public.incident_reports for each row execute function app_private.report_limit();
revoke all on function app_private.report_limit() from public,anon,authenticated;
create or replace function app_private.resolve_report(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare item public.incident_reports;
begin
 select * into item from public.incident_reports where id=p_id for update;
 if not found or not app_private.can_moderate(item.institution_id,case when item.category='academic' then 'academic' else 'support' end) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 update public.incident_reports set status=p_status,updated_at=now() where id=p_id;
end $$;
create or replace function public.resolve_report(p_id uuid,p_status text) returns void language sql security invoker set search_path='' as $$select app_private.resolve_report(p_id,p_status)$$;
create table if not exists public.service_events (
 id uuid primary key default gen_random_uuid(), student_id uuid references public.profiles(id) on delete set null,
 code text not null check(code in ('client_error','unhandled_rejection','academic_load','calendar_load','calendar_save','ai_failure')),
 created_at timestamptz not null default now()
);
alter table public.service_events enable row level security;
revoke all on public.service_events from public,anon,authenticated;
create index service_events_date on public.service_events(created_at desc);
create or replace function app_private.record_service_event(p_code text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'NO_AUTH' using errcode='42501'; end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 if (select count(*) from public.service_events where student_id=auth.uid() and created_at>now()-interval '1 hour')>=30 then return; end if;
 insert into public.service_events(student_id,code) values(auth.uid(),p_code);
 delete from public.service_events where created_at<now()-interval '30 days';
end $$;
create or replace function public.record_service_event(p_code text) returns void language sql security invoker set search_path='' as $$select app_private.record_service_event(p_code)$$;
create or replace function app_private.service_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('errors',(select coalesce(jsonb_agg(t),'[]') from (select code,count(*) total,max(created_at) last_at from public.service_events where created_at>now()-interval '7 days' group by code) t),
 'providers',(select coalesce(jsonb_agg(t),'[]') from (select provider,last_status,last_model,last_duration_ms,retry_until,updated_at,daily_limit,(select count(*) from unnest(requests) at where at>now()-interval '24 hours') requests_24h from private.advisor_provider_usage) t),
 'reports',(select count(*) from public.incident_reports where status<>'resolved'));
end $$;
create or replace function public.service_dashboard() returns jsonb language sql security invoker set search_path='' as $$select app_private.service_dashboard()$$;
DO $$declare signature text; begin
 foreach signature in array array['moderation_access()','set_moderator(uuid,text,text,boolean)','publish_curriculum(jsonb,integer,text)','upgrade_curriculum(text,text,uuid)','resolve_report(uuid,text)','record_service_event(text)','service_dashboard()'] loop
  execute 'revoke all on function public.'||signature||' from public,anon';
  execute 'revoke all on function app_private.'||signature||' from public,anon';
  execute 'grant execute on function public.'||signature||' to authenticated';
  execute 'grant execute on function app_private.'||signature||' to authenticated';
 end loop;
end $$;
create or replace function app_private.set_institution_grading(p_institution text,p_scale jsonb) returns void language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if jsonb_typeof(p_scale) is distinct from 'object' or jsonb_typeof(p_scale->'min') is distinct from 'number' or jsonb_typeof(p_scale->'max') is distinct from 'number' or jsonb_typeof(p_scale->'passing') is distinct from 'number' or jsonb_typeof(p_scale->'decimals') is distinct from 'number' or jsonb_typeof(p_scale->'kind') is distinct from 'string' or jsonb_typeof(p_scale->'weighting') is distinct from 'string' then raise exception 'INVALID_GRADE_SCALE'; end if;
 if (p_scale->>'min')::numeric<0 or mod((p_scale->>'decimals')::numeric,1)<>0 then raise exception 'INVALID_GRADE_SCALE'; end if;
 if p_institution is null or length(p_institution) not between 1 and 80 or jsonb_typeof(p_scale) is distinct from 'object' or octet_length(p_scale::text)>8000 or p_scale->>'kind' not in ('numeric','letters') or p_scale->>'weighting' not in ('credits','equal') or (p_scale->>'min')::numeric >= (p_scale->>'max')::numeric or (p_scale->>'passing')::numeric not between (p_scale->>'min')::numeric and (p_scale->>'max')::numeric or (p_scale->>'decimals')::integer not between 0 and 4 or not(p_scale ?& array['min','max','passing','kind','weighting','decimals']) then raise exception 'INVALID_GRADE_SCALE'; end if;
 if p_scale->>'kind'='letters' then
  if jsonb_typeof(p_scale->'letters') is distinct from 'object' then raise exception 'INVALID_GRADE_SCALE'; end if;
  if exists(select 1 from jsonb_each(p_scale->'letters') kv where jsonb_typeof(kv.value) is distinct from 'number' or kv.key !~ '^[A-Z][A-Z0-9+-]{0,5}$') or (select count(*)<>count(distinct value) from jsonb_each(p_scale->'letters')) then raise exception 'INVALID_GRADE_SCALE'; end if;
 end if;
 if p_scale->>'kind'='letters' and (jsonb_typeof(p_scale->'letters') is distinct from 'object' or (select count(*) from jsonb_each(p_scale->'letters'))<2 or exists(select 1 from jsonb_each_text(p_scale->'letters') kv where kv.value::numeric not between (p_scale->>'min')::numeric and (p_scale->>'max')::numeric)) then raise exception 'INVALID_GRADE_SCALE'; end if;
 select grade_scale into prior from public.institution_rules where institution_id=p_institution for update;
 if exists(select 1 from public.grades g join public.profiles p on p.id=g.student_id where p.institution_id=p_institution) and (prior->'min' is distinct from p_scale->'min' or prior->'max' is distinct from p_scale->'max' or prior->'kind' is distinct from p_scale->'kind' or prior->'letters' is distinct from p_scale->'letters') then raise exception 'GRADE_SCALE_HAS_RECORDS'; end if;
 insert into public.institution_rules(institution_id,grade_scale) values(p_institution,p_scale) on conflict(institution_id) do update set grade_scale=excluded.grade_scale,updated_at=now();
end $$;
create or replace function public.set_institution_grading(p_institution text,p_scale jsonb) returns void language sql security invoker set search_path='' as $$select app_private.set_institution_grading(p_institution,p_scale)$$;
revoke all on function public.set_institution_grading(text,jsonb),app_private.set_institution_grading(text,jsonb) from public,anon;
grant execute on function public.set_institution_grading(text,jsonb),app_private.set_institution_grading(text,jsonb) to authenticated;
create table if not exists public.curriculum_equivalences (
 institution_id text not null,career_key text not null,from_version text not null,to_version text not null,
 mapping jsonb not null check(jsonb_typeof(mapping)='object'), primary key(institution_id,career_key,from_version,to_version)
);
alter table public.curriculum_equivalences enable row level security;
revoke all on public.curriculum_equivalences from public,anon,authenticated;
grant select on public.curriculum_equivalences to authenticated;
create policy equivalences_read on public.curriculum_equivalences for select to authenticated using(true);
create or replace function app_private.set_curriculum_equivalences(p_institution text,p_career text,p_from text,p_to text,p_mapping jsonb) returns void language plpgsql security definer set search_path='' as $$
declare source_ids text[]; target_ids text[];
begin
 if not app_private.can_moderate(p_institution,'academic') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select array_agg(c->>'id') into source_ids from public.curriculum_versions v cross join lateral jsonb_array_elements(v.catalog->'cursos') c where v.institution_id=p_institution and v.career_key=p_career and v.version=p_from;
 select array_agg(c->>'id') into target_ids from public.curriculum_versions v cross join lateral jsonb_array_elements(v.catalog->'cursos') c where v.institution_id=p_institution and v.career_key=p_career and v.version=p_to;
 if source_ids is null or target_ids is null or p_from=p_to or jsonb_typeof(p_mapping) is distinct from 'object' or octet_length(p_mapping::text)>100000 then raise exception 'INVALID_EQUIVALENCES'; end if;
 if exists(select 1 from jsonb_each_text(p_mapping) m where not(m.key=any(source_ids)) or not(m.value=any(target_ids)) or m.key=any(target_ids)) then raise exception 'INVALID_EQUIVALENCES'; end if;
 if (select count(*)<>count(distinct value) from jsonb_each_text(p_mapping)) then raise exception 'AMBIGUOUS_EQUIVALENCES'; end if;
 insert into public.curriculum_equivalences values(p_institution,p_career,p_from,p_to,p_mapping) on conflict(institution_id,career_key,from_version,to_version) do update set mapping=excluded.mapping;
end $$;
create or replace function public.set_curriculum_equivalences(p_institution text,p_career text,p_from text,p_to text,p_mapping jsonb) returns void language sql security invoker set search_path='' as $$select app_private.set_curriculum_equivalences(p_institution,p_career,p_from,p_to,p_mapping)$$;
revoke all on function public.set_curriculum_equivalences(text,text,text,text,jsonb),app_private.set_curriculum_equivalences(text,text,text,text,jsonb) from public,anon;
grant execute on function public.set_curriculum_equivalences(text,text,text,text,jsonb),app_private.set_curriculum_equivalences(text,text,text,text,jsonb) to authenticated;
