-- ============================================================
-- Query 29 · MÁS LOGROS: seis insignias difíciles
-- ============================================================
-- Amplía el catálogo de logros (query 27) con condiciones más
-- exigentes, siempre observables en el servidor (las notas siguen
-- sin dar logros: son autodeclaradas). Nuevos logros:
--   revancha       → aprobó un curso llevándolo 2+ veces
--   malla-completa → terminó el 100 % de los cursos de su carrera
--   ojo-clinico    → un profesor suyo llegó a +10 de puntaje neto
--   pentacampeon   → 10 000+ puntos en CADA uno de los 5 juegos
--   dos-temporadas → puntaje registrado en 2 temporadas distintas
--   coleccionista  → 10 logros desbloqueados
-- OJO: malla-completa duplica el total de cursos por carrera
-- (regla duplicada como la de temporadas): si una malla cambia en
-- src/data/*, actualizar los números del CASE de esta función.
--   ia = 72 · industrial = 77 · marketing = 75 · pucp-mecatronica = 64
-- Correr ANTES de desplegar el frontend con los logros nuevos.

alter table public.logros drop constraint logros_logro_check;
alter table public.logros add constraint logros_logro_check check (logro in (
  'primer-paso', 'en-marcha', 'medio-camino', 'veterano',
  'primera-resena', 'critico', 'voz-del-aula', 'orientador',
  'aporte-herramienta', 'arcade-novato', 'arcade-completo',
  'arcade-10k', 'identidad',
  'revancha', 'malla-completa', 'ojo-clinico',
  'pentacampeon', 'dos-temporadas', 'coleccionista'));

create or replace function public.reclamar_logros()
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n_cursos   int;
  n_resenas  int;
  n_profs    int;
  n_tags     int;
  n_tools    int;
  n_juegos   int;
  mejor      int;
  a          text;
  car        text;
  total_malla    int;
  revancha       boolean;
  ojo_clinico    boolean;
  n_juegos_10k   int;
  n_temporadas   int;
  n_logros       int;
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
  select alias, carrera into a, car from public.profiles where id = uid;

  -- total de cursos de la malla (duplicado de src/data/* a propósito)
  total_malla := case car
    when 'ia'               then 72
    when 'industrial'       then 77
    when 'marketing'        then 75
    when 'pucp-mecatronica' then 64
    else null
  end;

  -- aprobó un curso que llevó más de una vez
  select exists (
    select 1 from public.course_status
    where student_id = uid and status = 'aprobado' and times_taken >= 2
  ) into revancha;

  -- algún profesor sugerido por el alumno con puntaje neto >= +10
  select exists (
    select 1 from public.professors p
    where p.created_by = uid
      and (select coalesce(sum(v.vote), 0)
             from public.professor_votes v
            where v.professor_id = p.id) >= 10
  ) into ojo_clinico;

  select count(distinct game) into n_juegos_10k
    from public.game_scores where student_id = uid and score >= 10000;
  select count(distinct season) into n_temporadas
    from public.game_scores where student_id = uid;

  -- logros ya ganados ANTES de esta reclamada: coleccionista se
  -- desbloquea en la visita siguiente a ganar el décimo (inofensivo)
  select count(*) into n_logros from public.logros where student_id = uid;

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
      ('identidad',          a is not null),
      ('revancha',           revancha),
      ('malla-completa',     total_malla is not null and n_cursos >= total_malla),
      ('ojo-clinico',        ojo_clinico),
      ('pentacampeon',       n_juegos_10k >= 5),
      ('dos-temporadas',     n_temporadas >= 2),
      ('coleccionista',      n_logros >= 10)
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
