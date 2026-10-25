-- Reject missing identities/profiles without changing academic records.
begin;
create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin is true);
$$;
-- Preserve deployed RPC bodies, changing only their reviewed authorization check.
do $$
declare fn record; definition text;
begin
  for fn in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('admin_get_users','admin_update_user_carrera',
      'admin_clear_user_alias','admin_get_all_comments','admin_delete_comment','admin_get_stats')
  loop
    definition:=pg_get_functiondef(fn.oid);
    if strpos(definition,'if not public.is_app_admin() then')>0 then
      execute replace(definition,'if not public.is_app_admin() then','if public.is_app_admin() is not true then');
    elsif strpos(definition,'if public.is_app_admin() is not true then')=0 then
      raise exception 'Unexpected admin authorization in %',fn.proname;
    end if;
  end loop;
end $$;
revoke execute on function public.is_app_admin(),public.admin_get_users(),
  public.admin_update_user_carrera(uuid,text),public.admin_clear_user_alias(uuid),
  public.admin_get_all_comments(),public.admin_delete_comment(uuid,text),public.admin_get_stats() from public,anon;
grant execute on function public.is_app_admin(),public.admin_get_users(),
  public.admin_update_user_carrera(uuid,text),public.admin_clear_user_alias(uuid),
  public.admin_get_all_comments(),public.admin_delete_comment(uuid,text),public.admin_get_stats() to authenticated;
commit;
