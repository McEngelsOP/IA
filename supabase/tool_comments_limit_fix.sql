-- ============================================================
-- Sílabo IA · Arreglo del tope de comentarios en herramientas
-- Bug: la política de INSERT contaba los comentarios previos
-- leyendo author_id en una subconsulta, pero esa columna quedó
-- revocada para el cliente (anonimato) — Postgres devolvía
-- "permission denied" (42501) y la app lo mostraba como si el
-- alumno hubiera llegado al tope de 5 comentarios.
-- Solución: el conteo se hace en una función SECURITY DEFINER
-- que solo devuelve el número de comentarios PROPIOS del que
-- llama (no expone nada de otros).
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 13 · Arreglo tope comentarios
-- ============================================================

create or replace function public.my_tool_comment_count(tid uuid)
returns integer
language sql
security definer set search_path = public
stable
as $$
  select count(*)::int
  from public.tool_comments
  where tool_id = tid
    and author_id = auth.uid();
$$;

revoke execute on function public.my_tool_comment_count(uuid) from public, anon;
grant execute on function public.my_tool_comment_count(uuid) to authenticated;

drop policy "Students insert own tool comments" on public.tool_comments;

create policy "Students insert own tool comments"
on public.tool_comments for insert to authenticated
with check (
  auth.uid() = author_id
  and public.my_tool_comment_count(tool_id) < 5
);
