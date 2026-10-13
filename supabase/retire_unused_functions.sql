-- Retiro verificado en Lyra. No modifica perfiles, alias, correos ni otros registros.
-- Sin CASCADE: cualquier dependencia nueva bloquea toda la transacción.
-- Recuperación: history/unused_functions_restore.sql.
BEGIN;
DO $guard$
DECLARE target record; function_oid oid;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('public.lock_alias()', 'c29ec61577e941e0649e2843d57b4db8', 'lock_alias'),
    ('public.email_for_student_code(text)', 'f8df19f12082bfe81e59ca2fcda840e5', 'email_for_student_code')
  ) AS expected(signature, definition_hash, function_name)
  LOOP
    function_oid := to_regprocedure(target.signature);
    IF function_oid IS NULL THEN CONTINUE; END IF;
    IF md5(pg_get_functiondef(function_oid)) <> target.definition_hash THEN
      RAISE EXCEPTION 'La función % cambió desde la revisión; revisar antes de retirar', target.signature;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_depend WHERE refclassid='pg_proc'::regclass AND refobjid=function_oid)
       OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgfoid=function_oid)
       OR EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname IN ('public','app_private') AND p.prokind='f'
           AND p.oid<>function_oid AND position(target.function_name IN p.prosrc)>0
       ) THEN
      RAISE EXCEPTION 'La función % todavía tiene dependencias', target.signature;
    END IF;
    IF has_function_privilege('anon',function_oid,'EXECUTE')
       OR has_function_privilege('authenticated',function_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'La función % todavía está publicada para alumnos', target.signature;
    END IF;
  END LOOP;
END;
$guard$;
DROP FUNCTION IF EXISTS public.lock_alias() RESTRICT;
DROP FUNCTION IF EXISTS public.email_for_student_code(text) RESTRICT;
NOTIFY pgrst, 'reload schema';
COMMIT;

