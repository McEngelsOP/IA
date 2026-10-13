-- Private tasks remain protected by the existing student ownership RLS.
alter table public.calendar_tasks add column if not exists course_id text;
alter table public.calendar_tasks add constraint calendar_tasks_course_id_length check (course_id is null or length(course_id) between 1 and 100);

-- Atomic update; respects caller RLS and never changes approved courses/grades.
create or replace function public.set_semester_courses(p_courses text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_courses is null or cardinality(p_courses) > 30 or exists(select 1 from unnest(p_courses) c where c is null or length(c) not between 1 and 100) then raise exception 'invalid_courses'; end if;
  perform 1 from public.profiles where id=uid for update;
  if exists(select 1 from public.course_status where student_id=uid and course_id=any(p_courses) and status in ('aprobado','convalidado'))
     or exists(select 1 from public.progress where student_id=uid and done && p_courses) then raise exception 'already_completed'; end if;
  delete from public.course_status where student_id=uid and status='matriculado' and not(course_id=any(p_courses));
  insert into public.course_status(student_id,course_id,status,times_taken,updated_at)
    select uid,c,'matriculado',1,now() from (select distinct unnest(p_courses) c) s
    on conflict(student_id,course_id) do update set status='matriculado',updated_at=now();
  update public.student_setup set draft=jsonb_set(draft,'{enrolled}',to_jsonb(p_courses)),updated_at=now() where student_id=uid;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into result from public.course_status s where student_id=uid;
  return result;
end $$;
revoke all on function public.set_semester_courses(text[]) from public,anon;
grant execute on function public.set_semester_courses(text[]) to authenticated;
