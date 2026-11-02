-- Requires migrations 001–003. No provider credentials belong in these tables.
begin;
alter table public.custom_curricula add column if not exists source_url text not null default '' check(source_url='' or (source_url ~ '^https://[^[:space:]]+$' and char_length(source_url)<=1000));
alter table public.custom_curricula add column if not exists validation_state text not null default 'review' check(validation_state in ('draft','queued','analyzing','approved','corrections','review','rejected'));
alter table public.custom_curricula add column if not exists analysis_summary jsonb not null default '{}';
alter table public.custom_curricula add column if not exists updated_at timestamptz not null default clock_timestamp();
update public.custom_curricula set validation_state=status where status in ('approved','rejected');

create function public.is_curriculum_moderator() returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and (public.is_app_admin() or exists(select 1 from app_private.moderator_scopes where user_id=auth.uid() and scope='academic'))$$;
revoke all on function public.is_curriculum_moderator() from public,anon;
grant execute on function public.is_curriculum_moderator() to authenticated;
create policy curriculum_moderator_read on public.custom_curricula for select to authenticated using(app_private.can_moderate(institution_id,'academic'));
create policy university_moderator_read on public.universities for select to authenticated using(app_private.can_moderate(id,'academic'));
-- The extracted original may contain contact details. Sharing a catalog never shares this text.
create table public.curriculum_sources (
 curriculum_id uuid primary key references public.custom_curricula(id) on delete cascade,
 source_text text not null check(char_length(source_text)<=180000)
);
alter table public.curriculum_sources enable row level security;
revoke all on public.curriculum_sources from public,anon,authenticated;
grant select on public.curriculum_sources to authenticated;
create policy curriculum_source_read on public.curriculum_sources for select to authenticated using(exists(select 1 from public.custom_curricula c where c.id=curriculum_id and (c.owner_id=auth.uid() or app_private.can_moderate(c.institution_id,'academic'))));

