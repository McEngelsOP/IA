-- ============================================================
-- Query 28 · Estadísticas anónimas agregadas por curso
-- ============================================================
-- Para el medidor de carga del planificador: cuántos alumnos
-- registraron cada curso en su ficha y cuántos lo aprobaron a la
-- primera. SOLO devuelve agregados y SOLO si el curso tiene 5 o
-- más registros (umbral de anonimato: con menos, alguien podría
-- ser identificable). course_status sigue siendo privada; esta
-- función SECURITY DEFINER es la única ventana, y nunca expone
-- filas individuales ni student_id.
-- El frontend funciona sin esta query (el medidor solo omite la
-- señal de cursos exigentes), pero correrla ANTES del deploy
-- evita errores en la consola.

create or replace function public.stats_cursos(cids text[])
returns table (course_id text, registros bigint, aprobados_primera bigint)
language sql
stable
security definer
set search_path = public
as $$
  select cs.course_id,
         count(*) as registros,
         count(*) filter (
           where cs.status in ('aprobado', 'convalidado') and cs.times_taken = 1
         ) as aprobados_primera
    from public.course_status cs
   where cs.course_id = any(cids)
   group by cs.course_id
  having count(*) >= 5
$$;

revoke execute on function public.stats_cursos(text[]) from public, anon;
grant execute on function public.stats_cursos(text[]) to authenticated;
