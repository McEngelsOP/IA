-- Academic facts are explicit. Enrollment and future planning are disjoint.
create or replace function public.save_academic_plan(p_plan text[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb; approved text[]; planned text[];
begin
 if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
 if p_plan is null or cardinality(p_plan)>400 or exists(select 1 from unnest(p_plan) c where c is null or length(c) not between 1 and 180) then raise exception 'invalid_courses'; end if;
 perform 1 from public.profiles where id=uid for update;
 select done into approved from public.progress where student_id=uid for update;
 approved:=coalesce(approved,'{}');
 planned:=array(select distinct c from unnest(p_plan) c where not(c=any(approved)) and not exists(select 1 from public.course_status s where s.student_id=uid and s.course_id=c and s.status='matriculado'));
 insert into public.progress(student_id,done,plan) values(uid,approved,planned) on conflict(student_id) do update set plan=excluded.plan,updated_at=now();
 return jsonb_build_object('done',approved,'plan',planned);
end $$;

create or replace function public.save_academic_progress(p_done text[],p_plan text[],p_expected_done text[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); prior text[]; approved text[]; result jsonb;
begin
 if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
 if p_done is null or p_plan is null or p_expected_done is null or cardinality(p_done)>400 or cardinality(p_plan)>400 or exists(select 1 from unnest(p_done||p_plan) c where c is null or length(c) not between 1 and 180) then raise exception 'invalid_courses'; end if;
 perform 1 from public.profiles where id=uid for update;
 select done into prior from public.progress where student_id=uid for update;
 prior:=coalesce(prior,'{}');
 if not(prior @> p_expected_done and prior <@ p_expected_done) then raise exception 'academic_state_changed'; end if;
 approved:=array(select distinct unnest(p_done));
 delete from public.course_status where student_id=uid and status in ('aprobado','convalidado') and not(course_id=any(approved));
 insert into public.course_status(student_id,course_id,status) select uid,c,'aprobado' from unnest(approved) c
 on conflict(student_id,course_id) do update set status=case when course_status.status='convalidado' then 'convalidado' else 'aprobado' end,updated_at=now();
 insert into public.progress(student_id,done,plan) values(uid,approved,'{}') on conflict(student_id) do update set done=excluded.done,updated_at=now();
 result:=public.save_academic_plan(p_plan);
 return result||jsonb_build_object('statuses',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.course_status s where student_id=uid));
end $$;

create or replace function public.save_current_semester(p_courses text[],p_semester integer default null,p_plan text[] default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
 if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
 if p_courses is null or cardinality(p_courses)>30 or exists(select 1 from unnest(p_courses) c where c is null or length(c) not between 1 and 180) or (p_semester is not null and p_semester not between 1 and 12) then raise exception 'invalid_courses'; end if;
 perform 1 from public.profiles where id=uid for update;
 if exists(select 1 from public.progress where student_id=uid and done&&p_courses) or exists(select 1 from public.course_status where student_id=uid and course_id=any(p_courses) and status in ('aprobado','convalidado')) then raise exception 'already_completed'; end if;
 delete from public.course_status where student_id=uid and status='matriculado' and not(course_id=any(p_courses));
 insert into public.course_status(student_id,course_id,status) select uid,c,'matriculado' from (select distinct unnest(p_courses) c) s
 on conflict(student_id,course_id) do update set status='matriculado',passed_at=null,updated_at=now();
 insert into public.student_setup(student_id,preferences,draft) values(uid,case when p_semester is null then '{}'::jsonb else jsonb_build_object('semester',p_semester) end,jsonb_build_object('enrolled',p_courses))
 on conflict(student_id) do update set preferences=student_setup.preferences||excluded.preferences,draft=student_setup.draft||excluded.draft||case when p_semester is null then '{}'::jsonb else jsonb_build_object('semester',p_semester) end,updated_at=now();
 result:=public.save_academic_plan(coalesce(p_plan,(select plan from public.progress where student_id=uid),'{}'));
 return result||jsonb_build_object('semester',(select preferences->'semester' from public.student_setup where student_id=uid),'statuses',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.course_status s where student_id=uid));
end $$;

-- Compatibility for existing clients, with the same atomic pruning of future plans.
create or replace function public.set_semester_courses(p_courses text[])
returns jsonb language sql security invoker set search_path='' as $$ select public.save_current_semester(p_courses,null)->'statuses' $$;

create or replace function public.save_academic_course_status(p_course text,p_status text,p_plan text[] default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
 if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
 if p_course is null or length(p_course) not between 1 and 180 or p_status is null or p_status not in ('','matriculado','desaprobado') then raise exception 'invalid_status'; end if;
 perform 1 from public.profiles where id=uid for update;
 if exists(select 1 from public.progress where student_id=uid and p_course=any(done)) then raise exception 'already_completed'; end if;
 if p_status='' then delete from public.course_status where student_id=uid and course_id=p_course;
 else insert into public.course_status(student_id,course_id,status) values(uid,p_course,p_status) on conflict(student_id,course_id) do update set status=excluded.status,passed_at=null,updated_at=now(); end if;
 result:=public.save_academic_plan(coalesce(p_plan,(select plan from public.progress where student_id=uid),'{}'));
 return result||jsonb_build_object('statuses',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.course_status s where student_id=uid));
end $$;

revoke all on function public.save_academic_plan(text[]),public.save_academic_progress(text[],text[],text[]),public.save_current_semester(text[],integer,text[]),public.save_academic_course_status(text,text,text[]),public.set_semester_courses(text[]) from public,anon;
grant execute on function public.save_academic_plan(text[]),public.save_academic_progress(text[],text[],text[]),public.save_current_semester(text[],integer,text[]),public.save_academic_course_status(text,text,text[]),public.set_semester_courses(text[]) to authenticated;

-- Initial setup must not turn current enrollment into future plans.
CREATE OR REPLACE FUNCTION public.complete_student_setup(value jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  insert into public.progress(student_id,done,plan,updated_at) values(uid,approved,'{}'::text[],now())
  on conflict(student_id) do update set done=excluded.done,plan=array(select c from unnest(progress.plan) c where not(c=any(approved)) and not(c=any(enrolled))),updated_at=now();
  foreach cid in array approved loop
    insert into public.course_status(student_id,course_id,status) values(uid,cid,'aprobado') on conflict(student_id,course_id) do update set status=case when course_status.status='convalidado' then 'convalidado' else 'aprobado' end,updated_at=now();
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
end $function$

