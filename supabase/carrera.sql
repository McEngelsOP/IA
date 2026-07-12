-- ============================================================
-- Sílabo IA · Carrera por alumno (IA / Industrial y Comercial)
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 11 · Carrera por alumno
--
-- IMPORTANTE: correr este script ANTES de desplegar el frontend
-- con selección de carrera; la app lee profiles.carrera al entrar.
-- ============================================================

-- 1. Columna en profiles. Queda NULL en las cuentas existentes:
--    la app les pedirá elegir carrera una sola vez al entrar.
alter table public.profiles
  add column carrera text
  check (carrera in ('ia', 'industrial'));

-- 2. El trigger de registro guarda la carrera que llega en los
--    metadatos del signUp. Si llega inválida o vacía queda NULL
--    y la app la pide al entrar (mismo camino que las cuentas viejas).
--    create or replace conserva el revoke de "10 · Higiene de funciones".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, student_code, email, carrera)
  values (
    new.id,
    upper(trim(coalesce(new.raw_user_meta_data->>'student_code', ''))),
    new.email,
    case
      when new.raw_user_meta_data->>'carrera' in ('ia', 'industrial')
        then new.raw_user_meta_data->>'carrera'
      else null
    end
  );
  return new;
end;
$$;

-- 3. Candado: una vez elegida, la carrera no se cambia desde la app
--    (con sesión, auth.uid() no es NULL y el cambio se rechaza).
--    El dueño del proyecto sí puede corregirla desde el Table Editor
--    o el SQL Editor, donde auth.uid() es NULL.
create or replace function public.lock_carrera()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null
     and old.carrera is not null
     and new.carrera is distinct from old.carrera then
    raise exception 'La carrera no se puede cambiar desde la app';
  end if;
  return new;
end;
$$;

revoke execute on function public.lock_carrera()
  from public, anon, authenticated;

create trigger profiles_lock_carrera
before update on public.profiles
for each row execute procedure public.lock_carrera();
