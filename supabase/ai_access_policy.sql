-- Targeted AI access policy; independent from system_complete.sql.
-- No existing student is automatically marked as institutionally verified.
create table if not exists private.ai_affiliations (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 verified_at timestamptz, verified_by uuid, valid_until timestamptz,
 verification_source text check(verification_source in ('institutional_email','manual_review')),
 revoked_at timestamptz
);
create table if not exists private.ai_requests (
 id uuid primary key, user_id uuid not null references public.profiles(id) on delete cascade,
 source text not null check(source in ('system','personal')),
 resource text not null check(resource in ('chat','tasks','schedule','key_test')),
 created_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 outcome text not null default 'reserved' check(outcome in ('reserved','ok','failed'))
);
create index if not exists ai_requests_user_time on private.ai_requests(user_id,created_at desc);
create index if not exists ai_requests_source_time on private.ai_requests(source,created_at desc);
create table if not exists private.ai_request_locks (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 request_id uuid not null, expires_at timestamptz not null
);
alter table private.ai_affiliations enable row level security;
alter table private.ai_requests enable row level security;
alter table private.ai_request_locks enable row level security;
revoke all on private.ai_affiliations,private.ai_requests,private.ai_request_locks from public,anon,authenticated;
grant all on private.ai_affiliations,private.ai_requests,private.ai_request_locks to service_role;

