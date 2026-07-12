-- ============================================================
-- Sílabo IA · Nombres de profesor en mayúsculas
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- ============================================================

-- Antes de aplicar el CHECK, verifica que no haya nombres ya
-- guardados que no estén en mayúsculas:
--
--   select id, course_id, name from public.professors
--   where name <> upper(name);
--
-- Si esa consulta devuelve filas, corrígelas antes de correr el
-- ALTER TABLE de abajo, o fallará.

alter table public.professors
  add constraint professors_name_uppercase
  check (name = upper(name));
