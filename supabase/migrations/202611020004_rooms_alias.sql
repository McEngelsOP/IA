begin;
alter table public.profiles add column if not exists alias_changed_at timestamptz;
create function public.enforce_alias_week() returns trigger language plpgsql set search_path='' as $$begin
 if auth.uid() is null then return new;end if;
 if new.alias_changed_at is distinct from old.alias_changed_at then raise exception 'ALIAS_TIMESTAMP_LOCKED';end if;
 if new.alias is distinct from old.alias then
 if new.alias is null or length(trim(new.alias)) not between 3 and 24 then raise exception 'INVALID_ALIAS';end if;
 if old.alias_changed_at>now()-interval '7 days' then raise exception 'ALIAS_WEEK_LIMIT';end if;new.alias:=trim(new.alias);new.alias_changed_at:=now();end if;return new;end$$;
create trigger alias_week before update on public.profiles for each row execute function public.enforce_alias_week();
create function public.change_profile_alias(p_alias text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$declare result jsonb;begin
 if auth.uid() is null then raise exception 'NO_AUTH';end if;
 update profiles set alias=p_alias where id=auth.uid() returning jsonb_build_object('alias',alias,'changed_at',alias_changed_at) into result;if result is null then raise exception 'PROFILE_REQUIRED';end if;return result;end$$;
revoke all on function public.change_profile_alias(text) from public,anon;
grant execute on function public.change_profile_alias(text) to authenticated;
alter table public.study_rooms add column institution_id text;
update public.study_rooms r set institution_id=p.institution_id from public.profiles p where p.id=r.owner_id;
alter table public.study_room_members add column member_key uuid not null default gen_random_uuid() unique;
alter table public.study_room_messages add column moderated boolean not null default false;
create table public.study_room_bans(room_id uuid references public.study_rooms(id) on delete cascade,student_id uuid references public.profiles(id) on delete cascade,primary key(room_id,student_id));
alter table public.study_room_bans enable row level security;
revoke all on public.study_room_bans from public,anon,authenticated;
create or replace function public.study_is_member(rid uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.study_room_members m join public.study_rooms r on r.id=m.room_id join public.profiles p on p.id=m.student_id where m.room_id=rid and m.student_id=auth.uid() and r.institution_id=p.institution_id and not exists(select 1 from public.study_room_bans b where b.room_id=rid and b.student_id=auth.uid()))$$;
create function public.scope_new_study_room() returns trigger language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or new.owner_id<>auth.uid() then raise exception 'NO_AUTH';end if;select institution_id into new.institution_id from public.profiles where id=new.owner_id;if new.institution_id is null then raise exception 'PROFILE_REQUIRED';end if;return new;end$$;
create trigger room_university before insert on public.study_rooms for each row execute function public.scope_new_study_room();
create function public.scope_study_member() returns trigger language plpgsql security definer set search_path='' as $$declare inst text;nick text;begin
 if auth.uid() is null or new.student_id<>auth.uid() then raise exception 'NO_AUTH';end if;
 select institution_id,alias into inst,nick from public.profiles where id=auth.uid() for update;
 if not exists(select 1 from public.study_rooms where id=new.room_id and institution_id=inst) or exists(select 1 from public.study_room_bans where room_id=new.room_id and student_id=new.student_id) then raise exception 'ROOM_UNAVAILABLE';end if;
 if nick is null then update public.profiles set alias=trim(new.nickname) where id=auth.uid() returning alias into nick;end if;new.nickname:=nick;return new;end$$;
create trigger member_university before insert on public.study_room_members for each row execute function public.scope_study_member();
create function public.sync_room_alias() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.alias is distinct from old.alias then update public.study_room_members set nickname=new.alias where student_id=new.id;update public.study_room_messages set nickname=new.alias where author_id=new.id and not moderated;end if;return new;end$$;
create trigger room_alias after update of alias on public.profiles for each row execute function public.sync_room_alias();
create function public.scope_study_message() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not public.study_is_member(new.room_id) or new.author_id<>auth.uid() then raise exception 'ROOM_UNAVAILABLE';end if;select nickname into new.nickname from public.study_room_members where room_id=new.room_id and student_id=new.author_id;return new;end$$;
create trigger message_university before insert on public.study_room_messages for each row execute function public.scope_study_message();
drop policy "Study rooms visible to authenticated" on public.study_rooms;
create policy "Study rooms visible to authenticated" on public.study_rooms for select to authenticated using(institution_id=(select institution_id from public.profiles where id=auth.uid()) and (not is_private or public.study_is_member(id)));
create or replace function public.list_study_rooms(course_ids text[], room_query text default '', room_scope text default 'all', page_offset integer default 0)
returns table(id uuid,course_id text,name text,description text,is_private boolean,created_at timestamptz,is_member boolean,is_owner boolean,member_count bigint)
language sql stable security definer set search_path = public as $$
 select r.id,r.course_id,r.name,r.description,r.is_private,r.created_at,
 public.study_is_member(r.id),r.owner_id=auth.uid(),(select count(*) from public.study_room_members m where m.room_id=r.id)
 from public.study_rooms r
 where r.institution_id=(select institution_id from public.profiles where id=auth.uid()) and auth.uid() is not null and r.course_id=any(course_ids)
 and (not r.is_private or public.study_is_member(r.id))
 and (nullif(trim(room_query),'') is null or position(lower(trim(room_query)) in lower(r.name||' '||r.description))>0)
 and (room_scope='all' or (room_scope='mine' and public.study_is_member(r.id)) or (room_scope='public' and not r.is_private))
 order by r.created_at desc,r.id desc limit 30 offset greatest(0,least(coalesce(page_offset,0),100000));
$$;

create or replace function public.study_room_info(rid uuid)
returns table(id uuid,course_id text,name text,description text,is_private boolean,is_owner boolean,member_count bigint,nickname text)
language sql stable security definer set search_path = public as $$
 select r.id,r.course_id,r.name,r.description,r.is_private,r.owner_id=auth.uid(),
 (select count(*) from public.study_room_members where room_id=r.id),m.nickname
 from public.study_rooms r join public.study_room_members m on m.room_id=r.id and m.student_id=auth.uid()
 where public.study_is_member(rid) and r.id=rid;
$$;

create function public.list_study_members(rid uuid) returns table(member_key uuid,nickname text,joined_at timestamptz,is_self boolean,is_owner boolean) language plpgsql stable security definer set search_path='' as $$begin
 if not public.study_is_member(rid) then raise exception 'ROOM_UNAVAILABLE';end if;
 return query select m.member_key,m.nickname,m.joined_at,m.student_id=auth.uid(),m.student_id=r.owner_id from public.study_room_members m join public.study_rooms r on r.id=m.room_id where m.room_id=rid order by m.joined_at;end$$;
create function public.kick_study_member(rid uuid,p_member uuid) returns void language plpgsql security definer set search_path='' as $$declare uid uuid;begin
 perform 1 from public.study_rooms where id=rid and owner_id=auth.uid() for update;if not found or not public.study_is_member(rid) then raise exception 'ROOM_UNAVAILABLE';end if;
 select student_id into uid from public.study_room_members where room_id=rid and member_key=p_member and student_id<>auth.uid();if uid is null then raise exception 'MEMBER_UNAVAILABLE';end if;
 insert into public.study_room_bans values(rid,uid) on conflict do nothing;delete from public.study_room_members where room_id=rid and student_id=uid;end$$;
create function public.moderate_study_messages(rid uuid,p_message uuid default null) returns void language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.study_rooms where id=rid and owner_id=auth.uid() for update;if not found or not public.study_is_member(rid) then raise exception 'ROOM_UNAVAILABLE';end if;
 update public.study_room_messages set body='Mensaje eliminado por moderación.',nickname='Moderación',moderated=true where room_id=rid and (p_message is null or id=p_message);end$$;
create function public.read_study_message_changes(rid uuid,p_ids uuid[]) returns table(id uuid,body text,nickname text,created_at timestamptz,is_mine boolean) language plpgsql stable security definer set search_path='' as $$begin
 if not public.study_is_member(rid) then raise exception 'ROOM_UNAVAILABLE';end if;if cardinality(p_ids)>1000 then raise exception 'TOO_MANY_MESSAGES';end if;
 return query select m.id,m.body,m.nickname,m.created_at,m.author_id=auth.uid() from public.study_room_messages m where room_id=rid and m.id=any(p_ids) and moderated;end$$;
revoke all on function public.list_study_members(uuid),public.kick_study_member(uuid,uuid),public.moderate_study_messages(uuid,uuid),public.read_study_message_changes(uuid,uuid[]) from public,anon;
grant execute on function public.list_study_members(uuid),public.kick_study_member(uuid,uuid),public.moderate_study_messages(uuid,uuid),public.read_study_message_changes(uuid,uuid[]) to authenticated;
-- Focus and initial setup support assigned external curricula without changing academic IDs.
do $$declare d text;begin
 select pg_get_functiondef('public.setup_valid_preferences(jsonb)'::regprocedure) into d;d:=replace(d,'between 1 and 10','between 1 and 20');execute d;
 if to_regprocedure('public.start_focus_session(uuid,text,integer,text,text,text)') is not null then
 select pg_get_functiondef('public.start_focus_session(uuid,text,integer,text,text,text)'::regprocedure) into d;d:=regexp_replace(d,'career_name is null or career_name not in \([^)]*\)','career_name is null');execute d;end if;
end$$;
commit;
notify pgrst,'reload schema';
