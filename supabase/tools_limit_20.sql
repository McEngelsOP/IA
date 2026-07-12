-- ============================================================
-- Sílabo IA · Subir el tope de herramientas por alumno a 20
-- (antes 10, definido en la query 06 · Topes anti-spam)
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 14 · Tope herramientas a 20
-- ============================================================

drop policy "Authenticated add tools" on public.tools;

create policy "Authenticated add tools"
on public.tools for insert to authenticated
with check (
  auth.uid() = created_by
  and (
    select count(*) from public.tools t
    where t.created_by = auth.uid()
  ) < 20
);
