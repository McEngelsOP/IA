-- ============================================================
-- Sílabo IA · Tope de promoción según el año en curso
-- Los dos primeros dígitos del código van de 25 (primera
-- promoción) hasta el año actual: en 2026 se acepta 25–26,
-- en 2027 se aceptará 25–27 automáticamente, sin tocar nada.
--
-- Un CHECK no puede depender de la fecha, así que la regla vive
-- en el trigger handle_new_user (reemplaza al de 01 · Setup):
-- si el código excede el año en curso, el registro se rechaza.
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 08 · Tope promoción por año
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  code text := upper(trim(coalesce(new.raw_user_meta_data->>'student_code', '')));
begin
  if code !~ '^[0-9]{8}$'
     or left(code, 2)::int < 25
     or left(code, 2)::int > extract(year from now())::int % 100 then
    raise exception 'invalid student code';
  end if;

  insert into public.profiles (id, student_code, email)
  values (new.id, code, new.email);
  return new;
end;
$$;
