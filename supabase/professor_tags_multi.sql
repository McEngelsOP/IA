-- ============================================================
-- Sílabo IA · Etiquetas de profesores: varias por alumno
-- Antes cada alumno podía marcar UNA etiqueta por profesor;
-- ahora puede marcar hasta 3 distintas (cada una suma a su
-- conteo ×1, ×2, ×3…). La PK pasa a incluir la etiqueta.
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 19 · Varias etiquetas por profesor
-- Correr ANTES de desplegar el frontend que lo usa.
-- ============================================================

alter table public.professor_tags
  drop constraint professor_tags_pkey;

alter table public.professor_tags
  add primary key (professor_id, student_id, tag);

-- Tope anti-ruido: máximo 3 etiquetas por alumno por profesor.
-- (Aquí sí se puede contar con subconsulta directa: student_id es
-- legible por cualquier authenticated, a diferencia de author_id
-- en los comentarios anónimos.)
drop policy "Students insert own professor tag" on public.professor_tags;

create policy "Students insert own professor tag"
on public.professor_tags for insert to authenticated
with check (
  auth.uid() = student_id
  and (
    select count(*) from public.professor_tags t
    where t.professor_id = professor_tags.professor_id
      and t.student_id = auth.uid()
  ) < 3
);

-- Ya no se "cambia" una etiqueta (se agrega o se quita): la política
-- de update sobra.
drop policy "Students update own professor tag" on public.professor_tags;
