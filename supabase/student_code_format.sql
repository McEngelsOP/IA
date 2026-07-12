-- ============================================================
-- Sílabo IA · Formato del código de alumno
-- Exactamente 8 dígitos, empieza en 25 (año de la primera
-- promoción) o más. El resto del código queda libre.
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- ============================================================

-- NOT VALID: agrega la regla sin revisar las filas que ya existen
-- (las cuentas registradas antes de esta regla quedan tal cual).
-- Toda fila NUEVA o cualquier UPDATE a student_code sí se valida
-- contra la regla desde este momento en adelante.
alter table public.profiles
  add constraint profiles_student_code_format
  check (student_code ~ '^[0-9]{8}$' and left(student_code, 2)::int >= 25)
  not valid;

-- Opcional, más adelante: una vez que corrijas o borres las cuentas
-- viejas que no cumplen el formato, puedes "sellar" el candado para
-- que también cubra el historial:
--
--   alter table public.profiles validate constraint profiles_student_code_format;
--
-- Para ver cuáles son esas cuentas viejas en cualquier momento:
--
--   select id, email, student_code from public.profiles
--   where student_code !~ '^[0-9]{8}$' or left(student_code, 2)::int < 25;
