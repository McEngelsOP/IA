-- Recuperación administrativa del estado anterior al retiro.
-- No reactiva el trigger profiles_lock_alias ni expone el correo a alumnos.
BEGIN;
CREATE OR REPLACE FUNCTION public.email_for_student_code(code text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select email from public.profiles where student_code = upper(trim(code));
$function$;
REVOKE ALL ON FUNCTION public.email_for_student_code(code text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.email_for_student_code(code text) TO "postgres";
GRANT EXECUTE ON FUNCTION public.email_for_student_code(code text) TO "service_role";

CREATE OR REPLACE FUNCTION public.lock_alias()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is not null
     and not public.is_app_admin()
     and old.alias is not null
     and new.alias is distinct from old.alias then
    raise exception 'El nombre secreto no se puede cambiar desde la app';
  end if;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.lock_alias() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_alias() TO "postgres";
GRANT EXECUTE ON FUNCTION public.lock_alias() TO "service_role";
NOTIFY pgrst, 'reload schema';
COMMIT;

