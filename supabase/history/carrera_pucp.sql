-- ============================================================
-- Sílabo IA · Carreras nuevas: PUCP Mecatrónica + Comunicación
-- Empresarial y Marketing Digital (ESAN)
--
-- Agrega 'pucp-mecatronica' y 'marketing' como valores válidos de
-- profiles.carrera y adapta la validación del código de alumno:
--   · ESAN: 8 dígitos, promoción de 25 hasta el año en curso.
--   · PUCP: 8 dígitos que empiezan en 20 (año de ingreso 20xx).
-- Los rangos no se cruzan (20 vs 25+), así que el código sigue
-- siendo único e identifica también la universidad.
--
-- La separación de contenidos NO necesita base: los cursos PUCP
-- usan ids con prefijo 'pucp-', así que profesores, votos, notas
-- y reseñas nunca se mezclan con los de ESAN.
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 16 · Carreras nuevas
-- Correr ANTES de desplegar el frontend con las carreras nuevas.
-- ============================================================

-- 1. La columna carrera acepta el valor nuevo.
--    (El CHECK nació sin nombre explícito en "11 · Carrera por alumno";
--    Postgres lo llamó profiles_carrera_check. Si tu proyecto le puso otro
--    nombre, míralo con: select conname from pg_constraint
--    where conrelid = 'public.profiles'::regclass and contype = 'c';)
alter table public.profiles
  drop constraint profiles_carrera_check;

alter table public.profiles
  add constraint profiles_carrera_check
  check (carrera in ('ia', 'industrial', 'marketing', 'pucp-mecatronica'));

-- 2. El formato del código acepta también el rango PUCP (20xxxxxx).
--    NOT VALID igual que el original: no revisa filas históricas.
alter table public.profiles
  drop constraint profiles_student_code_format;

alter table public.profiles
  add constraint profiles_student_code_format
  check (
    student_code ~ '^[0-9]{8}$'
    and (left(student_code, 2)::int >= 25 or left(student_code, 2) = '20')
  )
  not valid;

-- 3. Trigger de registro: valida el código según la carrera elegida y
--    restaura el tope de promoción por año para ESAN (se había perdido
--    al redefinir la función en "11 · Carrera por alumno").
--    El mensaje de error sigue sin revelar la regla (decisión deliberada).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  code text := upper(trim(coalesce(new.raw_user_meta_data->>'student_code', '')));
  carrera_meta text := new.raw_user_meta_data->>'carrera';
begin
  if carrera_meta = 'pucp-mecatronica' then
    -- Código PUCP: 8 dígitos, empieza en 20
    if code !~ '^20[0-9]{6}$' then
      raise exception 'invalid student code';
    end if;
  else
    -- Código ESAN (ia, industrial, marketing): 8 dígitos, promoción 25..año en curso
    if code !~ '^[0-9]{8}$'
       or left(code, 2)::int < 25
       or left(code, 2)::int > extract(year from now())::int % 100 then
      raise exception 'invalid student code';
    end if;
  end if;

  insert into public.profiles (id, student_code, email, carrera)
  values (
    new.id,
    code,
    new.email,
    case
      when carrera_meta in ('ia', 'industrial', 'marketing', 'pucp-mecatronica')
        then carrera_meta
      else null
    end
  );
  return new;
end;
$$;
