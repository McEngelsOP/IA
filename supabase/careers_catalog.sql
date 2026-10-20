-- Generado por scripts/generateCurricula.mjs. Ejecutar una vez en SQL Editor.
-- Es repetible: conserva perfiles, avances, notas, RLS y el candado de carrera.
-- Focus y Logros se actualizan solo si ya están instalados.
begin;
create table if not exists public.curriculum_versions (
  institution_id text not null, career_key text not null, version text not null,
  source_hash text not null, source_document text not null,
  primary key (institution_id, career_key, version)
);
alter table public.curriculum_versions enable row level security;
revoke all on public.curriculum_versions from public, anon, authenticated;
grant select on public.curriculum_versions to authenticated;
drop policy if exists curriculum_versions_read on public.curriculum_versions;
create policy curriculum_versions_read on public.curriculum_versions for select to authenticated using (true);
insert into public.curriculum_versions values
('esan', 'ia', 'source-70a2d446e2b4', '2f959099ec090a7e2d5b37b95bff43d05da0a21c7eeccc6ca35bab214f86e965', 'Malla_Ingenieria_en_Inteligencia_Artificial.md'),
('esan', 'industrial', 'source-e8b5bb439e57', '32664403a9fdea035e4aaf4c971d80729aed5b134284cfb80a3c2a9a16374105', 'Mallas_Pregrado_2024_xlsx_-_INGICO_2024.md'),
('esan', 'marketing', 'source-08e8720b8548', '9f75a832e836eb7e44c9161637c7ff510786369da5a83d99a09d03cf6c43046d', 'COMUNICACION_EMPRESARIAL_Y_MARKETING_DIGITAL.md'),
('esan', 'administracion', 'source-573905e52eb5', 'ad2d3671943612de290b11d3851980b02b563bd6d77eba03fc4ec2b3151ba7e8', 'Mallas_Pregrado_2024_xlsx_-_ADM_2024_1.md'),
('esan', 'administracion-finanzas', 'source-4e32da728152', '3929cab2b0da73a63d9955793eed28c9d6e27f8335eec251fca4d4bc9075f6b7', 'ADMINISTRACION_Y_FINANZAS.md'),
('esan', 'administracion-marketing', 'source-7aa20577d44e', 'da7b0fa9f5da708dd3e719fc5f9cffc0fd272226ddf2ca2a7e2a37bec72bf697', 'Mallas_Pregrado_2024_xlsx_-_ADYMA_2024.md'),
('esan', 'administracion-negocios-internacionales', 'source-90349c49d777', '9d73262df920e94e92f4a6de00d290ad663333c81ecbd06fe5919cb0be3b1b88', 'ADMINISTRACION_Y_NEGOCIOS_INTERNACIONALES.md'),
('esan', 'contabilidad', 'source-6e57c23d3707', '431ddbf8ce1e5d5e13a4c581fe068d1278510d4953735e4c778d17e3a8ecafc7', 'CONTABILIDAD.md'),
('esan', 'derecho', 'source-6eb46d0e91db', '1e7882fa798ea2bedee41949d7bcd05ee0f7a912fb8772b6e18cb3e1af8b3893', 'Mallas_2026_-_excel_-_DER_2026_1.md'),
('esan', 'derecho-corporativo', 'source-6072e117c5eb', 'd5877a15b067f98d54a79a7618f48a9be475ca61b4230602cb9e45e827d456f2', 'Mallas_Pregrado_2024_xlsx_-_DECO_2024_2.md'),
('esan', 'economia', 'source-8583b48589a7', 'd6a652163867ab74f5f943ea5ca8047acd6f8be6787ea40e6025d1ff04da7214', 'ECONOMIA_-_ECO_.md'),
('esan', 'economia-finanzas', 'source-d2b63e109473', 'e6bf516d2cd52116edfea012a6b0237d787bc61cf34831c05b5232286127def4', 'Mallas_Pregrado_2024_xlsx_-_ECOYFI_2024_5.md'),
('esan', 'economia-negocios-internacionales', 'source-0eb311d1309a', '4dd3dc2e8506e8a42f779763482cd7a2934b403c78b97464e8beb070d52893f4', 'Mallas_Pregrado_2024_xlsx_-_ECYNI_2024_2.md'),
('esan', 'ambiental', 'source-769d5e3d24f0', '90aa62f7e156bb425f0aacb5bf3e1dd55dc25637d68e5f65b83e8d7a8b70076c', 'Mallas_2026_-_excel_-_INGAMB_2026.md'),
('esan', 'ciencia-datos', 'source-f8d2e86623a4', 'bd77be7c3fddb75b918ef5ca40dbd5151105b631c5fa52411736e805ff8a0529', 'Mallas_2026_-_excel_-_INGCD_2026_2.md'),
('esan', 'software', 'source-a6f922953807', 'c8d644a0d8dbf61393ca1bb1f557567511704cd8d2352a9abe10436dd001b732', 'Mallas_2026_-_excel_-_INGSO_2026_1.md'),
('esan', 'sistemas', 'source-dc36765722c8', '0a6ad750216cbd809c67c141dccc521f770783cbcd80d65e0ca912183ba57977', 'Mallas_Pregrado_2024_xlsx_-_INGITIS_2024.md'),
('esan', 'psicologia', 'source-47264f1616a1', 'c9380fb52462a5f835daa8b0ae0b1ef81c2357e50f4c0baf1c37d176725b504f', 'Mallas_2026_-_excel_-_PSIC_2026_1.md')
on conflict do nothing;
alter table public.profiles add column if not exists institution_id text;
alter table public.profiles add column if not exists curriculum_version text;
update public.profiles p set institution_id='esan', curriculum_version=v.version
from public.curriculum_versions v
where p.carrera=v.career_key and v.institution_id='esan'
  and (p.institution_id is null and p.curriculum_version is null)
  and v.version=case p.carrera when 'ia' then 'source-70a2d446e2b4' when 'industrial' then 'source-e8b5bb439e57' when 'marketing' then 'source-08e8720b8548' when 'administracion' then 'source-573905e52eb5' when 'administracion-finanzas' then 'source-4e32da728152' when 'administracion-marketing' then 'source-7aa20577d44e' when 'administracion-negocios-internacionales' then 'source-90349c49d777' when 'contabilidad' then 'source-6e57c23d3707' when 'derecho' then 'source-6eb46d0e91db' when 'derecho-corporativo' then 'source-6072e117c5eb' when 'economia' then 'source-8583b48589a7' when 'economia-finanzas' then 'source-d2b63e109473' when 'economia-negocios-internacionales' then 'source-0eb311d1309a' when 'ambiental' then 'source-769d5e3d24f0' when 'ciencia-datos' then 'source-f8d2e86623a4' when 'software' then 'source-a6f922953807' when 'sistemas' then 'source-dc36765722c8' when 'psicologia' then 'source-47264f1616a1' end;
