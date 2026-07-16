-- ============================================================
-- Sílabo IA · Veces llevado: tope de 3 (antes 10)
-- Ajusta el CHECK de course_status.times_taken al rango 1–3,
-- que es el máximo real de veces que se puede llevar un curso.
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 17 · Veces llevado máx. 3
-- ============================================================

-- Por si alguna fila ya guardó un valor mayor (la app permitía hasta 10)
update public.course_status set times_taken = 3 where times_taken > 3;

alter table public.course_status
  drop constraint course_status_times_taken_check;

alter table public.course_status
  add constraint course_status_times_taken_check
  check (times_taken between 1 and 3);
