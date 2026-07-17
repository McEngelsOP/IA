-- ============================================================
-- Query 21 · ARCADE: registrar los juegos 'astro' y 'galaxia'
-- ============================================================
-- game_scores nació aceptando solo 'dino' (CHECK en la tabla y
-- validación en submit_game_score). Este script añade 'astro'
-- (Astro-Defensa) y 'galaxia' (Escuadrón Galáctico) para que sus
-- modos Normal puedan puntuar.
-- Correr ANTES de desplegar el frontend con los juegos nuevos.

alter table public.game_scores
  drop constraint if exists game_scores_game_check;

alter table public.game_scores
  add constraint game_scores_game_check check (game in ('dino', 'astro', 'galaxia'));

-- misma función, con el juego nuevo en la lista blanca
create or replace function public.submit_game_score(g text, s integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a text;
  best integer;
begin
  if auth.uid() is null then
    raise exception 'NO_AUTH';
  end if;
  if g not in ('dino', 'astro', 'galaxia') then
    raise exception 'BAD_GAME';
  end if;
  if s < 1 or s > 100000 then
    raise exception 'BAD_SCORE';
  end if;
  select alias into a from public.profiles where id = auth.uid();
  if a is null then
    raise exception 'ALIAS_REQUIRED';
  end if;
  insert into public.game_scores (student_id, game, alias, score)
  values (auth.uid(), g, a, s)
  on conflict (student_id, game) do update
    set score      = greatest(public.game_scores.score, excluded.score),
        alias      = excluded.alias,
        updated_at = now();
  select score into best
    from public.game_scores
   where student_id = auth.uid() and game = g;
  return best;
end;
$$;
