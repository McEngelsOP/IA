-- ============================================================
-- Sílabo IA · Higiene de funciones (avisos del Security Advisor)
-- Las funciones de trigger no se pueden invocar directamente,
-- pero Postgres igual les da permiso EXECUTE a todos por defecto
-- y el linter lo marca. Aquí se lo quitamos explícitamente.
-- No afecta a los triggers: siguen disparándose normal.
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 10 · Higiene de funciones
-- ============================================================

-- Para ver qué hace rls_auto_enable (no vino de nuestros archivos;
-- seguramente de un template del SQL Editor):
--
--   select prosrc from pg_proc where proname = 'rls_auto_enable';

revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
