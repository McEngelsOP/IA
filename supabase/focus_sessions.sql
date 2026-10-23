-- Mod Focus privado: reloj persistente y tiempo comprobado por el servidor. No inserta muestras.
begin;
create table if not exists public.focus_study_sessions (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.profiles(id) on delete cascade,
 career text not null,
 course_id text,
 method text not null check(method in ('p25','p45','p90','custom')),
 clock_style text not null check(clock_style in ('digital','ring','arc','dots')),
 companion text not null check(companion in ('cat','rabbit','owl')),
 planned_seconds integer not null check(planned_seconds between 300 and 14100),
 elapsed_seconds numeric not null default 0 check(elapsed_seconds >= 0 and elapsed_seconds <= planned_seconds),
 status text not null default 'running' check(status in ('running','paused','completed','interrupted')),
 started_at timestamptz not null default now(),
 active_since timestamptz default now(),
 finished_at timestamptz,
 updated_at timestamptz not null default now(),
 check((status='running' and active_since is not null and finished_at is null) or (status='paused' and active_since is null and finished_at is null) or (status in ('completed','interrupted') and active_since is null and finished_at is not null)),
 check(status<>'completed' or elapsed_seconds=planned_seconds),
 check((method='p25' and planned_seconds=1500) or (method='p45' and planned_seconds=2700) or (method='p90' and planned_seconds=5400) or method='custom')
);
create unique index if not exists focus_study_one_active on public.focus_study_sessions(student_id) where status in ('running','paused');
create index if not exists focus_study_student_finished on public.focus_study_sessions(student_id,finished_at desc);
create index if not exists focus_study_student_started on public.focus_study_sessions(student_id,started_at desc);
alter table public.focus_study_sessions enable row level security;
drop policy if exists "Students read own focus sessions" on public.focus_study_sessions;
create policy "Students read own focus sessions" on public.focus_study_sessions for select to authenticated using(student_id=auth.uid());
revoke all on public.focus_study_sessions from public,anon,authenticated;
grant select on public.focus_study_sessions to authenticated;

