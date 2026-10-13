-- Recursos - Rutinas consolidadas de mantenimiento, Lyra, 13-10-2026 UTC.
-- Base YA instalada: no crea tablas, no migra datos ni sustituye políticas RLS.
-- Conserva nombres RPC, valores por defecto, search_path y permisos vigentes.
-- Las funciones de app_private se mantienen separadas de sus entradas públicas.
-- Revisar esta instantánea antes de aplicarla tras futuras migraciones.
BEGIN;
DO $requirements$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['profiles','tools','tool_likes','tool_comments'] LOOP
    IF to_regclass('public.'||table_name) IS NULL THEN
      RAISE EXCEPTION 'Falta public.%; usar el procedimiento de instalación, no mantenimiento',table_name;
    END IF;
  END LOOP;
END;
$requirements$;

CREATE OR REPLACE FUNCTION app_private.canonical_resource_url(value text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare raw text:=btrim(value); authority text; path text; query_part text; query_key text;
begin
  if raw is null or char_length(raw)>2048 or raw !~* '^https?://[^/\s?#]+' or raw ~ '[[:space:][:cntrl:]]' then raise exception 'INVALID_RESOURCE_URL'; end if;
  raw:=regexp_replace(regexp_replace(raw,'#.*$',''),'^https?://','https://','i');
  authority:=lower(substring(raw from '^https?://([^/?#]+)'));
  if authority is null or authority ~ '@' or authority !~ '^[a-z0-9.-]+(:[0-9]{1,5})?$' then raise exception 'INVALID_RESOURCE_URL'; end if;
  authority:=regexp_replace(regexp_replace(authority,'^www\.',''),':(80|443)$','');
  path:=regexp_replace(raw,'^https?://[^/?#]+','');
  if strpos(path,'?')>0 then query_part:=substring(path from strpos(path,'?')+1); path:=split_part(path,'?',1); end if;
  path:=regexp_replace(path,'/+$','');
  select string_agg(q,'&' order by q) into query_key from regexp_split_to_table(coalesce(query_part,''),'&') q where q<>'' and q !~* '^(utm_[^=]*|fbclid|gclid)=';
  return authority||path||case when query_key is not null then '?'||query_key else '' end;
end $function$;
REVOKE ALL ON FUNCTION app_private.canonical_resource_url(value text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.canonical_resource_url(value text) TO "postgres";
GRANT EXECUTE ON FUNCTION app_private.canonical_resource_url(value text) TO "authenticated";

CREATE OR REPLACE FUNCTION app_private.check_resource_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if cardinality(regexp_split_to_array(btrim(new.body),'\s+'))>25 then raise exception 'RESOURCE_DESCRIPTION'; end if;
  return new;
end $function$;
REVOKE ALL ON FUNCTION app_private.check_resource_comment() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.check_resource_comment() TO "postgres";

CREATE OR REPLACE FUNCTION app_private.edit_resource_description(resource_id uuid, resource_description text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); clean_description text:=btrim(coalesce(resource_description,''));
begin
  if uid is null then raise exception 'NO_AUTH'; end if;
  if char_length(clean_description)>500 or (clean_description<>'' and cardinality(regexp_split_to_array(clean_description,'\s+'))>25) then raise exception 'RESOURCE_DESCRIPTION'; end if;
  update public.tools set description=clean_description where id=resource_id and created_by=uid;
  if not found then raise exception 'RESOURCE_NOT_OWNED'; end if;
end $function$;
REVOKE ALL ON FUNCTION app_private.edit_resource_description(resource_id uuid, resource_description text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.edit_resource_description(resource_id uuid, resource_description text) TO "postgres";
GRANT EXECUTE ON FUNCTION app_private.edit_resource_description(resource_id uuid, resource_description text) TO "authenticated";

CREATE OR REPLACE FUNCTION app_private.publish_resource(resource_name text, resource_url text, resource_description text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); result uuid; description text:=btrim(coalesce(resource_description,''));
begin
  if uid is null then raise exception 'NO_AUTH'; end if;
  perform 1 from public.profiles where id=uid for update;
  if not found then raise exception 'NO_AUTH'; end if;
  if char_length(btrim(resource_name)) not between 2 and 60 then raise exception 'INVALID_RESOURCE_NAME'; end if;
  perform app_private.canonical_resource_url(resource_url);
  if char_length(description)>500 or (description<>'' and cardinality(regexp_split_to_array(description,'\s+'))>25) then raise exception 'RESOURCE_DESCRIPTION'; end if;
  if (select count(*) from public.tools where created_by=uid)>=20 then raise exception 'RESOURCE_LIMIT'; end if;
  begin
    insert into public.tools(name,url,created_by,description) values(btrim(resource_name),btrim(resource_url),uid,description) returning id into result;
  exception when unique_violation then raise exception 'RESOURCE_DUPLICATE'; end;
  return result;
end $function$;
REVOKE ALL ON FUNCTION app_private.publish_resource(resource_name text, resource_url text, resource_description text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.publish_resource(resource_name text, resource_url text, resource_description text) TO "postgres";
GRANT EXECUTE ON FUNCTION app_private.publish_resource(resource_name text, resource_url text, resource_description text) TO "authenticated";

CREATE OR REPLACE FUNCTION app_private.resource_page(search_text text DEFAULT ''::text, sort_order text DEFAULT 'recent'::text, page_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); items jsonb; total integer;
begin
  if uid is null then raise exception 'NO_AUTH'; end if;
  if page_offset<0 or char_length(search_text)>200 or sort_order not in ('recent','name','hearts') then raise exception 'INVALID_RESOURCE_QUERY'; end if;
  select count(*) into total from public.tools t where strpos(lower(t.name||' '||t.url),lower(btrim(search_text)))>0;
  select coalesce(jsonb_agg(to_jsonb(p)-'created_at'), '[]'::jsonb) into items from (
    select t.id,t.name,t.url,t.created_at,t.description,t.created_by=uid is_owner,
      (select count(*) from public.tool_likes l where l.tool_id=t.id) hearts,
      exists(select 1 from public.tool_likes l where l.tool_id=t.id and l.student_id=uid) liked
    from public.tools t where strpos(lower(t.name||' '||t.url),lower(btrim(search_text)))>0
    order by case when sort_order='name' then lower(t.name) end,case when sort_order='hearts' then (select count(*) from public.tool_likes l where l.tool_id=t.id) end desc,t.created_at desc,t.id
    limit 50 offset page_offset
  ) p;
  return jsonb_build_object('items',items,'total',total);
end $function$;
REVOKE ALL ON FUNCTION app_private.resource_page(search_text text, sort_order text, page_offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.resource_page(search_text text, sort_order text, page_offset integer) TO "postgres";
GRANT EXECUTE ON FUNCTION app_private.resource_page(search_text text, sort_order text, page_offset integer) TO "authenticated";

CREATE OR REPLACE FUNCTION app_private.toggle_resource_heart(resource_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); removed integer; liked boolean;
begin
  if uid is null then raise exception 'NO_AUTH'; end if;
  perform 1 from public.tools where id=resource_id for update;
  if not found then raise exception 'RESOURCE_UNAVAILABLE'; end if;
  delete from public.tool_likes where tool_id=resource_id and student_id=uid;
  get diagnostics removed=row_count;
  liked:=removed=0;
  if liked then insert into public.tool_likes(tool_id,student_id) values(resource_id,uid); end if;
  return jsonb_build_object('liked',liked,'hearts',(select count(*) from public.tool_likes where tool_id=resource_id));
end $function$;
REVOKE ALL ON FUNCTION app_private.toggle_resource_heart(resource_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.toggle_resource_heart(resource_id uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION app_private.toggle_resource_heart(resource_id uuid) TO "authenticated";

CREATE OR REPLACE FUNCTION public.edit_resource_description(resource_id uuid, resource_description text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.edit_resource_description(resource_id,resource_description) $function$;
REVOKE ALL ON FUNCTION public.edit_resource_description(resource_id uuid, resource_description text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.edit_resource_description(resource_id uuid, resource_description text) TO "postgres";
GRANT EXECUTE ON FUNCTION public.edit_resource_description(resource_id uuid, resource_description text) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.edit_resource_description(resource_id uuid, resource_description text) TO "service_role";

CREATE OR REPLACE FUNCTION public.my_tool_comment_count(tid uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int
  from public.tool_comments
  where tool_id = tid
    and author_id = auth.uid();
$function$;
REVOKE ALL ON FUNCTION public.my_tool_comment_count(tid uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_tool_comment_count(tid uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION public.my_tool_comment_count(tid uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.my_tool_comment_count(tid uuid) TO "service_role";

CREATE OR REPLACE FUNCTION public.publish_resource(resource_name text, resource_url text, resource_description text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.publish_resource(resource_name,resource_url,resource_description) $function$;
REVOKE ALL ON FUNCTION public.publish_resource(resource_name text, resource_url text, resource_description text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_resource(resource_name text, resource_url text, resource_description text) TO "postgres";
GRANT EXECUTE ON FUNCTION public.publish_resource(resource_name text, resource_url text, resource_description text) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.publish_resource(resource_name text, resource_url text, resource_description text) TO "service_role";

CREATE OR REPLACE FUNCTION public.resource_page(search_text text DEFAULT ''::text, sort_order text DEFAULT 'recent'::text, page_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select app_private.resource_page(search_text,sort_order,page_offset) $function$;
REVOKE ALL ON FUNCTION public.resource_page(search_text text, sort_order text, page_offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resource_page(search_text text, sort_order text, page_offset integer) TO "postgres";
GRANT EXECUTE ON FUNCTION public.resource_page(search_text text, sort_order text, page_offset integer) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.resource_page(search_text text, sort_order text, page_offset integer) TO "service_role";

CREATE OR REPLACE FUNCTION public.stamp_comment_alias()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  select alias into new.alias from public.profiles where id = new.author_id;
  if new.alias is null then
    raise exception 'Elige tu nombre secreto antes de comentar';
  end if;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.stamp_comment_alias() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stamp_comment_alias() TO "postgres";
GRANT EXECUTE ON FUNCTION public.stamp_comment_alias() TO "service_role";

CREATE OR REPLACE FUNCTION public.toggle_resource_heart(resource_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.toggle_resource_heart(resource_id) $function$;
REVOKE ALL ON FUNCTION public.toggle_resource_heart(resource_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_resource_heart(resource_id uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION public.toggle_resource_heart(resource_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.toggle_resource_heart(resource_id uuid) TO "service_role";

NOTIFY pgrst, 'reload schema';
COMMIT;

