-- Arcade - Rutinas consolidadas de mantenimiento, Lyra, 13-10-2026 UTC.
-- Base YA instalada: no crea tablas, no migra datos ni sustituye políticas RLS.
-- Conserva nombres RPC, valores por defecto, search_path y permisos vigentes.
-- Las funciones de app_private se mantienen separadas de sus entradas públicas.
-- Revisar esta instantánea antes de aplicarla tras futuras migraciones.
BEGIN;
DO $requirements$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['game_scores','profiles'] LOOP
    IF to_regclass('public.'||table_name) IS NULL THEN
      RAISE EXCEPTION 'Falta public.%; usar el procedimiento de instalación, no mantenimiento',table_name;
    END IF;
  END LOOP;
END;
$requirements$;

CREATE OR REPLACE FUNCTION public.temporada_actual()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select extract(year from now())::int::text
    || case when extract(month from now()) <= 7 then '-I' else '-II' end
$function$;
REVOKE ALL ON FUNCTION public.temporada_actual() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.temporada_actual() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.temporada_actual() TO "postgres";
GRANT EXECUTE ON FUNCTION public.temporada_actual() TO "anon";
GRANT EXECUTE ON FUNCTION public.temporada_actual() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.temporada_actual() TO "service_role";

CREATE OR REPLACE FUNCTION public.my_game_score(g text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select score from public.game_scores
   where student_id = auth.uid() and game = g
     and season = public.temporada_actual();
$function$;
REVOKE ALL ON FUNCTION public.my_game_score(g text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_game_score(g text) TO "postgres";
GRANT EXECUTE ON FUNCTION public.my_game_score(g text) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.my_game_score(g text) TO "service_role";

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
$function$;
REVOKE ALL ON FUNCTION public.submit_game_score(g text, s integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_game_score(g text, s integer) TO "postgres";
GRANT EXECUTE ON FUNCTION public.submit_game_score(g text, s integer) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.submit_game_score(g text, s integer) TO "service_role";

NOTIFY pgrst, 'reload schema';
COMMIT;

