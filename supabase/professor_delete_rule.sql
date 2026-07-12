-- ============================================================
-- Sílabo IA · Borrado de profesores: propiedad que expira
-- El creador puede borrar su entrada SOLO mientras ningún otro
-- alumno haya votado. En cuanto alguien más vota, la entrada
-- pasa a ser de la comunidad y solo el administrador (Table
-- Editor) puede eliminarla. Los votos propios no la "sellan".
--
-- Las herramientas no cambian: siguen con borrado del creador.
--
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 09 · Borrado profesor sin votos ajenos
-- (Saldrá el aviso de "destructive operation" por el drop policy:
--  solo reemplaza la regla de permiso, no toca ningún dato.)
-- ============================================================

drop policy "Creators delete own professors" on public.professors;

create policy "Creators delete own professors"
on public.professors for delete to authenticated
using (
  auth.uid() = created_by
  and not exists (
    select 1 from public.professor_votes v
    where v.professor_id = professors.id
      and v.student_id <> auth.uid()
  )
);
