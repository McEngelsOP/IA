-- Optional worker activation, after 001–004. Configure the two Vault secrets before scheduling.
-- No API key belongs in this file or in browser variables.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create or replace function public.run_curriculum_analysis_worker() returns bigint
language plpgsql security definer set search_path='' as $$
declare endpoint text; worker_secret text; request_id bigint;
begin
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='lyra_supabase_url' order by created_at desc limit 1;
 select decrypted_secret into worker_secret from vault.decrypted_secrets where name='lyra_curriculum_worker_secret' order by created_at desc limit 1;
 if endpoint is null or endpoint !~ '^https://[a-z0-9-]+\.supabase\.co/?$' or worker_secret is null or length(worker_secret)<32 then raise exception 'WORKER_VAULT_CONFIGURATION_REQUIRED';end if;
 if not exists(select 1 from public.curriculum_analysis_jobs where status='queued' or (status='running' and lease_until<now())) then return null;end if;
 select net.http_post(url:=rtrim(endpoint,'/')||'/functions/v1/curriculum-analysis',headers:=jsonb_build_object('Content-Type','application/json','x-curriculum-worker-secret',worker_secret),body:='{"action":"worker"}'::jsonb,timeout_milliseconds:=60000) into request_id;
 return request_id;
end$$;
revoke all on function public.run_curriculum_analysis_worker() from public,anon,authenticated;
grant execute on function public.run_curriculum_analysis_worker() to service_role;
select cron.schedule('lyra-curriculum-analysis','* * * * *','select public.run_curriculum_analysis_worker()');
