-- ============================================================
-- Sílabo IA · Tabla de progreso del alumno
-- Guarda los cursos marcados como llevados por cada estudiante.
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- ============================================================

create table public.progress (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  done text[] not null default '{}',
  updated_at timestamptz default now()
);

alter table public.progress enable row level security;

-- Cada alumno solo puede ver y modificar su propio progreso
create policy "Students read own progress"
on public.progress for select
using (auth.uid() = student_id);

create policy "Students insert own progress"
on public.progress for insert
with check (auth.uid() = student_id);

create policy "Students update own progress"
on public.progress for update
using (auth.uid() = student_id);
