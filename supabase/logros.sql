-- ============================================================
-- Query 27 · LOGROS: insignias por participación verificable
-- ============================================================
-- Logros PRIVADOS por alumno (solo los ve su dueño), otorgados
-- únicamente por la función reclamar_logros(), que valida cada
-- condición en el servidor contra datos observables (avance de
-- malla, reseñas, profesores, herramientas y arcade). El cliente
-- NO puede insertar logros: nada es falsificable desde la API.
-- Las notas NO otorgan logros (decisión deliberada: son
-- autodeclaradas y privadas).
-- Correr ANTES de desplegar el frontend con logros.

create table public.logros (
  student_id uuid not null references public.profiles(id) on delete cascade,
  logro      text not null check (logro in (
    'primer-paso', 'en-marcha', 'medio-camino', 'veterano',
    'primera-resena', 'critico', 'voz-del-aula', 'orientador',
    'aporte-herramienta', 'arcade-novato', 'arcade-completo',
    'arcade-10k', 'identidad')),
  earned_at  timestamptz not null default now(),
  primary key (student_id, logro)
);

alter table public.logros enable row level security;

-- Cada alumno solo lee SUS logros; nadie escribe directamente
create policy "logros propios"
  on public.logros for select
  to authenticated
  using (student_id = auth.uid());

revoke all on table public.logros from anon, authenticated;
grant select on table public.logros to authenticated;

-- Evalúa todas las condiciones y otorga lo que falte.
-- Devuelve SOLO los logros recién desbloqueados (para el aviso en la app).
create or replace function public.reclamar_logros()
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n_cursos  int;
  n_resenas int;
  n_profs   int;
  n_tags    int;
  n_tools   int;
  n_juegos  int;
  mejor     int;
  a         text;
begin
  if uid is null then
    raise exception 'NO_AUTH';
  end if;
  select coalesce(array_length(done, 1), 0) into n_cursos
    from public.progress where student_id = uid;
  n_cursos := coalesce(n_cursos, 0); -- sin fila en progress todavía
  select count(*) into n_resenas from public.course_comments where author_id = uid;
  select count(*) into n_profs   from public.professors      where created_by = uid;
  select count(*) into n_tags    from public.professor_tags  where student_id = uid;
  select count(*) into n_tools   from public.tools           where created_by = uid;
  select count(distinct game), coalesce(max(score), 0) into n_juegos, mejor
    from public.game_scores where student_id = uid;
  select alias into a from public.profiles where id = uid;

  return query
  with nuevos as (
    insert into public.logros (student_id, logro)
    select uid, v.l
    from (values
      ('primer-paso',        n_cursos  >= 1),
      ('en-marcha',          n_cursos  >= 10),
      ('medio-camino',       n_cursos  >= 25),
      ('veterano',           n_cursos  >= 45),
      ('primera-resena',     n_resenas >= 1),
      ('critico',            n_resenas >= 5),
      ('voz-del-aula',       n_profs   >= 1),
      ('orientador',         n_tags    >= 10),
      ('aporte-herramienta', n_tools   >= 1),
      ('arcade-novato',      n_juegos  >= 1),
      ('arcade-completo',    n_juegos  >= 5),
      ('arcade-10k',         mejor     >= 10000),
      ('identidad',          a is not null)
    ) as v(l, ok)
    where v.ok
    on conflict do nothing
    returning logro
  )
  select logro from nuevos;
end;
$$;

revoke execute on function public.reclamar_logros() from public, anon;
grant execute on function public.reclamar_logros() to authenticated;
