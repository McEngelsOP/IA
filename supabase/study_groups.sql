-- Salas, participantes y conversaciones reales. No crea salas ni usuarios de muestra.
-- Idempotente y transaccional. Aplicar antes de publicar el frontend de Grupos de estudio.
begin;
create table if not exists public.study_rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_id text not null check (course_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name text not null check (char_length(trim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 500),
  is_private boolean not null default false,
  invite_code text not null unique default replace(gen_random_uuid()::text,'-',''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.study_room_members (
  room_id uuid not null references public.study_rooms(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null check (char_length(trim(nickname)) between 2 and 40),
  joined_at timestamptz not null default now(),
  primary key(room_id,student_id)
);
create table if not exists public.study_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.study_rooms(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null,
  body text not null check (char_length(trim(body)) between 1 and 1200),
  created_at timestamptz not null default now()
);
create index if not exists study_rooms_course_created on public.study_rooms(course_id,created_at desc,id);
create index if not exists study_rooms_owner on public.study_rooms(owner_id);
create index if not exists study_members_student on public.study_room_members(student_id,room_id);
create index if not exists study_messages_room_created on public.study_messages(room_id,created_at desc,id desc);
create index if not exists study_messages_author_created on public.study_messages(author_id,created_at desc);

create or replace function public.study_is_member(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists(select 1 from public.study_room_members where room_id=rid and student_id=auth.uid());
$$;
alter table public.study_rooms enable row level security;
alter table public.study_room_members enable row level security;
alter table public.study_messages enable row level security;
drop policy if exists "Study rooms visible to authenticated" on public.study_rooms;
create policy "Study rooms visible to authenticated" on public.study_rooms for select to authenticated using (not is_private or public.study_is_member(id));
drop policy if exists "Study members visible to members" on public.study_room_members;
create policy "Study members visible to members" on public.study_room_members for select to authenticated using (public.study_is_member(room_id));
drop policy if exists "Study messages visible to members" on public.study_messages;
create policy "Study messages visible to members" on public.study_messages for select to authenticated using (public.study_is_member(room_id));
-- Mutaciones únicamente mediante funciones verificadas; tampoco se publican códigos ni UUID de autores.
revoke all on public.study_rooms,public.study_room_members,public.study_messages from public,anon,authenticated;
grant select(id,course_id,name,description,is_private,created_at,updated_at) on public.study_rooms to authenticated;
grant select(room_id,nickname,joined_at) on public.study_room_members to authenticated;
grant select(id,room_id,nickname,body,created_at) on public.study_messages to authenticated;
revoke all on function public.study_is_member(uuid) from public,anon;
grant execute on function public.study_is_member(uuid) to authenticated;

create or replace function public.list_study_rooms(course_ids text[], room_query text default '', room_scope text default 'all', page_offset integer default 0)
returns table(id uuid,course_id text,name text,description text,is_private boolean,created_at timestamptz,is_member boolean,is_owner boolean,member_count bigint)
language sql stable security definer set search_path = public as $$
 select r.id,r.course_id,r.name,r.description,r.is_private,r.created_at,
 public.study_is_member(r.id),r.owner_id=auth.uid(),(select count(*) from public.study_room_members m where m.room_id=r.id)
 from public.study_rooms r
 where auth.uid() is not null and r.course_id=any(course_ids)
 and (not r.is_private or public.study_is_member(r.id))
 and (nullif(trim(room_query),'') is null or position(lower(trim(room_query)) in lower(r.name||' '||r.description))>0)
 and (room_scope='all' or (room_scope='mine' and public.study_is_member(r.id)) or (room_scope='public' and not r.is_private))
 order by r.created_at desc,r.id desc limit 30 offset greatest(0,least(coalesce(page_offset,0),100000));
$$;

create or replace function public.create_study_room(cid text,room_name text,room_description text,private_room boolean,display_name text,request_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid:=auth.uid(); rid uuid;
begin
 if uid is null then raise exception 'NO_AUTH'; end if;
 -- Serializa el límite por propietario sin modificar su perfil.
 perform 1 from public.profiles p where p.id=uid for update;
 if not found then raise exception 'PROFILE_REQUIRED'; end if;
 if exists(select 1 from public.study_rooms where id=request_id and owner_id=uid) then return request_id; end if;
 if (select count(*) from public.study_rooms where owner_id=uid)>=5 then raise exception 'ROOM_LIMIT'; end if;
 if (select count(*) from public.study_room_members where student_id=uid)>=50 then raise exception 'MEMBERSHIP_LIMIT'; end if;
 if cid is null or cid !~ '^[a-z0-9][a-z0-9-]{0,79}$' or room_name is null or char_length(trim(room_name)) not between 2 and 80 or char_length(coalesce(room_description,''))>500 or display_name is null or char_length(trim(display_name)) not between 2 and 40 or private_room is null then raise exception 'INVALID_ROOM'; end if;
 insert into public.study_rooms(id,owner_id,course_id,name,description,is_private) values(request_id,uid,cid,trim(room_name),coalesce(room_description,''),private_room) returning id into rid;
 insert into public.study_room_members(room_id,student_id,nickname) values(rid,uid,trim(display_name));
 return rid;
end;
$$;

create or replace function public.join_study_room(rid uuid default null,access_code text default null,display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid:=auth.uid(); room public.study_rooms%rowtype; code text:=lower(regexp_replace(coalesce(access_code,''),'[\s-]','','g'));
begin
 if uid is null then raise exception 'NO_AUTH'; end if;
 if display_name is null or char_length(trim(display_name)) not between 2 and 40 then raise exception 'INVALID_NAME'; end if;
 perform 1 from public.profiles p where p.id=uid for update;
 if not found then raise exception 'PROFILE_REQUIRED'; end if;
 if code<>'' then
  select * into room from public.study_rooms where invite_code=code for update;
 else
  select * into room from public.study_rooms where id=rid and (not is_private or public.study_is_member(id)) for update;
 end if;
 if room.id is null then raise exception 'ROOM_UNAVAILABLE'; end if;
 if public.study_is_member(room.id) then return room.id; end if;
 if (select count(*) from public.study_room_members where room_id=room.id)>=100 then raise exception 'ROOM_FULL'; end if;
 if (select count(*) from public.study_room_members where student_id=uid)>=50 then raise exception 'MEMBERSHIP_LIMIT'; end if;
 insert into public.study_room_members(room_id,student_id,nickname) values(room.id,uid,trim(display_name));
 return room.id;
end;
$$;

create or replace function public.study_room_info(rid uuid)
returns table(id uuid,course_id text,name text,description text,is_private boolean,is_owner boolean,member_count bigint,nickname text)
language sql stable security definer set search_path = public as $$
 select r.id,r.course_id,r.name,r.description,r.is_private,r.owner_id=auth.uid(),
 (select count(*) from public.study_room_members where room_id=r.id),m.nickname
 from public.study_rooms r join public.study_room_members m on m.room_id=r.id and m.student_id=auth.uid()
 where auth.uid() is not null and r.id=rid;
$$;

create or replace function public.study_room_invite(rid uuid,rotate boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
 if auth.uid() is null then raise exception 'NO_AUTH'; end if;
 if rotate then
  update public.study_rooms set invite_code=replace(gen_random_uuid()::text,'-',''),updated_at=now() where id=rid and owner_id=auth.uid() returning invite_code into code;
 else
  select invite_code into code from public.study_rooms where id=rid and owner_id=auth.uid();
 end if;
 if code is null then raise exception 'ROOM_UNAVAILABLE'; end if;
 return code;
end;
$$;

create or replace function public.read_study_messages(rid uuid,before_time timestamptz default null,before_id uuid default null)
returns table(id uuid,body text,nickname text,created_at timestamptz,is_mine boolean)
language plpgsql stable security definer set search_path = public as $$
begin
 if not public.study_is_member(rid) then raise exception 'ROOM_UNAVAILABLE'; end if;
 return query select m.id,m.body,m.nickname,m.created_at,m.author_id=auth.uid() from public.study_messages m
 where m.room_id=rid and (before_time is null or (m.created_at,m.id)<(before_time,coalesce(before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 order by m.created_at desc,m.id desc limit 50;
end;
$$;

create or replace function public.send_study_message(rid uuid,message_body text,request_id uuid default gen_random_uuid())
returns table(id uuid,body text,nickname text,created_at timestamptz,is_mine boolean) language plpgsql security definer set search_path = public as $$
declare uid uuid:=auth.uid(); display text; mid uuid;
begin
 if uid is null then raise exception 'NO_AUTH'; end if;
 -- Bloqueo del perfil serializa el límite de mensajes en salas distintas.
 perform 1 from public.profiles p where p.id=uid for update;
 -- Un envío no puede competir con una salida/cierre de la sala.
 perform 1 from public.study_rooms r where r.id=rid for update;
 select m.nickname into display from public.study_room_members m where m.room_id=rid and m.student_id=uid;
 if display is null then raise exception 'ROOM_UNAVAILABLE'; end if;
 if message_body is null or char_length(trim(message_body)) not between 1 and 1200 then raise exception 'INVALID_MESSAGE'; end if;
 if exists(select 1 from public.study_messages m where m.id=request_id and m.author_id=uid and m.room_id=rid and m.body=trim(message_body)) then
  return query select m.id,m.body,m.nickname,m.created_at,true from public.study_messages m where m.id=request_id and m.author_id=uid and m.room_id=rid; return;
 end if;
 if (select count(*) from public.study_messages m where m.author_id=uid and m.created_at>now()-interval '1 minute')>=10 then raise exception 'MESSAGE_LIMIT'; end if;
 insert into public.study_messages(id,room_id,author_id,nickname,body) values(request_id,rid,uid,display,trim(message_body)) returning study_messages.id into mid;
 return query select m.id,m.body,m.nickname,m.created_at,true from public.study_messages m where m.id=mid;
end;
$$;

create or replace function public.leave_study_room(rid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
 if auth.uid() is null then raise exception 'NO_AUTH'; end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 perform 1 from public.study_rooms r where r.id=rid for update;
 if exists(select 1 from public.study_rooms where id=rid and owner_id=auth.uid()) then raise exception 'OWNER_CANNOT_LEAVE'; end if;
 if not public.study_is_member(rid) then raise exception 'ROOM_UNAVAILABLE'; end if;
 delete from public.study_room_members where room_id=rid and student_id=auth.uid();
end;
$$;

create or replace function public.close_study_room(rid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
 if auth.uid() is null then raise exception 'NO_AUTH'; end if;
 delete from public.study_rooms where id=rid and owner_id=auth.uid();
 if not found then raise exception 'ROOM_UNAVAILABLE'; end if;
end;
$$;

revoke all on function public.list_study_rooms(text[],text,text,integer),public.create_study_room(text,text,text,boolean,text,uuid),public.join_study_room(uuid,text,text),public.study_room_info(uuid),public.study_room_invite(uuid,boolean),public.read_study_messages(uuid,timestamptz,uuid),public.send_study_message(uuid,text,uuid),public.leave_study_room(uuid),public.close_study_room(uuid) from public,anon;
grant execute on function public.list_study_rooms(text[],text,text,integer),public.create_study_room(text,text,text,boolean,text,uuid),public.join_study_room(uuid,text,text),public.study_room_info(uuid),public.study_room_invite(uuid,boolean),public.read_study_messages(uuid,timestamptz,uuid),public.send_study_message(uuid,text,uuid),public.leave_study_room(uuid),public.close_study_room(uuid) to authenticated;
commit;
notify pgrst,'reload schema';
