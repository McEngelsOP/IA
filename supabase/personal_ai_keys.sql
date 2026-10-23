-- Ciphertext lives in Vault; mappings and usage are not exposed to students.
create table if not exists private.ai_user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  mode text not null default 'system' check (mode in ('system','personal')),
  updated_at timestamptz not null default now()
);
create table if not exists private.ai_user_keys (
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('gemini','groq','openrouter')),
  secret_id uuid not null unique references vault.secrets(id) on delete cascade,
  key_hint text not null, enabled boolean not null default true,
  last_status text, retry_until timestamptz not null default 'epoch',
  updated_at timestamptz not null default now(), primary key(user_id,provider)
);
create table if not exists private.ai_user_usage (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  requests timestamptz[] not null default '{}'
);
alter table private.ai_user_settings enable row level security;
alter table private.ai_user_keys enable row level security;
alter table private.ai_user_usage enable row level security;
create policy ai_settings_server_only on private.ai_user_settings to service_role using(true) with check(true);
create policy ai_keys_server_only on private.ai_user_keys to service_role using(true) with check(true);
create policy ai_usage_server_only on private.ai_user_usage to service_role using(true) with check(true);
revoke all on private.ai_user_settings,private.ai_user_keys,private.ai_user_usage from public,anon,authenticated;
grant all on private.ai_user_settings,private.ai_user_keys,private.ai_user_usage to service_role;

create or replace function private.ai_delete_vault_secret() returns trigger
language plpgsql security definer set search_path='' as $$
begin delete from vault.secrets where id=old.secret_id; return old; end $$;
revoke all on function private.ai_delete_vault_secret() from public,anon,authenticated;
create trigger ai_key_delete_secret after delete on private.ai_user_keys
for each row execute function private.ai_delete_vault_secret();

-- Only the authenticated Edge Function can call the service-only wrappers.
create or replace function private.ai_key_manage(p_user_id uuid,p_action text,p_provider text default null,p_key text default null,p_enabled boolean default null,p_mode text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; items jsonb; chosen_mode text;
begin
  if p_user_id is null or not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'invalid_user'; end if;
  perform 1 from public.profiles where id=p_user_id for update;
  if p_action not in ('list','save','delete','toggle','mode') then raise exception 'invalid_action'; end if;
  if p_action in ('save','delete','toggle') and (p_provider is null or p_provider not in ('gemini','groq','openrouter')) then raise exception 'invalid_provider'; end if;
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
  return jsonb_build_object('mode',coalesce(chosen_mode,'system'),'keys',items);
end $$;
revoke all on function private.ai_key_manage(uuid,text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function private.ai_key_manage(uuid,text,text,text,boolean,text) to service_role;
create or replace function public.ai_key_manage(p_user_id uuid,p_action text,p_provider text default null,p_key text default null,p_enabled boolean default null,p_mode text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.ai_key_manage(p_user_id,p_action,p_provider,p_key,p_enabled,p_mode) $$;
revoke all on function public.ai_key_manage(uuid,text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.ai_key_manage(uuid,text,text,text,boolean,text) to service_role;

create or replace function private.ai_key_read(p_user_id uuid) returns jsonb
language sql security definer set search_path='' as $$
select jsonb_build_object('mode',coalesce((select mode from private.ai_user_settings where user_id=p_user_id),'system'),
 'providers',coalesce((select jsonb_agg(jsonb_build_object('name',k.provider,'key',v.decrypted_secret)) from private.ai_user_keys k join vault.decrypted_secrets v on v.id=k.secret_id where k.user_id=p_user_id and k.enabled),'[]'::jsonb))
$$;
revoke all on function private.ai_key_read(uuid) from public,anon,authenticated;
grant execute on function private.ai_key_read(uuid) to service_role;
create or replace function public.ai_key_read(p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.ai_key_read(p_user_id) $$;
revoke all on function public.ai_key_read(uuid) from public,anon,authenticated;
grant execute on function public.ai_key_read(uuid) to service_role;

create or replace function public.ai_personal_usage(p_user_id uuid,p_consume boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare at_time timestamptz:=clock_timestamp(); all_requests timestamptz[]; recent timestamptz[]; available_at timestamptz:=at_time; reason text; left_count integer;
begin
  insert into private.ai_user_usage(user_id) values(p_user_id) on conflict do nothing;
  select requests into all_requests from private.ai_user_usage where user_id=p_user_id for update;
  select coalesce(array_agg(t order by t),'{}') into all_requests from unnest(all_requests) t where t >= date_trunc('day',at_time at time zone 'America/Lima') at time zone 'America/Lima';
  select coalesce(array_agg(t order by t),'{}') into recent from unnest(all_requests) t where t > at_time-interval '15 minutes';
  if cardinality(recent)>=10 then reason:='user_rate_limited'; available_at:=recent[cardinality(recent)-9]+interval '15 minutes'; end if;
  if cardinality(all_requests)>=200 then reason:='user_rate_limited'; available_at:=greatest(available_at,(date_trunc('day',at_time at time zone 'America/Lima')+interval '1 day') at time zone 'America/Lima'); end if;
  if p_consume and reason is null then
    all_requests:=array_append(all_requests,at_time);recent:=array_append(recent,at_time);
    update private.ai_user_usage set requests=all_requests where user_id=p_user_id;
  end if;
  left_count:=greatest(0,10-cardinality(recent));
  return jsonb_build_object('allowed',reason is null,'reason',reason,'remaining',left_count,'limit',10,'windowSeconds',900,'canSend',reason is null,'nextAvailableAt',available_at,'retryAfterSeconds',greatest(0,ceil(extract(epoch from available_at-at_time))));
end $$;
revoke all on function public.ai_personal_usage(uuid,boolean) from public,anon,authenticated;
grant execute on function public.ai_personal_usage(uuid,boolean) to service_role;
create or replace function public.ai_personal_reserve(p_user_id uuid,p_provider text) returns jsonb
language sql security invoker set search_path='' as $$
select jsonb_build_object('allowed',enabled and retry_until<=clock_timestamp(),'retryAfterSeconds',greatest(1,ceil(extract(epoch from retry_until-clock_timestamp())))) from private.ai_user_keys where user_id=p_user_id and provider=p_provider
$$;
revoke all on function public.ai_personal_reserve(uuid,text) from public,anon,authenticated;
grant execute on function public.ai_personal_reserve(uuid,text) to service_role;
create or replace function public.ai_personal_report(p_user_id uuid,p_provider text,p_status text,p_wait integer) returns void
language sql security invoker set search_path='' as $$
update private.ai_user_keys set last_status=left(p_status,40),retry_until=case when p_wait>0 then clock_timestamp()+make_interval(secs=>least(86400,p_wait)) when p_status='ok' then 'epoch'::timestamptz else retry_until end where user_id=p_user_id and provider=p_provider
$$;
revoke all on function public.ai_personal_report(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.ai_personal_report(uuid,text,text,integer) to service_role;
