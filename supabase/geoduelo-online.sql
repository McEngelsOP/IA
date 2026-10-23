-- MANUAL: ejecutar después de arcade.sql y geoduelo.sql. Puede repetirse.
-- No modifica el ranking local. Los resultados online solo los escribe Cloudflare.
begin;
create table if not exists public.geoduelo_online_results (
  match_id uuid primary key,
  player_one uuid not null references auth.users(id) on delete cascade,
  player_two uuid not null references auth.users(id) on delete cascade,
  score_one integer not null check (score_one between 0 and 1500),
  score_two integer not null check (score_two between 0 and 1500),
  outcome text not null check (outcome in ('completed','abandoned')),
  winner_seat integer check (winner_seat in (0,1)),
  created_at timestamptz not null default now(),
  check (player_one <> player_two)
);
create index if not exists geoduelo_online_results_one on public.geoduelo_online_results(player_one, created_at desc);
create index if not exists geoduelo_online_results_two on public.geoduelo_online_results(player_two, created_at desc);
alter table public.geoduelo_online_results enable row level security;
revoke all on public.geoduelo_online_results from public, anon, authenticated;
grant select on public.geoduelo_online_results to authenticated;
drop policy if exists "Players read own online matches" on public.geoduelo_online_results;
create policy "Players read own online matches" on public.geoduelo_online_results for select to authenticated
  using ((select auth.uid()) = player_one or (select auth.uid()) = player_two);

create or replace function public.record_geoduelo_online(
  match_id uuid, player_one uuid, player_two uuid, score_one integer,
  score_two integer, outcome text, winner_seat integer
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if match_id is null or player_one is null or player_two is null or player_one = player_two
    or score_one is null or score_two is null or score_one not between 0 and 1500 or score_two not between 0 and 1500
    or outcome is null or outcome not in ('completed','abandoned')
    or (winner_seat is not null and winner_seat not in (0,1)) then raise exception 'BAD_RESULT'; end if;
  if outcome = 'completed' and winner_seat is distinct from
    (case when score_one = score_two then null when score_one > score_two then 0 else 1 end)
    then raise exception 'BAD_WINNER'; end if;
  if outcome = 'abandoned' and winner_seat is null then raise exception 'BAD_WINNER'; end if;
  insert into public.geoduelo_online_results(match_id,player_one,player_two,score_one,score_two,outcome,winner_seat)
    values(match_id,player_one,player_two,score_one,score_two,outcome,winner_seat)
    on conflict on constraint geoduelo_online_results_pkey do nothing;
end;
$$;
revoke all on function public.record_geoduelo_online(uuid,uuid,uuid,integer,integer,text,integer) from public, anon, authenticated;
grant execute on function public.record_geoduelo_online(uuid,uuid,uuid,integer,integer,text,integer) to service_role;
commit;
