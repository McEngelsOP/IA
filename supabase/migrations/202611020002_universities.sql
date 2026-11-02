-- Apply after system_complete.sql and the shared AI access policy. Preserve ESAN data/IDs.
begin;
create or replace function public.university_name_key(v text) returns text language sql immutable set search_path='' as $$select regexp_replace(lower(translate(trim(v),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')),'[^a-z0-9]+','','g')$$;
create table public.universities(id text primary key default 'u-'||gen_random_uuid()::text,name text not null check(length(trim(name)) between 2 and 120),name_key text generated always as(public.university_name_key(name)) stored unique,status text not null default 'pending' check(status in ('pending','approved','rejected')));
insert into public.universities values('esan','Universidad ESAN',default,'approved');
alter table public.profiles alter column student_code drop not null;
alter table public.profiles drop constraint if exists profiles_student_code_format;
alter table public.profiles drop constraint if exists profiles_carrera_check;
alter table public.profiles add column if not exists university_name text;
alter table public.profiles add column if not exists external_career text;
alter table public.profiles add column if not exists custom_curriculum_id uuid;
update public.profiles set institution_id='esan',university_name='Universidad ESAN' where institution_id is null and (carrera is null or exists(select 1 from public.curriculum_versions v where v.institution_id='esan' and v.career_key=profiles.carrera));
create table public.custom_curricula(id uuid primary key,owner_id uuid not null references public.profiles(id) on delete cascade,institution_id text not null references public.universities(id),career_name text not null check(length(trim(career_name)) between 2 and 120),rows jsonb not null,markdown text not null check(octet_length(markdown)<=300000),source_name text not null,status text not null default 'pending' check(status in ('pending','approved','rejected')),created_at timestamptz default now());
alter table public.universities enable row level security;
alter table public.custom_curricula enable row level security;
revoke all on public.universities,public.custom_curricula from public,anon,authenticated;
grant select on public.universities,public.custom_curricula to authenticated;
create policy university_lookup on public.universities for select to authenticated using(status='approved' or id=(select institution_id from public.profiles where id=auth.uid()) or app_private.can_moderate(id,'academic'));
create policy curriculum_read on public.custom_curricula for select to authenticated using(owner_id=auth.uid() or (status='approved' and institution_id=(select institution_id from public.profiles where id=auth.uid())) or app_private.can_moderate(institution_id,'academic'));
create or replace function public.search_universities(p_query text) returns table(id text,name text) language sql stable security definer set search_path='' as $$select u.id,u.name from public.universities u where u.status='approved' and length(trim(p_query)) between 2 and 120 and position(public.university_name_key(p_query) in u.name_key)>0 order by u.name limit 12$$;
revoke all on function public.search_universities(text) from public;
grant execute on function public.search_universities(text) to anon,authenticated;
create or replace function public.curriculum_md_cell(v text) returns text language sql immutable set search_path='' as $$select regexp_replace(replace(trim(coalesce(v,'')),'|','/'),'[\r\n]+',' ','g')$$;
create or replace function public.curriculum_to_markdown(uni text,career text,items jsonb,source text) returns text language sql immutable set search_path=public,pg_temp as $$select '# '||curriculum_md_cell(career)||E'\n\nUniversidad: '||curriculum_md_cell(uni)||E'\nFuente: '||curriculum_md_cell(source)||E'\n\n| Código | Curso | Créditos | Ciclo | Tipo | Requisitos |\n| --- | --- | --- | --- | --- | --- |\n'||coalesce((select string_agg('| '||concat_ws(' | ',curriculum_md_cell(v->>'code'),curriculum_md_cell(v->>'name'),curriculum_md_cell(v->>'credits'),curriculum_md_cell(v->>'cycle'),curriculum_md_cell(v->>'type'),curriculum_md_cell(v->>'requirements'))||' |',E'\n' order by n) from jsonb_array_elements(items) with ordinality a(v,n)),'')$$;
create function public.validate_curriculum_rows(items jsonb) returns void language plpgsql set search_path='' as $$declare item jsonb;begin
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 400 then raise exception 'INVALID_CURRICULUM';end if;
 for item in select value from jsonb_array_elements(items) loop
 if jsonb_typeof(item)<>'object' or coalesce(length(trim(item->>'code')),0) not between 1 and 40 or coalesce(length(trim(item->>'name')),0) not between 2 and 180 or coalesce(item->>'credits','') !~ '^[0-9]+(\.[0-9]+)?$' or (item->>'credits')::numeric not between 0 and 40 or coalesce(item->>'cycle','') !~ '^[0-9]{1,2}$' or (item->>'cycle')::int not between 0 and 20 or coalesce(item->>'type','') not in ('curso','taller','electivo') or length(coalesce(item->>'requirements',''))>800 then raise exception 'INVALID_CURRICULUM_ROW';end if;
 end loop;
 if (select count(distinct lower(trim(value->>'code'))) from jsonb_array_elements(items))<>jsonb_array_length(items) then raise exception 'DUPLICATE_COURSE';end if;
end$$;
revoke all on function public.curriculum_md_cell(text),public.curriculum_to_markdown(text,text,jsonb,text),public.validate_curriculum_rows(jsonb) from public,anon,authenticated;
create or replace function public.protect_curriculum_assignment() returns trigger language plpgsql set search_path=public,pg_temp as $$begin
 if auth.uid() is null then return new;end if;
 if current_user not in ('authenticated','anon','authenticator') then return new;end if;
 if new.institution_id is distinct from old.institution_id or new.university_name is distinct from old.university_name or new.student_code is distinct from old.student_code or new.email is distinct from old.email then raise exception 'INSTITUTION_ASSIGNMENT_LOCKED';end if;
 if old.carrera is null and old.institution_id='esan' and new.carrera is not null then
 select version into new.curriculum_version from public.curriculum_versions where institution_id='esan' and career_key=new.carrera order by published_at desc nulls last limit 1;
 if new.curriculum_version is null then raise exception 'INVALID_CAREER';end if;
 elsif new.carrera is distinct from old.carrera or new.curriculum_version is distinct from old.curriculum_version or new.custom_curriculum_id is distinct from old.custom_curriculum_id or new.external_career is distinct from old.external_career then raise exception 'CURRICULUM_ASSIGNMENT_LOCKED';end if;
 return new;end$$;
create or replace function public.lock_carrera() returns trigger language plpgsql set search_path='' as $$begin if current_user in ('authenticated','anon','authenticator') and old.carrera is not null and new.carrera is distinct from old.carrera then raise exception 'CURRICULUM_ASSIGNMENT_LOCKED';end if;return new;end$$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$declare uni text:=trim(coalesce(new.raw_user_meta_data->>'university_name','Universidad ESAN'));inst text;code text:=trim(coalesce(new.raw_user_meta_data->>'student_code',''));career text:=new.raw_user_meta_data->>'carrera';ver text;begin
 if new.raw_user_meta_data->>'institution_id'='esan' or university_name_key(uni) in ('esan','universidadesan','ue') or translate(lower(uni),'áéíóú','aeiou') ~ '(^|[^a-z])esan([^a-z]|$)' or lower(new.email) like '%@ue.edu.pe' then
 inst:='esan';uni:='Universidad ESAN';
 if code !~ '^[0-9]{8}$' then raise exception 'INVALID_ESAN_CODE';end if;
 if left(code,2)::int<20 or left(code,2)::int>extract(year from now() at time zone 'America/Lima')::int%100 then raise exception 'INVALID_ESAN_CODE';end if;
 if lower(new.email) !~ '^[a-z0-9._%+-]+@ue\.edu\.pe$' then raise exception 'ESAN_EMAIL_REQUIRED';end if;
 select version into ver from curriculum_versions where institution_id='esan' and career_key=career order by published_at desc nulls last limit 1;if ver is null then raise exception 'INVALID_CAREER';end if;
 else
 if length(uni) not between 2 and 120 or university_name_key(uni)='' or length(trim(coalesce(new.raw_user_meta_data->>'external_career',''))) not between 2 and 120 then raise exception 'UNIVERSITY_REQUIRED';end if;
 insert into universities(name) values(uni) on conflict(name_key) do nothing;
 select id into inst from universities where name_key=university_name_key(uni) and status<>'rejected';if inst is null then raise exception 'UNIVERSITY_UNAVAILABLE';end if;code:=null;career:=null;
 -- Explicit provisional platform scale until an administrator sets the institution's rule.
 insert into institution_rules(institution_id,grade_scale) values(inst,'{"kind":"numeric","min":0,"max":20,"passing":10.5,"decimals":2,"weighting":"credits"}') on conflict do nothing;
 end if;
 insert into profiles(id,student_code,email,carrera,institution_id,curriculum_version,university_name,external_career) values(new.id,code,new.email,career,inst,ver,uni,case when inst<>'esan' then trim(new.raw_user_meta_data->>'external_career') end);return new;end$$;
create function public.submit_curriculum(p_request uuid,p_career text,p_rows jsonb,p_markdown text,p_source text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$declare uid uuid:=auth.uid();p public.profiles;begin
 if uid is null then raise exception 'NO_AUTH';end if;
 select * into p from profiles where id=uid for update;if p.institution_id is null or p.institution_id='esan' then raise exception 'EXTERNAL_PROFILE_REQUIRED';end if;
 if exists(select 1 from custom_curricula where id=p_request and owner_id=uid) then return p_request;end if;
 if p.custom_curriculum_id is not null then raise exception 'CURRICULUM_ALREADY_ASSIGNED';end if;
 if p_career is null or length(trim(p_career)) not between 2 and 120 or p_source is null or length(p_source)>255 then raise exception 'INVALID_CURRICULUM';end if;
 perform validate_curriculum_rows(p_rows);
 insert into custom_curricula(id,owner_id,institution_id,career_name,rows,markdown,source_name) values(p_request,uid,p.institution_id,trim(p_career),p_rows,curriculum_to_markdown(p.university_name,p_career,p_rows,p_source),p_source);
 update profiles set custom_curriculum_id=p_request,carrera=p_request::text,curriculum_version=p_request::text,external_career=trim(p_career) where id=uid;return p_request;end$$;
create function public.adopt_curriculum(p_curriculum uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$declare uid uuid:=auth.uid();p public.profiles;c public.custom_curricula;begin
 if uid is null then raise exception 'NO_AUTH';end if;select * into p from profiles where id=uid for update;
 select * into c from custom_curricula where id=p_curriculum and institution_id=p.institution_id and status='approved';
 if c.id is null or p.custom_curriculum_id is not null or p.institution_id='esan' then raise exception 'CURRICULUM_UNAVAILABLE';end if;
 update profiles set custom_curriculum_id=c.id,carrera=c.id::text,curriculum_version=c.id::text,external_career=c.career_name where id=uid;end$$;
revoke all on function public.submit_curriculum(uuid,text,jsonb,text,text),public.adopt_curriculum(uuid) from public,anon;
grant execute on function public.submit_curriculum(uuid,text,jsonb,text,text),public.adopt_curriculum(uuid) to authenticated;
-- Approved submissions enter the existing immutable version registry; drafts never do.
create function public.promote_custom_curriculum() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare courses jsonb:='[]';cycles jsonb:='{}';item jsonb;idx int:=0;req text;refs jsonb;known boolean;catalog jsonb;hash text:=md5(new.rows::text);begin
 if new.status<>'approved' or old.status='approved' then return new;end if;
 for item in select value from jsonb_array_elements(new.rows) loop
 idx:=idx+1;req:=trim(coalesce(item->>'requirements',''));
 select coalesce(jsonb_agg('u-'||new.id::text||'-'||n),'[]') into refs from jsonb_array_elements(new.rows) with ordinality a(v,n) where lower(trim(v->>'code')) in(select lower(trim(x)) from regexp_split_to_table(req,'[,;]') x);
 known:=lower(req) in ('ninguno','sin requisitos','no aplica') or (req<>'' and jsonb_array_length(refs)=(select count(*) from regexp_split_to_table(req,'[,;]') x));
 courses:=courses||jsonb_build_array(jsonb_build_object('id','u-'||new.id::text||'-'||idx,'n',item->>'name','code',item->>'code','cr',(item->>'credits')::numeric,'c',(item->>'cycle')::int,'r',case when known then refs else '[]' end,'prerequisitesKnown',known)||case when known then '{}'::jsonb else jsonb_build_object('requirementNote',coalesce(nullif(req,''),'Por verificar')) end);
 cycles:=cycles||jsonb_build_object(item->>'cycle',jsonb_build_object('t','Ciclo '||(item->>'cycle'),'s','Malla aportada'));
 end loop;
 catalog:=jsonb_build_object('key',new.id::text,'version',new.id::text,'institutionId',new.institution_id,'nombre',new.career_name,'uni',(select name from universities where id=new.institution_id),'source',new.source_name,'sourceHash',hash,'total',(select sum((v->>'credits')::numeric) from jsonb_array_elements(new.rows) a(v)),'cursos',courses,'ciclos',cycles,'foot','Malla aportada y revisada por coherencia. Confirma vigencia con tu universidad.');
 insert into curriculum_versions(institution_id,career_key,version,source_hash,source_document,catalog,published_at) values(new.institution_id,new.id::text,new.id::text,hash,new.source_name,catalog,now()) on conflict do nothing;return new;end$$;
create trigger promote_custom_curriculum after update of status on public.custom_curricula for each row execute function public.promote_custom_curriculum();
do $$declare p record;begin for p in select policyname from pg_policies where schemaname='public' and tablename='curriculum_versions' and cmd='SELECT' loop execute format('drop policy %I on public.curriculum_versions',p.policyname);end loop;end$$;
create policy curriculum_versions_read on public.curriculum_versions for select to authenticated using(institution_id='esan' or institution_id=(select institution_id from public.profiles where id=auth.uid()) or app_private.can_moderate(institution_id,'academic'));
create or replace function public.review_curriculum(p_curriculum uuid,p_approve boolean) returns void language plpgsql as $$begin raise exception 'USE_AUDITED_REVIEW';end$$;
revoke all on function public.review_curriculum(uuid,boolean) from public,anon,authenticated;
commit;
notify pgrst,'reload schema';