create or replace function public.focus_session_snapshot(sid uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare session public.focus_study_sessions%rowtype; spent numeric;
begin
 if auth.uid() is null then raise exception 'NO_AUTH'; end if;
 select * into session from public.focus_study_sessions where id=sid and student_id=auth.uid();
 if session.id is null then raise exception 'FOCUS_UNAVAILABLE'; end if;
 spent:=session.elapsed_seconds+case when session.status='running' then greatest(0,extract(epoch from now()-session.active_since)) else 0 end;
 return (to_jsonb(session)-'student_id')||jsonb_build_object('remaining_seconds',greatest(0,ceil(session.planned_seconds-spent))::integer);
end;$$;

create or replace function public.focus_active_session()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare sid uuid;
begin
 if auth.uid() is null then raise exception 'NO_AUTH'; end if;
 select id into sid from public.focus_study_sessions where student_id=auth.uid() and status in ('running','paused');
 return case when sid is null then null else public.focus_session_snapshot(sid) end;
end;$$;

create or replace function public.start_focus_session(request_id uuid,cid text,seconds integer,chosen_method text,chosen_style text,chosen_pet text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); career_name text;
begin
 if uid is null then raise exception 'NO_AUTH'; end if;
 select carrera into career_name from public.profiles where id=uid for update;
 if career_name is null or career_name not in ('ia', 'industrial', 'marketing', 'administracion', 'administracion-finanzas', 'administracion-marketing', 'administracion-negocios-internacionales', 'contabilidad', 'derecho', 'derecho-corporativo', 'economia', 'economia-finanzas', 'economia-negocios-internacionales', 'ambiental', 'ciencia-datos', 'software', 'sistemas', 'psicologia') then raise exception 'PROFILE_REQUIRED'; end if;
 if exists(select 1 from public.focus_study_sessions where id=request_id and student_id=uid) then return public.focus_session_snapshot(request_id); end if;
 if exists(select 1 from public.focus_study_sessions where student_id=uid and status in ('running','paused')) then raise exception 'FOCUS_ALREADY_ACTIVE'; end if;
 if seconds is null or seconds not between 300 and 14100 or chosen_method is null or chosen_method not in ('p25','p45','p90','custom') or chosen_style is null or chosen_style not in ('digital','ring','arc','dots') or chosen_pet is null or chosen_pet not in ('cat','rabbit','owl') then raise exception 'INVALID_FOCUS'; end if;
 if (chosen_method='p25' and seconds<>1500) or (chosen_method='p45' and seconds<>2700) or (chosen_method='p90' and seconds<>5400) then raise exception 'INVALID_FOCUS'; end if;
 if cid is not null and not exists(select 1 from public.course_status where student_id=uid and course_id=cid and status='matriculado') then raise exception 'COURSE_NOT_ENROLLED'; end if;
 if (select count(*) from public.focus_study_sessions where student_id=uid and started_at>now()-interval '1 hour')>=30 then raise exception 'FOCUS_START_LIMIT'; end if;
 insert into public.focus_study_sessions(id,student_id,career,course_id,method,clock_style,companion,planned_seconds) values(request_id,uid,career_name,cid,chosen_method,chosen_style,chosen_pet,seconds);
 return public.focus_session_snapshot(request_id);
end;$$;

create or replace function public.update_focus_session(sid uuid,action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); session public.focus_study_sessions%rowtype; spent numeric; ended timestamptz;
begin
 if uid is null then raise exception 'NO_AUTH'; end if;
 if action is null or action not in ('pause','resume','finish','interrupt') then raise exception 'INVALID_FOCUS'; end if;
 perform 1 from public.profiles where id=uid for update;
 select * into session from public.focus_study_sessions where id=sid and student_id=uid for update;
 if session.id is null then raise exception 'FOCUS_UNAVAILABLE'; end if;
 if session.status in ('completed','interrupted') then return public.focus_session_snapshot(sid); end if;
 spent:=least(session.planned_seconds,session.elapsed_seconds+case when session.status='running' then greatest(0,extract(epoch from now()-session.active_since)) else 0 end);
 if action='finish' and spent<session.planned_seconds then raise exception 'FOCUS_NOT_FINISHED'; end if;
 if action in ('finish','interrupt') then
  ended:=case when spent=session.planned_seconds and session.status='running' then least(now(),session.active_since+(session.planned_seconds-session.elapsed_seconds)*interval '1 second') else now() end;
  update public.focus_study_sessions set status=case when spent=planned_seconds then 'completed' else 'interrupted' end,elapsed_seconds=spent,active_since=null,finished_at=ended,updated_at=now() where id=sid and student_id=uid;
 elsif action='pause' and session.status='running' then
  update public.focus_study_sessions set status='paused',elapsed_seconds=spent,active_since=null,updated_at=now() where id=sid and student_id=uid;
 elsif action='resume' and session.status='paused' then
  update public.focus_study_sessions set status='running',active_since=now(),updated_at=now() where id=sid and student_id=uid;
 end if;
 return public.focus_session_snapshot(sid);
end;$$;

create or replace function public.focus_daily_summary(day date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare summary jsonb; start_at timestamptz; end_at timestamptz;
begin
 if auth.uid() is null then raise exception 'NO_AUTH'; end if;
 if day is null then raise exception 'INVALID_FOCUS'; end if;
 start_at:=day::timestamp at time zone 'America/Lima'; end_at:=(day+1)::timestamp at time zone 'America/Lima';
 select jsonb_build_object('seconds',coalesce(floor(sum(elapsed_seconds)),0)::integer,'completed_count',count(*) filter(where status='completed'),'interrupted_count',count(*) filter(where status='interrupted')) into summary
 from public.focus_study_sessions where student_id=auth.uid() and finished_at>=start_at and finished_at<end_at and elapsed_seconds>=1;
 return summary||jsonb_build_object('sessions',coalesce((select jsonb_agg(to_jsonb(s) order by s.finished_at desc,s.id desc) from (select id,course_id,method,status,floor(elapsed_seconds)::integer as seconds,finished_at from public.focus_study_sessions where student_id=auth.uid() and finished_at>=start_at and finished_at<end_at and elapsed_seconds>=1 order by finished_at desc,id desc limit 30) s),'[]'::jsonb));
end;$$;

revoke all on function public.focus_session_snapshot(uuid),public.focus_active_session(),public.start_focus_session(uuid,text,integer,text,text,text),public.update_focus_session(uuid,text),public.focus_daily_summary(date) from public,anon;
grant execute on function public.focus_session_snapshot(uuid),public.focus_active_session(),public.start_focus_session(uuid,text,integer,text,text,text),public.update_focus_session(uuid,text),public.focus_daily_summary(date) to authenticated;
commit;
notify pgrst,'reload schema';