create or replace function public.protect_curriculum_assignment()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.carrera is distinct from old.carrera and new.carrera is not null and new.carrera not in ('ia', 'industrial', 'marketing', 'administracion', 'administracion-finanzas', 'administracion-marketing', 'administracion-negocios-internacionales', 'contabilidad', 'derecho', 'derecho-corporativo', 'economia', 'economia-finanzas', 'economia-negocios-internacionales', 'ambiental', 'ciencia-datos', 'software', 'sistemas', 'psicologia') then
    raise exception 'INVALID_CAREER';
  end if;
  if old.carrera is null and new.carrera in ('ia', 'industrial', 'marketing', 'administracion', 'administracion-finanzas', 'administracion-marketing', 'administracion-negocios-internacionales', 'contabilidad', 'derecho', 'derecho-corporativo', 'economia', 'economia-finanzas', 'economia-negocios-internacionales', 'ambiental', 'ciencia-datos', 'software', 'sistemas', 'psicologia') then
    new.institution_id := 'esan'; new.curriculum_version := case new.carrera when 'ia' then 'source-70a2d446e2b4' when 'industrial' then 'source-e8b5bb439e57' when 'marketing' then 'source-08e8720b8548' when 'administracion' then 'source-573905e52eb5' when 'administracion-finanzas' then 'source-4e32da728152' when 'administracion-marketing' then 'source-7aa20577d44e' when 'administracion-negocios-internacionales' then 'source-90349c49d777' when 'contabilidad' then 'source-6e57c23d3707' when 'derecho' then 'source-6eb46d0e91db' when 'derecho-corporativo' then 'source-6072e117c5eb' when 'economia' then 'source-8583b48589a7' when 'economia-finanzas' then 'source-d2b63e109473' when 'economia-negocios-internacionales' then 'source-0eb311d1309a' when 'ambiental' then 'source-769d5e3d24f0' when 'ciencia-datos' then 'source-f8d2e86623a4' when 'software' then 'source-a6f922953807' when 'sistemas' then 'source-dc36765722c8' when 'psicologia' then 'source-47264f1616a1' end;
  elsif auth.uid() is not null and (new.institution_id is distinct from old.institution_id or new.curriculum_version is distinct from old.curriculum_version) then
    raise exception 'CURRICULUM_ASSIGNMENT_LOCKED';
  end if;
  return new;
