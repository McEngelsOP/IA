-- ============================================================
-- Query 22 · ARCADE: reparar submit_game_score (error 42601)
-- ============================================================
-- El INSERT de las queries 20/21 listaba 4 columnas pero solo
-- 3 valores (faltaba el alias `a`): Postgres solo valida el
-- cuerpo al EJECUTAR, por eso la creación no falló pero ningún
-- puntaje se pudo guardar jamás:
--   "INSERT has more target columns than expressions"
-- Esta versión corrige la línea VALUES. Correr una sola vez;
-- los permisos existentes se conservan con CREATE OR REPLACE.

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
