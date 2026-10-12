-- Deberes: preserve academic data; protect authority; community resources.
-- Run as one migration on the shared project, before deploying Oficial.

revoke insert, update, delete, truncate, references, trigger on public.profiles from public, anon, authenticated;
do $$ declare col record; begin
  for col in select column_name from information_schema.columns where table_schema='public' and table_name='profiles' loop
    execute format('revoke insert (%I), update (%I) on public.profiles from public, anon, authenticated',col.column_name,col.column_name);
  end loop;
end $$;
grant update(full_name,alias,carrera) on public.profiles to authenticated;
alter policy "Users can update own profile" on public.profiles to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
alter policy "Users can view own profile" on public.profiles to authenticated using ((select auth.uid())=id);
alter function public.check_study_chat_profanity(text) set search_path='';
alter policy "Students update own difficulty vote" on public.course_difficulty_votes to authenticated using ((select auth.uid())=student_id) with check ((select auth.uid())=student_id);
alter policy "Students update own course status" on public.course_status to authenticated using ((select auth.uid())=student_id) with check ((select auth.uid())=student_id);

create schema if not exists app_private;
revoke all on schema app_private from public,anon;
grant usage on schema app_private to authenticated;

create or replace function app_private.canonical_resource_url(value text)
returns text language plpgsql immutable set search_path='' as $$
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
end $$;
revoke all on function app_private.canonical_resource_url(text) from public,anon;
grant execute on function app_private.canonical_resource_url(text) to authenticated;
alter table public.tools add column if not exists description text not null default '';
alter table public.tools add constraint tools_description_words check (char_length(description)<=500 and (btrim(description)='' or cardinality(regexp_split_to_array(btrim(description),'\s+'))<=25));
create unique index if not exists tools_canonical_url_unique on public.tools(app_private.canonical_resource_url(url));

-- New comments obey ownership and the 25-word limit. Existing historical
-- comments are retained; the directory shows only the author's description.
alter policy "Students insert own tool comments" on public.tool_comments to authenticated with check ((select auth.uid())=author_id and exists(select 1 from public.tools t where t.id=tool_id and t.created_by=(select auth.uid())) and public.my_tool_comment_count(tool_id)<5);
create or replace function app_private.check_resource_comment() returns trigger language plpgsql set search_path='' as $$
begin
  if cardinality(regexp_split_to_array(btrim(new.body),'\s+'))>25 then raise exception 'RESOURCE_DESCRIPTION'; end if;
  return new;
end $$;
revoke all on function app_private.check_resource_comment() from public,anon,authenticated;
create trigger tool_comment_word_limit before insert or update on public.tool_comments for each row execute function app_private.check_resource_comment();

create or replace function app_private.publish_resource(resource_name text,resource_url text,resource_description text default '') returns uuid language plpgsql security definer set search_path='' as $$
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
end $$;
create or replace function app_private.edit_resource_description(resource_id uuid,resource_description text) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); clean_description text:=btrim(coalesce(resource_description,''));
begin
  if uid is null then raise exception 'NO_AUTH'; end if;
  if char_length(clean_description)>500 or (clean_description<>'' and cardinality(regexp_split_to_array(clean_description,'\s+'))>25) then raise exception 'RESOURCE_DESCRIPTION'; end if;
  update public.tools set description=clean_description where id=resource_id and created_by=uid;
  if not found then raise exception 'RESOURCE_NOT_OWNED'; end if;
