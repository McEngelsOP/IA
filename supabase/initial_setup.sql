-- Web onboarding: drafts are private; completion applies all changes atomically.
-- Apply once before deploying pagina.html. Existing accounts are exempted below.
create table public.student_setup (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  draft jsonb not null default '{}'::jsonb check (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 120000),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 4000),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.student_setup enable row level security;
revoke all on public.student_setup from anon, public;
grant select, insert, update on public.student_setup to authenticated;
create policy setup_read on public.student_setup for select to authenticated using ((select auth.uid()) = student_id);
create policy setup_insert on public.student_setup for insert to authenticated with check ((select auth.uid()) = student_id);
create policy setup_update on public.student_setup for update to authenticated using ((select auth.uid()) = student_id) with check ((select auth.uid()) = student_id);

-- No changes to existing academic records. New profiles have no setup row yet.
insert into public.student_setup(student_id, completed_at) select id, now() from public.profiles;

create function public.setup_valid_preferences(value jsonb) returns boolean
language sql immutable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_typeof(value) = 'object'
    and (value->>'semester')::integer between 1 and 10
    and (value->>'credits')::numeric between 1 and 30
    and mod((value->>'credits')::numeric * 2, 1) = 0
    and char_length(value->>'mention') <= 120
    and value->>'theme' in ('dark','light')
    and value->>'companion' in ('cat','rabbit','owl')
    and value->>'method' in ('p25','p45','p90')
    and value->>'clockStyle' in ('ring','arc','dots','digital'), false)
$$;

create function public.save_student_setup_draft(value jsonb) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NO_AUTH'; end if;
  if jsonb_typeof(value) <> 'object' or octet_length(value::text) > 120000
    or not exists(select 1 from public.profiles where id=uid and carrera=value->>'career') then raise exception 'INVALID_SETUP'; end if;
  insert into public.student_setup(student_id,draft) values(uid,value)
  on conflict(student_id) do update set draft=excluded.draft,updated_at=now()
  where student_setup.completed_at is null;
  if not found then raise exception 'ALREADY_COMPLETED'; end if;
end $$;

create function public.save_student_setup_preferences(value jsonb) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NO_AUTH'; end if;
  if not public.setup_valid_preferences(value) then raise exception 'INVALID_SETUP'; end if;
  update public.student_setup set preferences=value,updated_at=now() where student_id=uid and completed_at is not null;
  if not found then raise exception 'SETUP_NOT_COMPLETED'; end if;
end $$;

create function public.complete_student_setup(value jsonb) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); finished timestamptz; saved_token text; approved text[]; enrolled text[]; prior text[]; event jsonb; cid text; prefs jsonb;
begin
  if uid is null then raise exception 'NO_AUTH'; end if;
  if not public.setup_valid_preferences(value) or coalesce(char_length(value->>'token'),0) <> 36
    or not exists(select 1 from public.profiles where id=uid and carrera=value->>'career')
    or jsonb_typeof(value->'done') is distinct from 'array'
    or jsonb_typeof(value->'enrolled') is distinct from 'array'
    or jsonb_typeof(value->'events') is distinct from 'array'
    or jsonb_array_length(value->'done') > 400 or jsonb_array_length(value->'enrolled') > 100
    or jsonb_array_length(value->'events') > 200 then raise exception 'INVALID_SETUP'; end if;
  if exists(select 1 from jsonb_array_elements((value->'done') || (value->'enrolled')) as a(v)
    where jsonb_typeof(v) <> 'string' or char_length(v#>>'{}') not between 1 and 180) then raise exception 'INVALID_SETUP'; end if;
  select array_agg(distinct v) into approved from jsonb_array_elements_text(value->'done') a(v);
  select array_agg(distinct v) into enrolled from jsonb_array_elements_text(value->'enrolled') a(v);
  approved := coalesce(approved,'{}'); enrolled := coalesce(enrolled,'{}');
  if approved && enrolled then raise exception 'INVALID_SETUP'; end if;
  insert into public.student_setup(student_id) values(uid) on conflict do nothing;
  select completed_at, preferences->>'token' into finished,saved_token from public.student_setup where student_id=uid for update;
  if finished is not null then
    if saved_token = value->>'token' then return; end if;
    raise exception 'ALREADY_COMPLETED';
  end if;
  -- Preserve any records created after deferring setup; no grades or achievements are fabricated.
  select done into prior from public.progress where student_id=uid for update;
  select coalesce(array_agg(distinct v),'{}') into approved from unnest(approved || coalesce(prior,'{}')) a(v);
  enrolled := array(select v from unnest(enrolled) a(v) where not (v = any(approved)));
  insert into public.progress(student_id,done,plan,updated_at) values(uid,approved,enrolled,now())
  on conflict(student_id) do update set done=excluded.done,plan=excluded.plan,updated_at=now();
  foreach cid in array approved loop
    insert into public.course_status(student_id,course_id,status) values(uid,cid,'aprobado') on conflict(student_id,course_id) do nothing;
  end loop;
  foreach cid in array enrolled loop
    insert into public.course_status(student_id,course_id,status) values(uid,cid,'matriculado')
    on conflict(student_id,course_id) do update set status='matriculado',updated_at=now()
    where course_status.status not in ('aprobado','convalidado');
  end loop;
  for event in select v from jsonb_array_elements(value->'events') a(v) loop
    if event->>'id' is distinct from 'setup-' || (value->>'token') || '-' || ((event->>'index')::integer)::text then
      raise exception 'INVALID_SETUP_EVENT';
    end if;
    if event->>'course_id' is not null and not (event->>'course_id' = any(enrolled)) then raise exception 'COURSE_NOT_ENROLLED'; end if;
    insert into public.calendar_events(id,student_id,title,location,course_id,date,start_time,end_time,event_type,color,repeat_rule,repeat_until)
    values(event->>'id',uid,event->>'title',coalesce(event->>'location',''),event->>'course_id',event->>'date',
      (event->>'start_time')::time,(event->>'end_time')::time,'clase','azul','weekly',(event->>'repeat_until')::date);
  end loop;
  prefs := jsonb_build_object('semester',(value->>'semester')::integer,'mention',value->>'mention','credits',(value->>'credits')::numeric,
    'theme',value->>'theme','companion',value->>'companion','method',value->>'method','clockStyle',value->>'clockStyle','token',value->>'token');
  update public.student_setup set preferences=prefs,draft='{}',completed_at=now(),updated_at=now() where student_id=uid;
end $$;

revoke all on function public.setup_valid_preferences(jsonb),public.save_student_setup_draft(jsonb),public.save_student_setup_preferences(jsonb),public.complete_student_setup(jsonb) from public,anon;
grant execute on function public.setup_valid_preferences(jsonb),public.save_student_setup_draft(jsonb),public.save_student_setup_preferences(jsonb),public.complete_student_setup(jsonb) to authenticated;
