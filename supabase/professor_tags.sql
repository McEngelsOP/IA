-- ============================================================
-- Sílabo IA · Etiquetas de profesores
-- Cada alumno puede poner hasta tres etiquetas distintas por profesor
-- (cambiable o quitable): estricto pero bueno, para aprender,
-- relajo, etc. Se muestran como conteos junto a los corazones.
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 18 · Etiquetas de profesores
-- Correr ANTES de desplegar el frontend que las usa (la lista
-- de profesores hace join a esta tabla; sin ella, falla).
-- ============================================================

create table public.professor_tags (
  professor_id uuid not null references public.professors(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  tag text not null check (tag in (
    'estricto-bueno',  -- Estricto pero bueno
    'estricto-mal',    -- Estricto para mal
    'pasa',            -- Pasa por pasar
    'aprender',        -- Para aprender
    'relajo',          -- Relajo
    'balance'          -- Balance
  )),
  updated_at timestamptz default now(),
  primary key (professor_id, student_id, tag)
);

alter table public.professor_tags enable row level security;

create policy "Authenticated read professor tags"
on public.professor_tags for select to authenticated
using (true);

create policy "Students delete own professor tag"
on public.professor_tags for delete to authenticated
using (auth.uid() = student_id);

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
