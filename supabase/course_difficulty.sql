-- ============================================================
-- Sílabo IA · Dificultad del Curso (votos de 1 a 5 por alumno)
--
-- 1) course_difficulty_votes — un voto por alumno por curso.
--    Escala de 1 a 5 (1: Muy fácil, 2: Fácil, 3: Medio, 4: Difícil, 5: Pesadilla).
-- 2) RLS activado: lectura pública para autenticados, escritura solo propia.
--
-- Nombre sugerido de la query: 20 · Dificultad de Cursos
-- ============================================================

create table if not exists public.course_difficulty_votes (
  course_id text not null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  updated_at timestamptz default now(),
  primary key (course_id, student_id)
);

alter table public.course_difficulty_votes enable row level security;

-- Limpieza de políticas previas para evitar errores de duplicación al reejecutar
drop policy if exists "Authenticated read difficulty votes" on public.course_difficulty_votes;
drop policy if exists "Students insert own difficulty vote" on public.course_difficulty_votes;
drop policy if exists "Students update own difficulty vote" on public.course_difficulty_votes;
drop policy if exists "Students delete own difficulty vote" on public.course_difficulty_votes;

-- Todos los usuarios autenticados pueden ver las votaciones
create policy "Authenticated read difficulty votes"
on public.course_difficulty_votes for select to authenticated
using (true);

-- Cada alumno puede insertar su propio voto
create policy "Students insert own difficulty vote"
on public.course_difficulty_votes for insert to authenticated
with check (auth.uid() = student_id);

-- Cada alumno puede actualizar su propio voto
create policy "Students update own difficulty vote"
on public.course_difficulty_votes for update to authenticated
using (auth.uid() = student_id);

-- Cada alumno puede borrar su propio voto
create policy "Students delete own difficulty vote"
on public.course_difficulty_votes for delete to authenticated
using (auth.uid() = student_id);

-- Función pública para obtener resumen de dificultad de un curso
create or replace function public.get_course_difficulty_stats(cid text)
returns json
language sql
security definer set search_path = public
stable
as $func$
  select json_build_object(
    'avg_rating', coalesce(round(avg(rating)::numeric, 1), 0),
    'total_votes', count(*)::int,
    'user_rating', (
      select rating from public.course_difficulty_votes
      where course_id = cid and student_id = auth.uid()
    )
  )
  from public.course_difficulty_votes
  where course_id = cid;
$func$;

grant execute on function public.get_course_difficulty_stats(text) to authenticated, anon;
