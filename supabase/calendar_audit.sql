-- Revisión administrativa de solo lectura; no muestra registros ni identificadores de alumnos.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name in ('calendar_events','calendar_tasks')
order by table_name, ordinal_position;
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('calendar_events','calendar_tasks');
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname='public' and tablename in ('calendar_events','calendar_tasks')
order by tablename, policyname;
select table_name, grantee, privilege_type
from information_schema.table_privileges
where table_schema='public' and table_name in ('calendar_events','calendar_tasks') and grantee in ('anon','authenticated','PUBLIC')
order by table_name, grantee, privilege_type;
select conrelid::regclass as table_name, conname, convalidated
from pg_constraint where conrelid in (to_regclass('public.calendar_events'),to_regclass('public.calendar_tasks'));
select to_regprocedure('public.email_for_student_code(text)') as obsolete_email_rpc;
