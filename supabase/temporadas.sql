-- ============================================================
-- Query 26 · ARCADE: temporadas en el ranking (2026-I, 2026-II…)
-- ============================================================
-- El ranking deja de ser eterno: cada temporada académica
-- (YYYY-I = enero–julio, YYYY-II = agosto–diciembre) tiene su
-- propio top 10 y el mejor puntaje se guarda POR temporada.
-- Las temporadas pasadas quedan como "salón de la fama" (solo
-- lectura desde la app). Los puntajes existentes se migran a la
-- temporada actual.
-- Correr ANTES de desplegar el frontend con temporadas.

-- La misma regla vive en src/lib/temporada.js: si se cambia aquí,
-- cambiarla también allá.
create or replace function public.temporada_actual()
returns text
language sql
stable
as $$
  select extract(year from now())::int::text
    || case when extract(month from now()) <= 7 then '-I' else '-II' end
$$;

-- Columna de temporada: las filas existentes quedan en la actual
alter table public.game_scores
  add column if not exists season text not null default public.temporada_actual();

-- El mejor puntaje ahora es por alumno + juego + temporada
alter table public.game_scores drop constraint game_scores_pkey;
alter table public.game_scores add primary key (student_id, game, season);

drop index if exists public.game_scores_ranking;
create index game_scores_ranking on public.game_scores (game, season, score desc);

-- El cliente puede leer la temporada (student_id sigue sin ser legible)
grant select (season) on public.game_scores to authenticated;

-- submit: estampa la temporada actual y conserva el mejor DE ESA temporada
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
  if g not in ('dino', 'astro', 'galaxia', 'frogger', 'memoria') then
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

-- Mi mejor puntaje DE LA TEMPORADA ACTUAL
create or replace function public.my_game_score(g text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select score from public.game_scores
   where student_id = auth.uid() and game = g
     and season = public.temporada_actual();
$$;
