-- Generado por scripts/generateCurricula.mjs. Ejecutar una vez en SQL Editor.
-- Es repetible: conserva perfiles, avances, notas, RLS y el candado de carrera.
-- Focus y Logros se actualizan solo si ya están instalados.
begin;
do $constraints$
declare item record;
begin
  for item in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'c'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'carrera')]::smallint[]
  loop
    execute format('alter table public.profiles drop constraint %I', item.conname);
  end loop;
end;
$constraints$;
alter table public.profiles add constraint profiles_carrera_check
  check (carrera in ('ia', 'industrial', 'marketing', 'administracion', 'administracion-finanzas', 'administracion-marketing', 'administracion-negocios-internacionales', 'contabilidad', 'derecho', 'derecho-corporativo', 'economia', 'economia-finanzas', 'economia-negocios-internacionales', 'ambiental', 'ciencia-datos', 'software', 'sistemas', 'psicologia', 'pucp-mecatronica'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  code text := upper(trim(coalesce(new.raw_user_meta_data->>'student_code', '')));
  career text := new.raw_user_meta_data->>'carrera';
begin
  if career is null or career not in ('ia', 'industrial', 'marketing', 'administracion', 'administracion-finanzas', 'administracion-marketing', 'administracion-negocios-internacionales', 'contabilidad', 'derecho', 'derecho-corporativo', 'economia', 'economia-finanzas', 'economia-negocios-internacionales', 'ambiental', 'ciencia-datos', 'software', 'sistemas', 'psicologia', 'pucp-mecatronica') then raise exception 'INVALID_CAREER'; end if;
  if career = 'pucp-mecatronica' then
    if code !~ '^20[0-9]{6}$' then raise exception 'invalid student code'; end if;
  else
    if code !~ '^[0-9]{8}$' then raise exception 'invalid student code'; end if;
    if left(code, 2)::int < 25 or left(code, 2)::int > extract(year from now() at time zone 'America/Lima')::int % 100 then raise exception 'invalid student code'; end if;
  end if;
  insert into public.profiles(id, student_code, email, carrera) values(new.id, code, new.email, career);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

do $upgrade$
begin
  if to_regprocedure('public.start_focus_session(uuid,text,integer,text,text,text)') is not null then
    execute $focus$
create or replace function public.start_focus_session(request_id uuid,cid text,seconds integer,chosen_method text,chosen_style text,chosen_pet text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); career_name text;
begin
 if uid is null then raise exception 'NO_AUTH'; end if;
 select carrera into career_name from public.profiles where id=uid for update;
 if career_name is null or career_name not in ('ia', 'industrial', 'marketing', 'administracion', 'administracion-finanzas', 'administracion-marketing', 'administracion-negocios-internacionales', 'contabilidad', 'derecho', 'derecho-corporativo', 'economia', 'economia-finanzas', 'economia-negocios-internacionales', 'ambiental', 'ciencia-datos', 'software', 'sistemas', 'psicologia', 'pucp-mecatronica') then raise exception 'PROFILE_REQUIRED'; end if;
 if exists(select 1 from public.focus_study_sessions where id=request_id and student_id=uid) then return public.focus_session_snapshot(request_id); end if;
 if exists(select 1 from public.focus_study_sessions where student_id=uid and status in ('running','paused')) then raise exception 'FOCUS_ALREADY_ACTIVE'; end if;
 if seconds is null or seconds not between 300 and 14100 or chosen_method is null or chosen_method not in ('p25','p45','p90','custom') or chosen_style is null or chosen_style not in ('digital','ring','arc','dots') or chosen_pet is null or chosen_pet not in ('cat','rabbit','owl') then raise exception 'INVALID_FOCUS'; end if;
 if (chosen_method='p25' and seconds<>1500) or (chosen_method='p45' and seconds<>2700) or (chosen_method='p90' and seconds<>5400) then raise exception 'INVALID_FOCUS'; end if;
 if cid is not null and not exists(select 1 from public.course_status where student_id=uid and course_id=cid and status='matriculado') then raise exception 'COURSE_NOT_ENROLLED'; end if;
 if (select count(*) from public.focus_study_sessions where student_id=uid and started_at>now()-interval '1 hour')>=30 then raise exception 'FOCUS_START_LIMIT'; end if;
 insert into public.focus_study_sessions(id,student_id,career,course_id,method,clock_style,companion,planned_seconds) values(request_id,uid,career_name,cid,chosen_method,chosen_style,chosen_pet,seconds);
 return public.focus_session_snapshot(request_id);
end;$$;
    $focus$;
  end if;
  if to_regprocedure('public.reclamar_logros()') is not null then
    execute $achievements$
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
$$;
    $achievements$;
  end if;
end;
$upgrade$;
commit;
notify pgrst, 'reload schema';
