-- Retire Astro and Frogger through the checked score API. Historical rows
-- remain intact. No client has direct INSERT/UPDATE permissions on scores.
-- Preserve the historical-value constraint for alias synchronization.
CREATE OR REPLACE FUNCTION public.submit_game_score(g text, s integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a text;
  t text := public.temporada_actual();
  best integer;
begin
  if auth.uid() is null then
    raise exception 'NO_AUTH';
  end if;
  if g not in ('dino', 'galaxia', 'memoria') then
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
$function$
;

