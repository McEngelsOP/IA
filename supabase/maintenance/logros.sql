-- Logros - Rutinas consolidadas de mantenimiento, Lyra, 13-10-2026 UTC.
-- Base YA instalada: no crea tablas, no migra datos ni sustituye políticas RLS.
-- Conserva nombres RPC, valores por defecto, search_path y permisos vigentes.
-- Las funciones de app_private se mantienen separadas de sus entradas públicas.
-- Revisar esta instantánea antes de aplicarla tras futuras migraciones.
BEGIN;
DO $requirements$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['logros','profiles','progress','course_comments','professors','professor_tags','tools','game_scores','course_status','professor_votes','tool_likes'] LOOP
    IF to_regclass('public.'||table_name) IS NULL THEN
      RAISE EXCEPTION 'Falta public.%; usar el procedimiento de instalación, no mantenimiento',table_name;
    END IF;
  END LOOP;
END;
$requirements$;

CREATE OR REPLACE FUNCTION public.reclamar_logros()
 RETURNS SETOF text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  creado     timestamptz;
  total_malla    int;
  revancha       boolean;
  ojo_clinico    boolean;
  n_juegos_10k   int;
  n_temporadas   int;
  n_logros       int;
  n_status       int;
  n_votos        int;
  tool_estrella  boolean;
  leyenda        boolean;
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
  select alias, carrera, created_at into a, car, creado from public.profiles where id = uid;

  -- total de cursos de la malla (duplicado de src/data/* a propósito)
  total_malla := case car
    when 'administracion' then 69
    when 'administracion-finanzas' then 73
    when 'administracion-marketing' then 72
    when 'administracion-negocios-internacionales' then 74
    when 'contabilidad' then 68
    when 'derecho' then 71
    when 'derecho-corporativo' then 87
    when 'economia' then 67
    when 'economia-finanzas' then 72
    when 'economia-negocios-internacionales' then 72
    when 'ambiental' then 66
    when 'ciencia-datos' then 66
    when 'software' then 69
    when 'sistemas' then 78
    when 'psicologia' then 82
    when 'ia' then 69
    when 'industrial' then 77
    when 'marketing' then 75
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

  select count(*) into n_status from public.course_status where student_id = uid;
  select count(*) into n_votos  from public.professor_votes where student_id = uid;

  -- alguna herramienta suya con 10 likes o más
  select exists (
    select 1 from public.tools t
    where t.created_by = uid
      and (select count(*) from public.tool_likes l where l.tool_id = t.id) >= 10
  ) into tool_estrella;

  -- top 3 de algún juego en una temporada ya cerrada (empates cuentan)
  select exists (
    select 1 from (
      select student_id,
             rank() over (partition by game, season order by score desc) as rk
      from public.game_scores
      where season <> public.temporada_actual()
    ) r
    where r.student_id = uid and r.rk <= 3
  ) into leyenda;

  return query
  with nuevos as (
    insert into public.logros (student_id, logro)
    select uid, v.l
    from (values
      ('primer-paso',         n_cursos  >= 1),
      ('en-marcha',           n_cursos  >= 10),
      ('medio-camino',        n_cursos  >= 25),
      ('veterano',            n_cursos  >= 45),
      ('primera-resena',      n_resenas >= 1),
      ('critico',             n_resenas >= 5),
      ('voz-del-aula',        n_profs   >= 1),
      ('orientador',          n_tags    >= 10),
      ('aporte-herramienta',  n_tools   >= 1),
      ('arcade-novato',       n_juegos  >= 1),
      ('arcade-completo',     n_juegos  >= 5),
      ('arcade-10k',          mejor     >= 10000),
      ('identidad',           a is not null),
      ('revancha',            revancha),
      ('malla-completa',      total_malla is not null and n_cursos >= total_malla),
      ('ojo-clinico',         ojo_clinico),
      ('pentacampeon',        n_juegos_10k >= 5),
      ('dos-temporadas',      n_temporadas >= 2),
      ('coleccionista',       n_logros >= 10),
      ('archivista',          n_status >= 20),
      ('elector',             n_votos  >= 20),
      ('herramienta-estrella', tool_estrella),
      ('cincuenta-mil',       mejor >= 50000),
      ('leyenda-temporada',   leyenda),
      ('un-anio',             creado is not null and creado <= now() - interval '1 year')
    ) as v(l, ok)
    where v.ok
    on conflict do nothing
    returning logro
  )
  select logro from nuevos;
end;
$function$;
REVOKE ALL ON FUNCTION public.reclamar_logros() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reclamar_logros() TO "postgres";
GRANT EXECUTE ON FUNCTION public.reclamar_logros() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.reclamar_logros() TO "service_role";

NOTIFY pgrst, 'reload schema';
COMMIT;