create or replace function private.ai_policy_access(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare institution text; affiliation private.ai_affiliations; chosen text; eligible boolean; state text; administrator boolean;
begin
 select institution_id,is_admin into institution,administrator from public.profiles where id=p_user_id;
 if not found then raise exception 'invalid_user'; end if;
 select * into affiliation from private.ai_affiliations where user_id=p_user_id;
 eligible:=coalesce(institution='esan' and affiliation.verified_at is not null and affiliation.revoked_at is null and affiliation.valid_until>now(),false);
 state:=case when institution is null then 'unknown' when institution<>'esan' then 'external' when eligible then 'verified' when affiliation.revoked_at is not null then 'revoked' when affiliation.valid_until<=now() then 'expired' else 'pending' end;
 select mode into chosen from private.ai_user_settings where user_id=p_user_id;
 return jsonb_build_object('isAdmin',coalesce(administrator,false),'institutionId',institution,'sharedEligible',eligible,'personalRequired',not eligible,'verificationStatus',state,'validUntil',case when eligible then affiliation.valid_until end,'mode',case when eligible then coalesce(chosen,'system') else 'personal' end);
end $$;
revoke all on function private.ai_policy_access(uuid) from public,anon,authenticated;
grant execute on function private.ai_policy_access(uuid) to service_role;

create or replace function private.ai_usage_snapshot(p_user_id uuid,p_source text,p_resource text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare at_time timestamptz:=now(); day_start timestamptz; day_end timestamptz; window_count integer; day_count integer; resource_count integer; window_limit integer; day_limit integer; resource_limit integer; retry_at timestamptz:=now(); reason text; lease private.ai_request_locks;
begin
 if p_source is null or p_source not in ('system','personal') or p_resource is null or p_resource not in ('chat','tasks','schedule','key_test') then raise exception 'invalid_ai_scope'; end if;
 day_start:=date_trunc('day',at_time at time zone 'America/Lima') at time zone 'America/Lima';
 day_end:=(date_trunc('day',at_time at time zone 'America/Lima')+interval '1 day') at time zone 'America/Lima';
 window_limit:=case when p_source='system' then 5 else 10 end;
 day_limit:=case when p_source='system' then 20 else 200 end;
 resource_limit:=case p_resource when 'schedule' then case when p_source='system' then 5 else 20 end when 'tasks' then case when p_source='system' then 10 else 50 end when 'key_test' then 10 else day_limit end;
 -- All resources and both modes share these account counters; changing keys does not reset them.
 select count(*) filter(where created_at>at_time-interval '15 minutes'),count(*),count(*) filter(where resource=p_resource)
 into window_count,day_count,resource_count from private.ai_requests where user_id=p_user_id and created_at>=day_start;
 -- A rolling window can cross midnight.
 select count(*) into window_count from private.ai_requests where user_id=p_user_id and created_at>at_time-interval '15 minutes';
 if window_count>=window_limit then reason:='user_rate_limited';select created_at+interval '15 minutes' into retry_at from private.ai_requests where user_id=p_user_id and created_at>at_time-interval '15 minutes' order by created_at desc offset (window_limit-1) limit 1; end if;
 if day_count>=day_limit then reason:='daily_limit';retry_at:=greatest(retry_at,day_end); end if;
 if p_resource<>'chat' and resource_count>=resource_limit then reason:='resource_limit';retry_at:=greatest(retry_at,day_end); end if;
 if p_resource='key_test' and (select count(*) from private.ai_requests where user_id=p_user_id and resource='key_test' and created_at>at_time-interval '15 minutes')>=3 then reason:='test_rate_limited';retry_at:=greatest(retry_at,at_time+interval '15 minutes'); end if;
 select * into lease from private.ai_request_locks where user_id=p_user_id and expires_at>at_time;
 if found then reason:='request_in_progress';retry_at:=greatest(retry_at,lease.expires_at); end if;
 return jsonb_build_object('allowed',reason is null,'canSend',reason is null,'reason',reason,'source',p_source,'remaining',greatest(0,window_limit-window_count),'limit',window_limit,'windowSeconds',900,'dailyRemaining',greatest(0,day_limit-day_count),'dailyLimit',day_limit,'resourceRemaining',greatest(0,resource_limit-resource_count),'resourceLimit',resource_limit,'resetAt',day_end,'nextAvailableAt',retry_at,'retryAfterSeconds',greatest(0,ceil(extract(epoch from retry_at-at_time))));
end $$;
revoke all on function private.ai_usage_snapshot(uuid,text,text) from public,anon,authenticated;
grant execute on function private.ai_usage_snapshot(uuid,text,text) to service_role;

create or replace function private.ai_request_begin(p_user_id uuid,p_source text,p_resource text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare access jsonb; snapshot jsonb; cfg private.advisor_limits; legacy_day integer; legacy_minute integer; day_start timestamptz; day_end timestamptz; at_time timestamptz:=clock_timestamp();
begin
 if p_request_id is null then raise exception 'invalid_request'; end if;
 perform 1 from public.profiles where id=p_user_id for update;
 if not found then raise exception 'invalid_user'; end if;
 access:=private.ai_policy_access(p_user_id);
 if p_source is null or p_source not in ('system','personal') or p_resource is null or p_resource not in ('chat','tasks','schedule','key_test') then raise exception 'invalid_ai_scope'; end if;
 if p_source='system' and (not(access->>'sharedEligible')::boolean or access->>'mode'<>'system') then return jsonb_build_object('allowed',false,'reason','personal_key_required'); end if;
 if p_source='personal' and not exists(select 1 from private.ai_user_keys where user_id=p_user_id and enabled) then return jsonb_build_object('allowed',false,'reason','personal_key_required'); end if;
 if p_source is distinct from access->>'mode' and p_resource<>'key_test' then return jsonb_build_object('allowed',false,'reason','ai_mode_changed'); end if;
 if exists(select 1 from private.ai_requests where id=p_request_id) then return jsonb_build_object('allowed',false,'reason','duplicate_request'); end if;
 snapshot:=private.ai_usage_snapshot(p_user_id,p_source,p_resource);
 if not(snapshot->>'allowed')::boolean then return snapshot; end if;
 if p_source='system' then
  select * into cfg from private.advisor_limits where singleton for update;
  if not found then return jsonb_build_object('allowed',false,'reason','quota_unavailable'); end if;
  -- Keep the existing shared pool caps and provider-specific reservations.
  day_start:=date_trunc('day',at_time at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  day_end:=(date_trunc('day',at_time at time zone 'America/Los_Angeles')+interval '1 day') at time zone 'America/Los_Angeles';
  select count(*) filter(where t>=day_start),count(*) filter(where t>at_time-interval '1 minute') into legacy_day,legacy_minute from unnest(cfg.requests) t;
  if legacy_minute+(select count(*) from private.ai_requests where source='system' and created_at>at_time-interval '1 minute')>=cfg.global_minute_limit then return snapshot||jsonb_build_object('allowed',false,'canSend',false,'reason','global_rate_limited','nextAvailableAt',at_time+interval '1 minute','retryAfterSeconds',60); end if;
  if legacy_day+(select count(*) from private.ai_requests where source='system' and created_at>=day_start)>=cfg.global_daily_limit then return snapshot||jsonb_build_object('allowed',false,'canSend',false,'reason','global_rate_limited','nextAvailableAt',day_end,'retryAfterSeconds',ceil(extract(epoch from (day_end-at_time)))); end if;
 end if;
 insert into private.ai_requests(id,user_id,source,resource,created_at) values(p_request_id,p_user_id,p_source,p_resource,at_time);
 insert into private.ai_request_locks(user_id,request_id,expires_at) values(p_user_id,p_request_id,at_time+interval '120 seconds') on conflict(user_id) do update set request_id=excluded.request_id,expires_at=excluded.expires_at;
 -- Release updates do not refund provider work; every accepted request counts once, including failures.
 return (snapshot||jsonb_build_object('remaining',greatest(0,(snapshot->>'remaining')::integer-1),'dailyRemaining',greatest(0,(snapshot->>'dailyRemaining')::integer-1),'resourceRemaining',greatest(0,(snapshot->>'resourceRemaining')::integer-1),'requestId',p_request_id,'access',access));
end $$;
create or replace function public.ai_request_begin(p_user_id uuid,p_source text,p_resource text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.ai_request_begin(p_user_id,p_source,p_resource,p_request_id)$$;
revoke all on function private.ai_request_begin(uuid,text,text,uuid),public.ai_request_begin(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function private.ai_request_begin(uuid,text,text,uuid),public.ai_request_begin(uuid,text,text,uuid) to service_role;
create or replace function private.ai_request_finish(p_user_id uuid,p_request_id uuid,p_success boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.ai_requests set outcome=case when p_success then 'ok' else 'failed' end,finished_at=clock_timestamp() where user_id=p_user_id and id=p_request_id and finished_at is null;
 delete from private.ai_request_locks where user_id=p_user_id and request_id=p_request_id;
end $$;
create or replace function public.ai_request_finish(p_user_id uuid,p_request_id uuid,p_success boolean) returns void language sql security invoker set search_path='' as $$select private.ai_request_finish(p_user_id,p_request_id,p_success)$$;
revoke all on function private.ai_request_finish(uuid,uuid,boolean),public.ai_request_finish(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function private.ai_request_finish(uuid,uuid,boolean),public.ai_request_finish(uuid,uuid,boolean) to service_role;

create or replace function private.ai_access_policy() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare access jsonb; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'NO_AUTH' using errcode='42501'; end if;
 access:=private.ai_policy_access(uid);
 return jsonb_build_object('access',access,'usage',private.ai_usage_snapshot(uid,access->>'mode','chat'),'activeProviders',coalesce((select jsonb_agg(provider) from private.ai_user_keys where user_id=uid and enabled),'[]'));
end $$;
create or replace function public.ai_access_policy() returns jsonb language sql security invoker set search_path='' as $$select private.ai_access_policy()$$;
revoke all on function private.ai_access_policy(),public.ai_access_policy() from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.ai_access_policy(),public.ai_access_policy() to authenticated;

create or replace function private.admin_set_ai_affiliation(p_user_id uuid,p_verified boolean,p_source text default 'manual_review',p_valid_until timestamptz default null) returns void language plpgsql security definer set search_path='' as $$
declare until_at timestamptz:=coalesce(p_valid_until,now()+interval '180 days');
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_verified is null then raise exception 'INVALID_VERIFICATION'; end if;
 perform 1 from public.profiles where id=p_user_id for update;
 if not found then raise exception 'INVALID_USER'; end if;
 if p_verified then
  if not exists(select 1 from public.profiles where id=p_user_id and institution_id='esan') then raise exception 'ESAN_AFFILIATION_REQUIRED'; end if;
  if p_source is null or p_source not in ('institutional_email','manual_review') or until_at<=now() or until_at>now()+interval '366 days' then raise exception 'INVALID_VERIFICATION'; end if;
  insert into private.ai_affiliations(user_id,verified_at,verified_by,valid_until,verification_source,revoked_at) values(p_user_id,now(),auth.uid(),until_at,p_source,null)
  on conflict(user_id) do update set verified_at=excluded.verified_at,verified_by=excluded.verified_by,valid_until=excluded.valid_until,verification_source=excluded.verification_source,revoked_at=null;
 else
  update private.ai_affiliations set revoked_at=now() where user_id=p_user_id;
 end if;
end $$;
create or replace function public.admin_set_ai_affiliation(p_user_id uuid,p_verified boolean,p_source text default 'manual_review',p_valid_until timestamptz default null) returns void language sql security invoker set search_path='' as $$select private.admin_set_ai_affiliation(p_user_id,p_verified,p_source,p_valid_until)$$;
revoke all on function private.admin_set_ai_affiliation(uuid,boolean,text,timestamptz),public.admin_set_ai_affiliation(uuid,boolean,text,timestamptz) from public,anon;
grant execute on function private.admin_set_ai_affiliation(uuid,boolean,text,timestamptz),public.admin_set_ai_affiliation(uuid,boolean,text,timestamptz) to authenticated;

-- Server-only credential lookup always derives eligibility from protected database records.
create or replace function private.ai_key_read(p_user_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('mode',private.ai_policy_access(p_user_id)->>'mode','access',private.ai_policy_access(p_user_id),
 'providers',coalesce((select jsonb_agg(jsonb_build_object('name',k.provider,'key',v.decrypted_secret)) from private.ai_user_keys k join vault.decrypted_secrets v on v.id=k.secret_id where k.user_id=p_user_id and k.enabled),'[]'))
$$;
revoke all on function private.ai_key_read(uuid) from public,anon,authenticated;
grant execute on function private.ai_key_read(uuid) to service_role;

create or replace function private.ai_key_manage(p_user_id uuid,p_action text,p_provider text default null,p_key text default null,p_enabled boolean default null,p_mode text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; items jsonb; chosen_mode text;
begin
  if p_user_id is null or not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'invalid_user'; end if;
  perform 1 from public.profiles where id=p_user_id for update;
  if p_action not in ('list','save','delete','toggle','mode') then raise exception 'invalid_action'; end if;
  if p_action in ('save','delete','toggle') and (p_provider is null or p_provider not in ('gemini','groq','openrouter')) then raise exception 'invalid_provider'; end if;
  if p_action='mode' and p_mode='system' and not(private.ai_policy_access(p_user_id)->>'sharedEligible')::boolean then raise exception 'PERSONAL_KEY_REQUIRED'; end if;
  if p_action='save' then
    if p_key is null or length(p_key) not between 20 and 512 or p_key ~ '[[:space:][:cntrl:]]' then raise exception 'invalid_key'; end if;
    select secret_id into sid from private.ai_user_keys where user_id=p_user_id and provider=p_provider;
    if sid is null then
      sid := vault.create_secret(p_key,'student-ai:'||p_user_id::text||':'||p_provider,'Student-owned AI credential');
      insert into private.ai_user_keys(user_id,provider,secret_id,key_hint) values(p_user_id,p_provider,sid,'••••'||right(p_key,4));
    else
      perform vault.update_secret(sid,p_key);
      update private.ai_user_keys set key_hint='••••'||right(p_key,4),enabled=true,last_status=null,retry_until='epoch',updated_at=now() where user_id=p_user_id and provider=p_provider;
    end if;
    insert into private.ai_user_settings(user_id,mode) values(p_user_id,'personal') on conflict(user_id) do update set mode='personal',updated_at=now();
  elsif p_action='delete' then
    delete from private.ai_user_keys where user_id=p_user_id and provider=p_provider;
  elsif p_action='toggle' then
    if p_enabled is null then raise exception 'invalid_enabled'; end if;
    update private.ai_user_keys set enabled=p_enabled,updated_at=now() where user_id=p_user_id and provider=p_provider;
  elsif p_action='mode' then
    if p_mode is null or p_mode not in ('system','personal') then raise exception 'invalid_mode'; end if;
    insert into private.ai_user_settings(user_id,mode) values(p_user_id,p_mode) on conflict(user_id) do update set mode=excluded.mode,updated_at=now();
  end if;
  select mode into chosen_mode from private.ai_user_settings where user_id=p_user_id;
  select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'hint',key_hint,'enabled',enabled,'lastStatus',last_status,'updatedAt',updated_at) order by provider),'[]'::jsonb) into items from private.ai_user_keys where user_id=p_user_id;
  return jsonb_build_object('mode',private.ai_policy_access(p_user_id)->>'mode','keys',items,'access',private.ai_policy_access(p_user_id),'usage',private.ai_usage_snapshot(p_user_id,private.ai_policy_access(p_user_id)->>'mode','chat'));
end $$;

revoke all on function private.ai_key_manage(uuid,text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function private.ai_key_manage(uuid,text,text,text,boolean,text) to service_role;
create or replace function public.ai_usage(p_user_id uuid,p_source text,p_resource text) returns jsonb language sql security invoker set search_path='' as $$select private.ai_usage_snapshot(p_user_id,p_source,p_resource)$$;
revoke all on function public.ai_usage(uuid,text,text) from public,anon,authenticated;
grant execute on function public.ai_usage(uuid,text,text) to service_role;
-- Legacy endpoints cannot charge the shared pool for an unverified/external account.
DO $$declare definition text; marker text:='  select * into cfg from private.advisor_limits'; begin
 select pg_get_functiondef('private.advisor_usage(boolean)'::regprocedure) into definition;
 if position('private.ai_policy_access' in definition)=0 then
  if position(marker in definition)=0 then raise exception 'UNRECOGNIZED_ADVISOR_USAGE'; end if;
  definition:=replace(definition,marker,E'  if not(private.ai_policy_access(uid)->>''sharedEligible'')::boolean then return private.ai_usage_snapshot(uid,''personal'',''chat'')||jsonb_build_object(''allowed'',false,''canSend'',false,''reason'',''personal_key_required''); end if;\n'||marker);
  execute definition;
 end if;
end $$;
DO $$declare item text;begin
 foreach item in array array['ai_affiliations','ai_requests','ai_request_locks'] loop
  execute 'drop policy if exists ai_server_only on private.'||item;
  execute 'create policy ai_server_only on private.'||item||' to service_role using(true) with check(true)';
 end loop;
end $$;
notify pgrst,'reload schema';
