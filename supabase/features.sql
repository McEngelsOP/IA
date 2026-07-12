-- ============================================================
-- Sílabo IA · Profesores, notas y herramientas
-- Todas las tablas son SOLO para usuarios con sesión iniciada
-- (rol authenticated). El modo visitante (anon) no tiene ninguna
-- política, por lo que Supabase le niega lectura y escritura.
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1. Profesores sugeridos por curso (lista compartida)
create table public.professors (
  id uuid primary key default gen_random_uuid(),
  course_id text not null,
  name text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  constraint professors_name_length check (char_length(trim(name)) between 2 and 80)
);

-- Evita duplicados del mismo profesor en el mismo curso ("Juan Pérez" = "juan pérez")
create unique index professors_course_name_uniq
  on public.professors (course_id, lower(trim(name)));

alter table public.professors enable row level security;

create policy "Authenticated read professors"
on public.professors for select to authenticated
using (true);

create policy "Authenticated add professors"
on public.professors for insert to authenticated
with check (auth.uid() = created_by);

create policy "Creators delete own professors"
on public.professors for delete to authenticated
using (auth.uid() = created_by);

-- 2. Votos: un solo voto por alumno por profesor (clave primaria compuesta)
create table public.professor_votes (
  professor_id uuid not null references public.professors(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  vote smallint not null check (vote in (1, -1)), -- 1 = like · -1 = dislike
  updated_at timestamptz default now(),
  primary key (professor_id, student_id)
);

alter table public.professor_votes enable row level security;

create policy "Authenticated read votes"
on public.professor_votes for select to authenticated
using (true);

create policy "Students insert own vote"
on public.professor_votes for insert to authenticated
with check (auth.uid() = student_id);

create policy "Students update own vote"
on public.professor_votes for update to authenticated
using (auth.uid() = student_id);

create policy "Students delete own vote"
on public.professor_votes for delete to authenticated
using (auth.uid() = student_id);

-- 3. Notas por curso (privadas: cada alumno solo ve las suyas)
create table public.grades (
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id text not null,
  grade numeric(4, 2) not null check (grade >= 0 and grade <= 20),
  updated_at timestamptz default now(),
  primary key (student_id, course_id)
);

alter table public.grades enable row level security;

create policy "Students read own grades"
on public.grades for select to authenticated
using (auth.uid() = student_id);

create policy "Students insert own grades"
on public.grades for insert to authenticated
with check (auth.uid() = student_id);

create policy "Students update own grades"
on public.grades for update to authenticated
using (auth.uid() = student_id);

create policy "Students delete own grades"
on public.grades for delete to authenticated
using (auth.uid() = student_id);

-- 4. Herramientas / sitios de ayuda (lista compartida)
create table public.tools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  constraint tools_name_length check (char_length(trim(name)) between 2 and 60),
  constraint tools_url_http check (url ~* '^https?://')
);

alter table public.tools enable row level security;

create policy "Authenticated read tools"
on public.tools for select to authenticated
using (true);

create policy "Authenticated add tools"
on public.tools for insert to authenticated
with check (auth.uid() = created_by);

create policy "Creators delete own tools"
on public.tools for delete to authenticated
using (auth.uid() = created_by);
