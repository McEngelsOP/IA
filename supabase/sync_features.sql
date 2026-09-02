-- ============================================================
-- Sílabo IA · Sincronización en la Nube (Plan y Calendario)
-- 1. Agrega la columna 'plan' a la tabla 'progress'
-- 2. Crea la tabla 'calendar_events' para eventos personales del alumno
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1. Columna de plan para el próximo ciclo en 'progress'
alter table public.progress 
add column if not exists plan text[] not null default '{}';

-- 2. Tabla de eventos personales de calendario por estudiante
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

alter table public.calendar_events enable row level security;

-- Políticas RLS: cada alumno gestiona únicamente sus propios eventos personales
create policy "Students can view own calendar events"
on public.calendar_events for select
using (auth.uid() = student_id);

create policy "Students can insert own calendar events"
on public.calendar_events for insert
with check (auth.uid() = student_id);

create policy "Students can update own calendar events"
on public.calendar_events for update
using (auth.uid() = student_id);

create policy "Students can delete own calendar events"
on public.calendar_events for delete
using (auth.uid() = student_id);