create table public.curriculum_analysis_jobs (
 id uuid primary key default gen_random_uuid(), curriculum_id uuid not null references public.custom_curricula(id) on delete cascade,
 requested_by uuid not null references public.profiles(id) on delete cascade,
 input_hash text not null, status text not null default 'queued' check(status in ('queued','running','completed')),
 lease_token uuid, lease_until timestamptz, attempts int not null default 0,
 result jsonb, created_at timestamptz not null default now(), finished_at timestamptz
);
create unique index curriculum_one_active_job on public.curriculum_analysis_jobs(curriculum_id) where status in ('queued','running');
create index curriculum_job_queue on public.curriculum_analysis_jobs(created_at) where status<>'completed';
create index curriculum_job_usage on public.curriculum_analysis_jobs(requested_by,created_at);
create index curriculum_review_queue on public.custom_curricula(updated_at,id) where validation_state='review';
alter table public.curriculum_analysis_jobs enable row level security;
revoke all on public.curriculum_analysis_jobs from public,anon,authenticated;
grant select on public.curriculum_analysis_jobs to authenticated;
create policy curriculum_job_read on public.curriculum_analysis_jobs for select to authenticated using(requested_by=auth.uid() or exists(select 1 from public.custom_curricula c where c.id=curriculum_id and app_private.can_moderate(c.institution_id,'academic')));
create table public.curriculum_review_log (
 id uuid primary key default gen_random_uuid(), curriculum_id uuid not null references public.custom_curricula(id) on delete cascade,
 actor_id uuid references public.profiles(id), actor_kind text not null check(actor_kind in ('ai','moderator','student')),
 decision text not null, note text not null, evidence jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.curriculum_review_log enable row level security;
revoke all on public.curriculum_review_log from public,anon,authenticated;
grant select on public.curriculum_review_log to authenticated;
create policy curriculum_review_read on public.curriculum_review_log for select to authenticated using(exists(select 1 from public.custom_curricula c where c.id=curriculum_id and (c.owner_id=auth.uid() or app_private.can_moderate(c.institution_id,'academic'))));

create function public.curriculum_input_hash(c public.custom_curricula) returns text language sql stable set search_path='' as $$
 select md5(c.rows::text||c.career_name||coalesce((select source_text from public.curriculum_sources where curriculum_id=c.id),'')||c.source_url)
$$;
revoke all on function public.curriculum_input_hash(public.custom_curricula) from public,anon,authenticated;

create function public.request_curriculum_analysis(p_curriculum uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.custom_curricula; j public.curriculum_analysis_jobs; uid uuid:=auth.uid(); jid uuid;
begin
 if uid is null then raise exception 'NO_AUTH'; end if;
 -- Serialize an owner's submissions and the daily platform budget.
 perform pg_advisory_xact_lock(310004);
 select * into c from public.custom_curricula where id=p_curriculum and owner_id=uid for update;
 if c.id is null then raise exception 'CURRICULUM_UNAVAILABLE'; end if;
 select * into j from public.curriculum_analysis_jobs where curriculum_id=c.id order by created_at desc,id desc limit 1;
 if j.status in ('queued','running') then return j.id; end if;
 if c.status='approved' then raise exception 'CURRICULUM_ALREADY_APPROVED'; end if;
 if j.input_hash=public.curriculum_input_hash(c) and c.validation_state in ('corrections','rejected') then raise exception 'CORRECTIONS_REQUIRED'; end if;
 if j.created_at>now()-interval '5 minutes' then raise exception 'ANALYSIS_COOLDOWN'; end if;
 if (select count(*) from public.curriculum_analysis_jobs where requested_by=uid and created_at>now()-interval '24 hours')>=3 then raise exception 'ANALYSIS_DAILY_LIMIT'; end if;
 if (select count(*) from public.curriculum_analysis_jobs where created_at>now()-interval '24 hours')>=100 then raise exception 'ANALYSIS_PLATFORM_LIMIT'; end if;
 insert into public.curriculum_analysis_jobs(curriculum_id,requested_by,input_hash) values(c.id,uid,public.curriculum_input_hash(c)) returning id into jid;
 update public.custom_curricula set validation_state='queued',analysis_summary='{}',updated_at=clock_timestamp() where id=c.id;
 return jid;
end $$;
revoke all on function public.request_curriculum_analysis(uuid) from public,anon;
grant execute on function public.request_curriculum_analysis(uuid) to authenticated;

-- Keep the old API compatible: submissions made by old clients enter exceptional review.
create function public.submit_curriculum_v2(p_request uuid,p_career text,p_rows jsonb,p_markdown text,p_source text,p_source_text text,p_source_url text default '') returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid;
begin
 if p_source_text is null or char_length(p_source_text)>180000 then raise exception 'INVALID_SOURCE'; end if;
 if exists(select 1 from public.custom_curricula where id=p_request and owner_id=auth.uid()) then return p_request; end if;
 perform pg_advisory_xact_lock(310004);
 cid:=public.submit_curriculum(p_request,p_career,p_rows,p_markdown,p_source);
 insert into public.curriculum_sources values(cid,p_source_text);
 update public.custom_curricula set source_url=coalesce(trim(p_source_url),''),validation_state='draft' where id=cid;
 perform public.request_curriculum_analysis(cid);
 return cid;
end $$;
revoke all on function public.submit_curriculum_v2(uuid,text,jsonb,text,text,text,text) from public,anon;
grant execute on function public.submit_curriculum_v2(uuid,text,jsonb,text,text,text,text) to authenticated;

create function public.revise_curriculum(p_curriculum uuid,p_career text,p_rows jsonb,p_source text,p_source_text text,p_source_url text default '') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.custom_curricula; item jsonb; uni text;
begin
 if auth.uid() is null then raise exception 'NO_AUTH'; end if;
 perform pg_advisory_xact_lock(310004);
 select university_name into uni from public.profiles where id=auth.uid() for update;
 select * into c from public.custom_curricula where id=p_curriculum and owner_id=auth.uid() for update;
 if c.id is null then raise exception 'CURRICULUM_UNAVAILABLE'; end if;
 if c.status='approved' then raise exception 'CURRICULUM_ALREADY_APPROVED'; end if;
 if exists(select 1 from public.curriculum_analysis_jobs where curriculum_id=c.id and status<>'completed') then raise exception 'ANALYSIS_BUSY'; end if;
 if p_career is null or char_length(trim(p_career)) not between 2 and 120 or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 400 or p_source is null or char_length(p_source)>255 or p_source_text is null or char_length(p_source_text)>180000 then raise exception 'INVALID_CURRICULUM'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item)<>'object' or coalesce(char_length(trim(item->>'code')),0) not between 1 and 40 or coalesce(char_length(trim(item->>'name')),0) not between 2 and 180 or coalesce(item->>'credits','') !~ '^[0-9]+(\.[0-9]+)?$' or (item->>'credits')::numeric not between 0 and 40 or coalesce(item->>'cycle','') !~ '^[0-9]{1,2}$' or (item->>'cycle')::int not between 0 and 20 or coalesce(item->>'type','') not in ('curso','taller','electivo') or char_length(coalesce(item->>'requirements',''))>800 then raise exception 'INVALID_CURRICULUM_ROW'; end if;
 end loop;
 if (select count(distinct lower(trim(value->>'code'))) from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then raise exception 'DUPLICATE_COURSE'; end if;
 -- Row positions are academic IDs. Never silently remap an existing student's progress.
 if (exists(select 1 from public.student_setup where student_id=auth.uid() and completed_at is not null) or exists(select 1 from public.course_status where student_id=auth.uid()) or exists(select 1 from public.grades where student_id=auth.uid()) or exists(select 1 from public.progress where student_id=auth.uid() and (cardinality(done)>0 or cardinality(plan)>0))) and
 (select jsonb_agg(v->>'code' order by n) from jsonb_array_elements(c.rows) with ordinality a(v,n)) is distinct from
 (select jsonb_agg(v->>'code' order by n) from jsonb_array_elements(p_rows) with ordinality a(v,n)) then raise exception 'COURSE_IDS_LOCKED'; end if;
 update public.custom_curricula set career_name=trim(p_career),rows=p_rows,markdown=public.curriculum_to_markdown(uni,p_career,p_rows,p_source),source_name=p_source,source_url=coalesce(trim(p_source_url),''),status='pending',validation_state='draft',updated_at=clock_timestamp() where id=c.id;
 insert into public.curriculum_review_log(curriculum_id,actor_id,actor_kind,decision,note,evidence) values(c.id,auth.uid(),'student','revised','Nueva versión enviada.',jsonb_build_object('previous_rows',c.rows,'previous_source',(select source_text from public.curriculum_sources where curriculum_id=c.id),'previous_analysis',c.analysis_summary));
 insert into public.curriculum_sources values(c.id,p_source_text) on conflict(curriculum_id) do update set source_text=excluded.source_text;
 perform public.request_curriculum_analysis(c.id);
end $$;
revoke all on function public.revise_curriculum(uuid,text,jsonb,text,text,text) from public,anon;
grant execute on function public.revise_curriculum(uuid,text,jsonb,text,text,text) to authenticated;

-- Server-only leases: clients cannot claim work or invent AI decisions.
create function public.claim_curriculum_analysis(p_curriculum uuid default null,p_owner uuid default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.curriculum_analysis_jobs; c public.custom_curricula; token uuid:=gen_random_uuid();
begin
 select * into j from public.curriculum_analysis_jobs where (status='queued' or (status='running' and lease_until<now())) and (p_curriculum is null or curriculum_id=p_curriculum) and (p_owner is null or requested_by=p_owner) order by created_at for update skip locked limit 1;
 if j.id is null then return null; end if;
 select * into c from public.custom_curricula where id=j.curriculum_id;
 update public.curriculum_analysis_jobs set status='running',lease_token=token,lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=j.id;
 update public.custom_curricula set validation_state='analyzing',updated_at=clock_timestamp() where id=c.id;
 return jsonb_build_object('job_id',j.id,'lease_token',token,'attempts',j.attempts+1,'curriculum_id',c.id,'career',c.career_name,'rows',c.rows,'source_text',(select source_text from public.curriculum_sources where curriculum_id=c.id),'source_url',c.source_url,'university',(select name from public.universities where id=c.institution_id));
end $$;
create function public.finish_curriculum_analysis(p_job uuid,p_token uuid,p_result jsonb) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.curriculum_analysis_jobs; c public.custom_curricula; decision text:=p_result->>'decision';
begin
 if decision is null or decision not in ('approved','corrections','review','rejected') or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>64000 then raise exception 'INVALID_ANALYSIS_RESULT'; end if;
 select * into j from public.curriculum_analysis_jobs where id=p_job and status='running' and lease_token=p_token and lease_until>now() for update;
 if j.id is null then return false; end if;
 select * into c from public.custom_curricula where id=j.curriculum_id for update;
 if j.input_hash<>public.curriculum_input_hash(c) then raise exception 'STALE_ANALYSIS'; end if;
 update public.curriculum_analysis_jobs set status='completed',result=p_result,finished_at=now(),lease_token=null,lease_until=null where id=j.id;
 update public.custom_curricula set validation_state=decision,status=case when decision in ('approved','rejected') then decision else 'pending' end,analysis_summary=p_result,updated_at=clock_timestamp() where id=c.id;
 if decision='approved' then update public.universities set status='approved' where id=c.institution_id and status<>'rejected'; end if;
 insert into public.curriculum_review_log(curriculum_id,actor_kind,decision,note,evidence) values(c.id,'ai',decision,coalesce(p_result->>'summary','Análisis automático.'),p_result);
 return true;
end $$;
revoke all on function public.claim_curriculum_analysis(uuid,uuid),public.finish_curriculum_analysis(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_curriculum_analysis(uuid,uuid),public.finish_curriculum_analysis(uuid,uuid,jsonb) to service_role;

-- Dedicated provider budget: installs all required RPCs even on projects that have no advisor limiter.
create table public.curriculum_provider_limits (
 provider text primary key check(provider in ('gemini','groq','openrouter')), model text not null,
 minute_start timestamptz not null default now(), minute_count int not null default 0,day_start timestamptz not null default now(),day_count int not null default 0,retry_until timestamptz not null default 'epoch',last_status text,duration_ms int);
alter table public.curriculum_provider_limits enable row level security;
revoke all on public.curriculum_provider_limits from public,anon,authenticated;
create function public.curriculum_provider_reserve(p_provider text,p_model text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$declare r public.curriculum_provider_limits;ts timestamptz:=clock_timestamp();g jsonb;begin
 if p_provider not in ('gemini','groq','openrouter') or p_model is null or length(p_model)>100 then raise exception 'INVALID_PROVIDER';end if;
 insert into curriculum_provider_limits(provider,model) values(p_provider,p_model) on conflict do nothing;
 select * into r from curriculum_provider_limits where provider=p_provider for update;
 if r.minute_start<ts-interval '1 minute' then r.minute_start:=ts;r.minute_count:=0;end if;
 if r.day_start<ts-interval '24 hours' then r.day_start:=ts;r.day_count:=0;end if;
 if r.retry_until>ts or r.minute_count>=10 or r.day_count>=300 then return jsonb_build_object('allowed',false,'retryAfterSeconds',60);end if;
 -- All shared calls also respect the existing project-wide provider limiter.
 if to_regprocedure('public.advisor_provider_reserve(text,text)') is not null then execute 'select public.advisor_provider_reserve($1,$2)' into g using p_provider,p_model;if not coalesce((g->>'allowed')::boolean,false) then return g;end if;end if;
 update curriculum_provider_limits set model=p_model,minute_start=r.minute_start,minute_count=r.minute_count+1,day_start=r.day_start,day_count=r.day_count+1 where provider=p_provider;
 return jsonb_build_object('allowed',true);end$$;
create function public.curriculum_provider_report(p_provider text,p_model text,p_status text,p_retry_after_seconds int,p_duration_ms int) returns void language plpgsql security definer set search_path=public,pg_temp as $$begin
 update curriculum_provider_limits set model=left(p_model,100),last_status=left(p_status,40),duration_ms=greatest(0,least(60000,p_duration_ms)),retry_until=case when p_retry_after_seconds>0 then clock_timestamp()+make_interval(secs=>least(86400,p_retry_after_seconds)) else 'epoch'::timestamptz end where provider=p_provider;
 if to_regprocedure('public.advisor_provider_report(text,text,text,integer,integer)') is not null then execute 'select public.advisor_provider_report($1,$2,$3,$4,$5)' using p_provider,p_model,p_status,p_retry_after_seconds,p_duration_ms;end if;
end$$;
revoke all on function public.curriculum_provider_reserve(text,text),public.curriculum_provider_report(text,text,text,int,int) from public,anon,authenticated;
grant execute on function public.curriculum_provider_reserve(text,text),public.curriculum_provider_report(text,text,text,int,int) to service_role;

create function public.moderate_curriculum(p_curriculum uuid,p_expected_updated_at timestamptz,p_decision text,p_note text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.custom_curricula; state text;
begin
 if not public.is_curriculum_moderator() then raise exception 'MODERATOR_REQUIRED'; end if;
 if p_decision is null or p_decision not in ('approved','corrections','rejected') or p_note is null or char_length(trim(p_note)) not between 10 and 2000 then raise exception 'INVALID_REVIEW'; end if;
 select * into c from public.custom_curricula where id=p_curriculum for update;
 if c.id is not null and not app_private.can_moderate(c.institution_id,'academic') then raise exception 'MODERATOR_REQUIRED';end if;
 if c.id is null or c.validation_state<>'review' or c.updated_at is distinct from p_expected_updated_at then raise exception 'REVIEW_CONFLICT'; end if;
 state:=case when p_decision in ('approved','rejected') then p_decision else 'pending' end;
 update public.custom_curricula set status=state,validation_state=p_decision,analysis_summary=jsonb_build_object('decision',p_decision,'summary',trim(p_note),'moderated',true,'issues',case when p_decision='approved' then '[]'::jsonb else coalesce(c.analysis_summary->'issues','[]') end),updated_at=clock_timestamp() where id=c.id;
 if p_decision='approved' then update public.universities set status='approved' where id=c.institution_id and status<>'rejected'; end if;
 insert into public.curriculum_review_log(curriculum_id,actor_id,actor_kind,decision,note,evidence) values(c.id,auth.uid(),'moderator',p_decision,trim(p_note),c.analysis_summary);
end $$;
revoke all on function public.moderate_curriculum(uuid,timestamptz,text,text) from public,anon;
grant execute on function public.moderate_curriculum(uuid,timestamptz,text,text) to authenticated;
-- Close the legacy owner-only approval shortcut; use the audited moderation path instead.
drop function public.review_curriculum(uuid,boolean);
commit;
notify pgrst,'reload schema';
