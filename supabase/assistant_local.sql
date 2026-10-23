-- Local-only assistant: no chat, summaries or extracted memories are stored here.
-- Run after sync_features.sql and text_tasks_semester.sql.
begin;
create table if not exists public.assistant_operations (
  student_id uuid not null references public.profiles(id) on delete cascade,
  operation_id uuid not null,
  payload_hash text not null,
  record_id text not null,
  kind text not null check(kind in ('task','event')),
  created_at timestamptz not null default now(),
  primary key(student_id,operation_id)
);
alter table public.assistant_operations enable row level security;
revoke all on public.assistant_operations from public,anon,authenticated;
grant select,insert on public.assistant_operations to authenticated;
drop policy if exists assistant_operations_read on public.assistant_operations;
drop policy if exists assistant_operations_insert on public.assistant_operations;
create policy assistant_operations_read on public.assistant_operations for select to authenticated using((select auth.uid())=student_id);
create policy assistant_operations_insert on public.assistant_operations for insert to authenticated with check((select auth.uid())=student_id);

create or replace function public.assistant_save_draft(p_operation uuid,p_draft jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  uid uuid:=auth.uid(); draft_title text:=btrim(p_draft->>'title');
  draft_date text:=p_draft->>'date'; kind text:=p_draft->>'kind';
  start_at text:=coalesce(p_draft->>'start_time',''); end_at text:=coalesce(p_draft->>'end_time','');
  fingerprint text; previous public.assistant_operations;
begin
  if uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_operation is null or p_draft is null or jsonb_typeof(p_draft)<>'object'
    or (select count(*) from jsonb_object_keys(p_draft))<>5
    or not(p_draft ?& array['kind','title','date','start_time','end_time'])
    or kind is null or kind not in ('task','event')
    or draft_title is null or char_length(draft_title) not between 1 and 160
    or not coalesce(public.valid_calendar_date(draft_date),false)
    or (kind='task' and (start_at<>'' or end_at<>''))
    or ((start_at<>'' or end_at<>'') and
      (start_at!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or end_at!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or end_at<=start_at))
  then raise exception 'INVALID_DRAFT'; end if;
  -- Serializes retries for this owner; both the record and receipt commit atomically.
  perform 1 from public.profiles where id=uid for update;
  if not found then raise exception 'PROFILE_REQUIRED'; end if;
  fingerprint:=md5(p_draft::text);
  select * into previous from public.assistant_operations where student_id=uid and operation_id=p_operation;
  if found then
    if previous.payload_hash<>fingerprint then raise exception 'OPERATION_CONFLICT'; end if;
    return jsonb_build_object('id',previous.record_id,'kind',previous.kind,'replayed',true);
  end if;
  if (select count(*) from public.assistant_operations where student_id=uid and created_at>now()-interval '1 minute')>=10 then raise exception 'SAVE_LIMIT'; end if;
  if kind='task' then
    insert into public.calendar_tasks(id,student_id,title,due_date) values(p_operation,uid,draft_title,draft_date::date);
  else
    insert into public.calendar_events(id,student_id,title,date,event_type,start_time,end_time)
    values(p_operation::text,uid,draft_title,draft_date,'personal',nullif(start_at,'')::time,nullif(end_at,'')::time);
  end if;
  insert into public.assistant_operations(student_id,operation_id,payload_hash,record_id,kind)
  values(uid,p_operation,fingerprint,p_operation::text,kind);
  return jsonb_build_object('id',p_operation::text,'kind',kind,'replayed',false);
end;
$$;
revoke all on function public.assistant_save_draft(uuid,jsonb) from public,anon;
grant execute on function public.assistant_save_draft(uuid,jsonb) to authenticated;

-- Old browser builds cannot continue uploading chat content.
do $$ begin
 if to_regclass('public.advisor_conversations') is not null then
  execute 'revoke insert,update,delete on public.advisor_conversations from public,anon,authenticated,service_role';
 end if;
end $$;

-- Disable legacy chat entry points, preserving any pre-existing records for deliberate cleanup.
do $$ declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='advisor_append_reply'
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature); end loop;
end $$;
commit;
notify pgrst,'reload schema';