end; $$;
revoke all on function public.protect_curriculum_assignment() from public,anon,authenticated;
drop trigger if exists protect_curriculum_assignment on public.profiles;
create trigger protect_curriculum_assignment before update on public.profiles for each row execute function public.protect_curriculum_assignment();
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
  check (carrera in ('ia', 'industrial', 'marketing', 'administracion', 'administracion-finanzas', 'administracion-marketing', 'administracion-negocios-internacionales', 'contabilidad', 'derecho', 'derecho-corporativo', 'economia', 'economia-finanzas', 'economia-negocios-internacionales', 'ambiental', 'ciencia-datos', 'software', 'sistemas', 'psicologia', 'pucp-mecatronica')); -- Solo se conserva para la cuenta histórica; no admite registros nuevos.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  code text := upper(trim(coalesce(new.raw_user_meta_data->>'student_code', '')));
  career text := new.raw_user_meta_data->>'carrera';
begin
  if career is null or career not in ('ia', 'industrial', 'marketing', 'administracion', 'administracion-finanzas', 'administracion-marketing', 'administracion-negocios-internacionales', 'contabilidad', 'derecho', 'derecho-corporativo', 'economia', 'economia-finanzas', 'economia-negocios-internacionales', 'ambiental', 'ciencia-datos', 'software', 'sistemas', 'psicologia') then raise exception 'INVALID_CAREER'; end if;
  if code !~ '^[0-9]{8}$' then raise exception 'invalid student code'; end if;
  if left(code, 2)::int < 25 or left(code, 2)::int > extract(year from now() at time zone 'America/Lima')::int % 100 then raise exception 'invalid student code'; end if;
  insert into public.profiles(id, student_code, email, carrera, institution_id, curriculum_version)
    select new.id, code, new.email, career, 'esan', case career when 'ia' then 'source-70a2d446e2b4' when 'industrial' then 'source-e8b5bb439e57' when 'marketing' then 'source-08e8720b8548' when 'administracion' then 'source-573905e52eb5' when 'administracion-finanzas' then 'source-4e32da728152' when 'administracion-marketing' then 'source-7aa20577d44e' when 'administracion-negocios-internacionales' then 'source-90349c49d777' when 'contabilidad' then 'source-6e57c23d3707' when 'derecho' then 'source-6eb46d0e91db' when 'derecho-corporativo' then 'source-6072e117c5eb' when 'economia' then 'source-8583b48589a7' when 'economia-finanzas' then 'source-d2b63e109473' when 'economia-negocios-internacionales' then 'source-0eb311d1309a' when 'ambiental' then 'source-769d5e3d24f0' when 'ciencia-datos' then 'source-f8d2e86623a4' when 'software' then 'source-a6f922953807' when 'sistemas' then 'source-dc36765722c8' when 'psicologia' then 'source-47264f1616a1' end;
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
 if career_name is null or career_name not in ('ia', 'industrial', 'marketing', 'administracion', 'administracion-finanzas', 'administracion-marketing', 'administracion-negocios-internacionales', 'contabilidad', 'derecho', 'derecho-corporativo', 'economia', 'economia-finanzas', 'economia-negocios-internacionales', 'ambiental', 'ciencia-datos', 'software', 'sistemas', 'psicologia') then raise exception 'PROFILE_REQUIRED'; end if;
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

  -- total de cursos de la malla (sincronizado desde src/institutions/esan/)
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
