-- ============================================================
-- Sílabo IA · Topes anti-spam en listas compartidas
-- Máximo 5 profesores agregados por alumno por curso y
-- 20 herramientas por alumno en total. Evita que un usuario
-- llene las listas en bucle desde la consola del navegador.
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 06 · Topes anti-spam
-- ============================================================

drop policy "Authenticated add professors" on public.professors;

create policy "Authenticated add professors"
on public.professors for insert to authenticated
with check (
  auth.uid() = created_by
  and (
    select count(*) from public.professors p
    where p.created_by = auth.uid()
      and p.course_id = professors.course_id
  ) < 5
);

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
