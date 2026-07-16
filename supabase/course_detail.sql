-- ============================================================
-- Sílabo IA · Ficha del curso: estados académicos y reseñas anónimas
--
-- 1) course_status — registro académico privado por alumno+curso:
--    estado (aprobado/convalidado/matriculado/desaprobado), veces
--    llevado, fecha de aprobación y comentario personal. La nota
--    sigue viviendo en la tabla `grades` (no se duplica aquí).
-- 2) course_comments — reseñas anónimas por curso, visibles entre
--    carreras (los cursos equivalentes comparten id). Mismo esquema
--    de anonimato real que tool_comments: el alias lo estampa el
--    servidor (reusa stamp_comment_alias) y author_id NO es legible
--    desde el cliente (permiso a nivel de columna). Tope: 3 reseñas
--    por alumno por curso, máximo 50 palabras / 400 caracteres.
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 15 · Ficha del curso
-- Correr ANTES de desplegar el frontend que la usa.
-- ============================================================

-- 1. Estado académico por curso (privado: cada alumno solo ve lo suyo)
create table public.course_status (
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id text not null,
  status text not null check (status in ('aprobado', 'convalidado', 'matriculado', 'desaprobado')),
  times_taken smallint not null default 1 check (times_taken between 1 and 10),
  passed_at date,
  personal_note text check (personal_note is null or char_length(personal_note) <= 500),
  updated_at timestamptz default now(),
  primary key (student_id, course_id)
);

alter table public.course_status enable row level security;

create policy "Students read own course status"
on public.course_status for select to authenticated
using (auth.uid() = student_id);

create policy "Students insert own course status"
on public.course_status for insert to authenticated
with check (auth.uid() = student_id);

create policy "Students update own course status"
on public.course_status for update to authenticated
using (auth.uid() = student_id);

create policy "Students delete own course status"
on public.course_status for delete to authenticated
using (auth.uid() = student_id);

-- 2. Reseñas anónimas por curso (firmadas con el nombre secreto)
create table public.course_comments (
  id uuid primary key default gen_random_uuid(),
  course_id text not null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  alias text not null,
  body text not null,
  created_at timestamptz default now(),
  constraint course_comments_body_length check (char_length(trim(body)) between 2 and 400),
  -- Máximo 50 palabras (también se valida en la app)
  constraint course_comments_body_words check (
    array_length(regexp_split_to_array(trim(body), '\s+'), 1) <= 50
  )
);

alter table public.course_comments enable row level security;

create policy "Authenticated read course comments"
on public.course_comments for select to authenticated
using (true);

-- Tope anti-spam: máximo 3 reseñas por alumno por curso.
-- OJO: el conteo va en una función SECURITY DEFINER porque author_id
-- está revocada para el cliente — una subconsulta directa fallaría con
-- "permission denied" (el mismo bug que se arregló en tool_comments).
create or replace function public.my_course_comment_count(cid text)
returns integer
language sql
security definer set search_path = public
stable
as $$
  select count(*)::int
  from public.course_comments
  where course_id = cid
    and author_id = auth.uid();
$$;

revoke execute on function public.my_course_comment_count(text) from public, anon;
grant execute on function public.my_course_comment_count(text) to authenticated;

create policy "Students insert own course comments"
on public.course_comments for insert to authenticated
with check (
  auth.uid() = author_id
  and public.my_course_comment_count(course_id) < 3
);

create policy "Students delete own course comments"
on public.course_comments for delete to authenticated
using (auth.uid() = author_id);

-- El alias lo estampa el servidor desde profiles (misma función que
-- tool_comments: lee new.author_id y escribe new.alias — es genérica).
create trigger course_comments_stamp_alias
before insert on public.course_comments
for each row execute procedure public.stamp_comment_alias();

-- 3. Anonimato a nivel de columna: nadie lee author_id ni escribe alias.
--    El cliente debe pedir columnas explícitas (select('*') fallaría).
revoke select on public.course_comments from anon, authenticated;
grant select (id, course_id, alias, body, created_at)
  on public.course_comments to authenticated;

revoke insert on public.course_comments from anon, authenticated;
grant insert (course_id, author_id, body)
  on public.course_comments to authenticated;

revoke update on public.course_comments from anon, authenticated;
