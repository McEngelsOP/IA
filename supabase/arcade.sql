-- ============================================================
-- Query 20 · ARCADE: puntajes de juegos con ranking global
-- ============================================================
-- Tabla de mejores puntajes: una fila por alumno por juego.
-- El ranking es público entre alumnos pero firma con el ALIAS
-- ("nombre secreto"), igual que las reseñas anónimas: el cliente
-- NUNCA puede leer student_id (permiso a nivel de columna), así
-- nadie puede unir alias ↔ cuenta y desanonimizar los comentarios.
--
-- Toda escritura pasa por una función SECURITY DEFINER
-- (submit_game_score): valida el juego, capa el puntaje, estampa
-- el alias desde el perfil y solo conserva el MEJOR puntaje.
-- El cliente no tiene permisos de INSERT/UPDATE sobre la tabla.

create table public.game_scores (
  student_id uuid not null references auth.users (id) on delete cascade,
  game       text not null check (game in ('dino')),
  alias      text not null,
  score      integer not null check (score between 1 and 100000),
  updated_at timestamptz not null default now(),
  primary key (student_id, game)
);

create index game_scores_ranking on public.game_scores (game, score desc);

alter table public.game_scores enable row level security;

-- Solo lectura para alumnos; anon no tiene ninguna política (como siempre)
create policy "ranking visible para alumnos"
  on public.game_scores for select
  to authenticated
  using (true);

-- Permiso a nivel de columna: student_id NO es legible por el cliente.
-- Por eso los select desde la app deben pedir columnas explícitas.
revoke all on table public.game_scores from anon, authenticated;
grant select (game, alias, score, updated_at) on public.game_scores to authenticated;

-- Registrar un puntaje: guarda solo si supera el mejor anterior.
-- Devuelve el mejor puntaje del alumno en ese juego.
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
  if g not in ('dino') then
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

-- Mi mejor puntaje (el cliente no puede filtrar por student_id, así
-- que se lee vía función, como my_tool_comment_count)
create or replace function public.my_game_score(g text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select score from public.game_scores
   where student_id = auth.uid() and game = g;
$$;

revoke execute on function public.submit_game_score(text, integer) from public, anon;
grant execute on function public.submit_game_score(text, integer) to authenticated;
revoke execute on function public.my_game_score(text) from public, anon;
grant execute on function public.my_game_score(text) to authenticated;