end $$;
create or replace function app_private.toggle_resource_heart(resource_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;
create or replace function app_private.resource_page(search_text text default '',sort_order text default 'recent',page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
end $$;
-- Thin exposed wrappers invoke checked private implementations. No IDs of
-- authors or voters are returned by these community endpoints.
create or replace function public.publish_resource(resource_name text,resource_url text,resource_description text default '') returns uuid language sql security invoker set search_path='' as $$ select app_private.publish_resource(resource_name,resource_url,resource_description) $$;
create or replace function public.edit_resource_description(resource_id uuid,resource_description text) returns void language sql security invoker set search_path='' as $$ select app_private.edit_resource_description(resource_id,resource_description) $$;
create or replace function public.toggle_resource_heart(resource_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select app_private.toggle_resource_heart(resource_id) $$;
create or replace function public.resource_page(search_text text default '',sort_order text default 'recent',page_offset integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.resource_page(search_text,sort_order,page_offset) $$;
revoke all on function app_private.publish_resource(text,text,text),app_private.edit_resource_description(uuid,text),app_private.toggle_resource_heart(uuid),app_private.resource_page(text,text,integer),public.publish_resource(text,text,text),public.edit_resource_description(uuid,text),public.toggle_resource_heart(uuid),public.resource_page(text,text,integer) from public,anon;
grant execute on function app_private.publish_resource(text,text,text),app_private.edit_resource_description(uuid,text),app_private.toggle_resource_heart(uuid),app_private.resource_page(text,text,integer),public.publish_resource(text,text,text),public.edit_resource_description(uuid,text),public.toggle_resource_heart(uuid),public.resource_page(text,text,integer) to authenticated;

alter table public.professor_tags drop constraint professor_tags_tag_check;
alter table public.professor_tags add constraint professor_tags_tag_check check(tag in ('estricto-bueno','estricto-mal','pasa','aprender','relajo','balance','fija','didactico','evaluaciones-claras'));
create or replace function app_private.limit_professor_tags() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and auth.uid()<>new.student_id then raise exception 'NO_AUTH'; end if;
  perform 1 from public.professors where id=new.professor_id for update;
  if not exists(select 1 from public.professor_tags t where t.professor_id=new.professor_id and t.student_id=new.student_id and t.tag=new.tag)
     and (select count(*) from public.professor_tags t where t.professor_id=new.professor_id and t.student_id=new.student_id)>=3 then raise exception 'TAG_LIMIT'; end if;
  return new;
end $$;
revoke all on function app_private.limit_professor_tags() from public,anon,authenticated;
create trigger professor_tag_limit before insert on public.professor_tags for each row execute function app_private.limit_professor_tags();

-- Keep the legacy room RPC compatible while making the raw sender private.
alter function public.send_study_message(uuid,text,uuid) set schema app_private;
revoke all on function app_private.send_study_message(uuid,text,uuid) from public,anon,authenticated;

-- Moderation returns denials, rather than raising after an audit write, so
-- strikes/suspensions survive the transaction. Membership is checked first.
create or replace function app_private.send_moderated_study_message(rid uuid,message_body text,request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); blocked timestamptz; cid text; moderation jsonb; severity integer; strikes integer; words text[]; sent jsonb;
begin
  if uid is null then raise exception 'NO_AUTH'; end if;
  select p.chat_blocked_until into blocked from public.profiles p where p.id=uid for update;
  if not found then raise exception 'PROFILE_REQUIRED'; end if;
  perform 1 from public.study_rooms r where r.id=rid for update;
  if not exists(select 1 from public.study_room_members m where m.room_id=rid and m.student_id=uid) then raise exception 'ROOM_UNAVAILABLE'; end if;
  if message_body is null or char_length(btrim(message_body)) not between 1 and 1200 or request_id is null then raise exception 'INVALID_MESSAGE'; end if;
  if blocked>now() then return jsonb_build_object('allowed',false,'error','CHAT_SUSPENDED','blocked_until',blocked); end if;
  if exists(select 1 from public.study_room_messages m where m.id=request_id and m.author_id=uid and m.room_id=rid and m.body=btrim(message_body)) then
    select jsonb_agg(to_jsonb(m)) into sent from app_private.send_study_message(rid,message_body,request_id) m;
    return jsonb_build_object('allowed',true,'messages',sent);
  end if;
  if (select count(*) from public.study_room_messages m where m.author_id=uid and m.created_at>now()-interval '1 minute')>=10 then raise exception 'MESSAGE_LIMIT'; end if;
  moderation:=public.check_study_chat_profanity(message_body);
  if (moderation->>'is_profane')::boolean then
    severity:=(moderation->>'severity')::integer;
    select array_agg(value) into words from jsonb_array_elements_text(moderation->'matches');
    select r.course_id into cid from public.study_rooms r where r.id=rid;
    insert into public.chat_moderation_logs(user_id,course_id,bad_words,severity) values(uid,cid,coalesce(words,'{}'),severity);
    select count(*) into strikes from public.chat_moderation_logs l where l.user_id=uid and l.created_at>=now()-interval '48 hours';
    if strikes>=3 or severity>=3 then
      blocked:=now()+interval '3 days'; update public.profiles set chat_blocked_until=blocked where id=uid;
      return jsonb_build_object('allowed',false,'error','CHAT_SUSPENDED','blocked_until',blocked,'strikes',strikes);
    end if;
    return jsonb_build_object('allowed',false,'error','PROFANITY_DETECTED','strikes',strikes);
  end if;
  select jsonb_agg(to_jsonb(m)) into sent from app_private.send_study_message(rid,message_body,request_id) m;
  return jsonb_build_object('allowed',true,'messages',sent);
end $$;
create or replace function public.send_moderated_study_message(rid uuid,message_body text,request_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select app_private.send_moderated_study_message(rid,message_body,request_id) $$;
create or replace function public.send_study_message(rid uuid,message_body text,request_id uuid default gen_random_uuid())
returns table(id uuid,body text,nickname text,created_at timestamptz,is_mine boolean)
language plpgsql security invoker set search_path='' as $$
declare response jsonb;
begin
  response:=app_private.send_moderated_study_message(rid,message_body,request_id);
  if not coalesce((response->>'allowed')::boolean,false) then return; end if;
  return query select (m->>'id')::uuid,m->>'body',m->>'nickname',(m->>'created_at')::timestamptz,(m->>'is_mine')::boolean from jsonb_array_elements(response->'messages') m;
end $$;
revoke all on function public.send_study_message(uuid,text,uuid) from public,anon;
grant execute on function public.send_study_message(uuid,text,uuid) to authenticated;
revoke all on function app_private.send_moderated_study_message(uuid,text,uuid),public.send_moderated_study_message(uuid,text,uuid) from public,anon;
grant execute on function app_private.send_moderated_study_message(uuid,text,uuid),public.send_moderated_study_message(uuid,text,uuid) to authenticated;

-- Cache auth lookups per statement while preserving existing policy logic.
do $$ declare p record; u text; c text; begin
  for p in select * from pg_policies where schemaname='public' and (qual like '%auth.uid()%' or with_check like '%auth.uid()%') loop
    u:=replace(p.qual,'auth.uid()','(select auth.uid())'); c:=replace(p.with_check,'auth.uid()','(select auth.uid())');
    -- Avoid wrapping policies which already contain cached auth lookups.
    if p.qual like '%SELECT auth.uid()%' then u:=p.qual; end if;
    if p.with_check like '%SELECT auth.uid()%' then c:=p.with_check; end if;
    execute format('alter policy %I on public.%I%s%s',p.policyname,p.tablename,case when u is not null then ' using ('||u||')' else '' end,case when c is not null then ' with check ('||c||')' else '' end);
  end loop;
end $$;

revoke execute on function public.advisor_check_moderation(boolean,integer,text[]),public.get_course_difficulty_stats(text),public.send_study_message(text,text) from public,anon;
grant execute on function public.advisor_check_moderation(boolean,integer,text[]),public.get_course_difficulty_stats(text),public.send_study_message(text,text) to authenticated;
create index if not exists course_comments_author on public.course_comments(author_id);
create index if not exists difficulty_votes_student on public.course_difficulty_votes(student_id);
create index if not exists professor_tags_student on public.professor_tags(student_id);
create index if not exists professor_votes_student on public.professor_votes(student_id);
create index if not exists professors_creator_course on public.professors(created_by,course_id);
create index if not exists study_messages_author on public.study_messages(author_id);
create index if not exists tool_comments_author on public.tool_comments(author_id);
create index if not exists tool_comments_tool on public.tool_comments(tool_id);
create index if not exists tool_likes_student on public.tool_likes(student_id);
create index if not exists tools_creator on public.tools(created_by);
