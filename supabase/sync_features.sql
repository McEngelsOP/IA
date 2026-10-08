-- Plan, calendario y tareas privados. Ejecutar antes de publicar pagina.html.
-- Actualización idempotente: conserva eventos y planes existentes, incluidos rangos del calendario anterior.
begin;
alter table public.progress add column if not exists plan text[] not null default '{}';
create table if not exists public.calendar_events (
  id text primary key,
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text default '',
  date text,
  start_date text,
  end_date text,
  color text not null default 'gris',
  created_at timestamptz default now()
);
alter table public.calendar_events
  add column if not exists event_type text not null default 'personal',
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists location text not null default '',
  add column if not exists course_id text,
  add column if not exists repeat_rule text not null default 'none',
  add column if not exists repeat_until date,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.valid_calendar_date(value text)
returns boolean language plpgsql immutable set search_path = public as $$
begin
  if value is null or value !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return to_char(value::date, 'YYYY-MM-DD') = value;
exception when others then return false;
end;
$$;
revoke all on function public.valid_calendar_date(text) from public, anon;
grant execute on function public.valid_calendar_date(text) to authenticated;

alter table public.calendar_events
  drop constraint if exists calendar_event_content,
  drop constraint if exists calendar_event_dates,
  drop constraint if exists calendar_event_hours,
  drop constraint if exists calendar_event_repeat;
alter table public.calendar_events
  add constraint calendar_event_content check (
    char_length(trim(title)) between 1 and 160
    and char_length(coalesce(description, '')) <= 2000
    and char_length(location) <= 160
    and event_type in ('clase','examen','entrega','estudio','personal')
  ) not valid,
  add constraint calendar_event_dates check (
    public.valid_calendar_date(coalesce(date, start_date))
    and (date is null or public.valid_calendar_date(date))
    and (start_date is null or public.valid_calendar_date(start_date))
    and (end_date is null or (public.valid_calendar_date(end_date) and end_date >= coalesce(date, start_date)))
  ) not valid,
  add constraint calendar_event_hours check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and end_time > start_time and end_time < time '24:00')
  ) not valid,
  add constraint calendar_event_repeat check (
    repeat_rule in ('none','weekly')
    and (repeat_until is null or repeat_until::text >= coalesce(date,start_date))
    and (repeat_rule <> 'weekly' or end_date is null or end_date = coalesce(date,start_date))
  ) not valid;

create table if not exists public.calendar_tasks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  due_date date not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists calendar_events_student_date on public.calendar_events(student_id, date);
create index if not exists calendar_events_student_start on public.calendar_events(student_id, start_date);
create index if not exists calendar_tasks_student_due on public.calendar_tasks(student_id, due_date);
alter table public.calendar_events enable row level security;
alter table public.calendar_tasks enable row level security;

-- Se reemplazan exclusivamente las políticas conocidas de estas dos tablas privadas.
drop policy if exists "Students can view own calendar events" on public.calendar_events;
drop policy if exists "Students can insert own calendar events" on public.calendar_events;
drop policy if exists "Students can update own calendar events" on public.calendar_events;
drop policy if exists "Students can delete own calendar events" on public.calendar_events;
create policy "Students can view own calendar events" on public.calendar_events for select to authenticated using (auth.uid() = student_id);
create policy "Students can insert own calendar events" on public.calendar_events for insert to authenticated with check (auth.uid() = student_id);
create policy "Students can update own calendar events" on public.calendar_events for update to authenticated using (auth.uid() = student_id) with check (auth.uid() = student_id);
create policy "Students can delete own calendar events" on public.calendar_events for delete to authenticated using (auth.uid() = student_id);
drop policy if exists "Students manage own calendar tasks" on public.calendar_tasks;
create policy "Students manage own calendar tasks" on public.calendar_tasks for all to authenticated using (auth.uid() = student_id) with check (auth.uid() = student_id);
revoke all on public.calendar_events, public.calendar_tasks from public, anon;
grant select, insert, update, delete on public.calendar_events, public.calendar_tasks to authenticated;

create or replace function public.calendar_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.calendar_touch_updated_at() from public, anon, authenticated;
drop trigger if exists calendar_event_updated on public.calendar_events;
create trigger calendar_event_updated before update on public.calendar_events for each row execute function public.calendar_touch_updated_at();
drop trigger if exists calendar_task_updated on public.calendar_tasks;
create trigger calendar_task_updated before update on public.calendar_tasks for each row execute function public.calendar_touch_updated_at();
commit;
notify pgrst, 'reload schema';
