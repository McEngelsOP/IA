-- Ejecutar manualmente en el SQL Editor del proyecto IA.
-- Requiere supabase/arcade.sql ya instalado. No borra resultados ni cambia RLS.
begin;
alter table public.game_scores drop constraint if exists game_scores_game_check;
alter table public.game_scores add constraint game_scores_game_check
  check (game in ('dino','astro','galaxia','frogger','memoria','geoduelo'));

create or replace function public.submit_game_score(g text, s integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a text;
  t text := public.temporada_actual();
  best integer;
begin
  if auth.uid() is null then
    raise exception 'NO_AUTH';
  end if;
  if g not in ('dino', 'galaxia', 'memoria', 'geoduelo') then
    raise exception 'BAD_GAME';
  end if;
  if s < 1 or s > 100000 then
    raise exception 'BAD_SCORE';
  end if;
  select alias into a from public.profiles where id = auth.uid();
  if a is null then
    raise exception 'ALIAS_REQUIRED';
  end if;
  insert into public.game_scores (student_id, game, alias, score, season)
  values (auth.uid(), g, a, s, t)
  on conflict (student_id, game, season) do update
    set score      = greatest(public.game_scores.score, excluded.score),
        alias      = excluded.alias,
        updated_at = now();
  select score into best
    from public.game_scores
   where student_id = auth.uid() and game = g and season = t;
  return best;
end;
$$;

revoke execute on function public.submit_game_score(text, integer) from public, anon;
grant execute on function public.submit_game_score(text, integer) to authenticated;
commit;

-- Verificación de instalación, sin crear puntajes ficticios:
select pg_get_constraintdef(oid) as juegos_permitidos
from pg_constraint where conrelid = 'public.game_scores'::regclass
  and conname = 'game_scores_game_check';
select position('geoduelo' in pg_get_functiondef('public.submit_game_score(text,integer)'::regprocedure)) > 0
  as geoduelo_habilitado;
