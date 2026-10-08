-- Retirar el RPC sustituido por auth-by-code. Ejecutar después de comprobar login y recuperación.
-- Sin CASCADE: si alguna dependencia desconocida sigue usándolo, PostgreSQL bloqueará la eliminación.
begin;
drop function if exists public.email_for_student_code(text);
commit;
