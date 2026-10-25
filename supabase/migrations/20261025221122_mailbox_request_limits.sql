-- Rate limit only: no message body or recipient is stored here.
begin;
create schema if not exists app_private;
revoke all on schema app_private from public,anon;
create table if not exists app_private.mailbox_limits (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null,
  last_sent_at timestamptz not null,
  attempts integer not null check(attempts between 1 and 5)
);
alter table app_private.mailbox_limits enable row level security;
revoke all on app_private.mailbox_limits from public,anon,authenticated;
create or replace function app_private.mailbox_take_quota()
returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); quota_now timestamptz:=clock_timestamp(); quota app_private.mailbox_limits%rowtype;
begin
  if uid is null then raise exception 'NO_AUTH'; end if;
  perform 1 from public.profiles where id=uid for update;
  if not found then raise exception 'PROFILE_REQUIRED'; end if;
  -- Bounded retention; the profile lock serializes requests from the same user.
  delete from app_private.mailbox_limits where window_start<quota_now-interval '1 day';
  select * into quota from app_private.mailbox_limits where student_id=uid;
  if found and (quota.last_sent_at>quota_now-interval '60 seconds'
     or (quota.window_start>quota_now-interval '1 hour' and quota.attempts>=5)) then return false; end if;
  insert into app_private.mailbox_limits(student_id,window_start,last_sent_at,attempts)
    values(uid,quota_now,quota_now,1)
  on conflict(student_id) do update set
    window_start=case when quota.window_start<=quota_now-interval '1 hour' then quota_now else quota.window_start end,
    last_sent_at=quota_now,
    attempts=case when quota.window_start<=quota_now-interval '1 hour' then 1 else quota.attempts+1 end;
  return true;
end $$;
create or replace function public.mailbox_take_quota()
returns boolean language sql security invoker set search_path='' as $$
  select app_private.mailbox_take_quota();
$$;
grant usage on schema app_private to authenticated;
revoke all on function app_private.mailbox_take_quota(),public.mailbox_take_quota() from public,anon;
grant execute on function app_private.mailbox_take_quota(),public.mailbox_take_quota() to authenticated;
commit;
