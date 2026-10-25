-- ============================================================
-- Sílabo IA · Funciones y Permisos para el Panel de Administrador
--
-- 1) Columna is_admin en profiles.
-- 2) Actualización de trigger lock_carrera para permitir cambios al admin.
-- 3) Funciones RPC con comprobación de administrador (is_admin = true).
--
-- Nombre sugerido de la query: 21 · Panel de Administrador
-- ============================================================

-- 1. Agregar columna is_admin a profiles si no existe
alter table public.profiles
  add column if not exists is_admin boolean default false;

-- 2. Función helper para saber si el usuario actual es admin
create or replace function public.is_app_admin()
returns boolean
language sql
security definer set search_path = ''
stable
as '
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_admin is true
  );
';

grant execute on function public.is_app_admin() to authenticated;

-- 3. Permitir que los administradores puedan omitir los candado lock_carrera
create or replace function public.lock_carrera()
returns trigger
language plpgsql
security definer set search_path = public
as '
begin
  if auth.uid() is not null
     and not public.is_app_admin()
     and old.carrera is not null
     and new.carrera is distinct from old.carrera then
    raise exception ''La carrera no se puede cambiar desde la app'';
  end if;
  return new;
end;
';

-- El alias sigue siendo editable: no reinstalar el candado histórico lock_alias.

-- 4. RPC: Obtener lista de usuarios (solo admins)
create or replace function public.admin_get_users()
returns table (
  id uuid,
  student_code text,
  email text,
  carrera text,
  alias text,
  is_admin boolean,
  created_at timestamptz
)
language plpgsql
security definer set search_path = public
as '
begin
  if public.is_app_admin() is not true then
    raise exception ''Acceso denegado: Se requieren permisos de administrador'';
  end if;

  return query
  select p.id, p.student_code, p.email, p.carrera, p.alias, p.is_admin, p.created_at
  from public.profiles p
  order by p.created_at desc;
end;
';

grant execute on function public.admin_get_users() to authenticated;

-- 5. RPC: Cambiar carrera de un estudiante (solo admins)
create or replace function public.admin_update_user_carrera(target_id uuid, new_carrera text)
returns boolean
language plpgsql
security definer set search_path = public
as '
begin
  if public.is_app_admin() is not true then
    raise exception ''Acceso denegado'';
  end if;

  update public.profiles
  set carrera = new_carrera
  where id = target_id;

  return true;
end;
';

grant execute on function public.admin_update_user_carrera(uuid, text) to authenticated;

-- 6. RPC: Limpiar alias de un estudiante (solo admins)
create or replace function public.admin_clear_user_alias(target_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as '
begin
  if public.is_app_admin() is not true then
    raise exception ''Acceso denegado'';
  end if;

  update public.profiles
  set alias = null
  where id = target_id;

  return true;
end;
';

grant execute on function public.admin_clear_user_alias(uuid) to authenticated;

-- 7. RPC: Obtener todas las reseñas y comentarios con identidad (solo admins)
create or replace function public.admin_get_all_comments()
returns json
language plpgsql
security definer set search_path = public
as '
declare
  result json;
begin
  if public.is_app_admin() is not true then
    raise exception ''Acceso denegado'';
  end if;

  select json_build_object(
    ''course_comments'', (
      select coalesce(json_agg(row_to_json(c)), ''[]''::json)
      from (
        select cc.id, cc.course_id, cc.alias, cc.body, cc.created_at,
               p.student_code, p.email
        from public.course_comments cc
        join public.profiles p on p.id = cc.author_id
        order by cc.created_at desc
      ) c
    ),
    ''tool_comments'', (
      select coalesce(json_agg(row_to_json(t)), ''[]''::json)
      from (
        select tc.id, tc.tool_id, tc.alias, tc.body, tc.created_at,
               p.student_code, p.email, tls.name as tool_name
        from public.tool_comments tc
        join public.profiles p on p.id = tc.author_id
        left join public.tools tls on tls.id = tc.tool_id
        order by tc.created_at desc
      ) t
    )
  ) into result;

  return result;
end;
';

grant execute on function public.admin_get_all_comments() to authenticated;

-- 8. RPC: Eliminar comentario por ID y tipo (solo admins)
create or replace function public.admin_delete_comment(comment_id uuid, comment_type text)
returns boolean
language plpgsql
security definer set search_path = public
as '
begin
  if public.is_app_admin() is not true then
    raise exception ''Acceso denegado'';
  end if;

  if comment_type = ''course'' then
    delete from public.course_comments where id = comment_id;
  elsif comment_type = ''tool'' then
    delete from public.tool_comments where id = comment_id;
  else
    raise exception ''Tipo de comentario no válido'';
  end if;

  return true;
end;
';

grant execute on function public.admin_delete_comment(uuid, text) to authenticated;

-- 9. RPC: Obtener estadísticas generales (solo admins)
create or replace function public.admin_get_stats()
returns json
language plpgsql
security definer set search_path = public
as '
declare
  stats json;
begin
  if public.is_app_admin() is not true then
    raise exception ''Acceso denegado'';
  end if;

  select json_build_object(
    ''total_students'', (select count(*)::int from public.profiles),
    ''students_by_carrera'', (
      select coalesce(json_object_agg(coalesce(carrera, ''sin_elegir''), cnt), ''{}''::json)
      from (select carrera, count(*)::int as cnt from public.profiles group by carrera) s
    ),
    ''total_course_comments'', (select count(*)::int from public.course_comments),
    ''total_tool_comments'', (select count(*)::int from public.tool_comments),
    ''total_professors'', (select count(*)::int from public.professors),
    ''total_difficulty_votes'', (
      select count(*)::int from public.course_difficulty_votes
    )
  ) into stats;

  return stats;
end;
';

grant execute on function public.admin_get_stats() to authenticated;

-- No heredar el permiso EXECUTE predeterminado de PUBLIC.
revoke execute on function public.is_app_admin(), public.admin_get_users(),
  public.admin_update_user_carrera(uuid,text), public.admin_clear_user_alias(uuid),
  public.admin_get_all_comments(), public.admin_delete_comment(uuid,text),
  public.admin_get_stats() from public, anon;
