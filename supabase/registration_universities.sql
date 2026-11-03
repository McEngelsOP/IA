-- Selector de universidades y carreras disponibles en el registro de Lyra.
-- Ejecutar después de migrations/202611020002_universities.sql.
-- Solo publica nombres del catálogo aprobado; no expone perfiles ni borradores.
begin;

create or replace function public.registration_universities()
returns table(id text, name text, careers text[])
language sql stable security definer set search_path = ''
as $$
  select u.id, u.name,
    array(
      select distinct c.career_name
      from public.custom_curricula c
      where c.institution_id = u.id and c.status = 'approved'
      order by c.career_name
    ) as careers
  from public.universities u
  where u.status = 'approved'
  order by u.name;
$$;

revoke all on function public.registration_universities() from public;
grant execute on function public.registration_universities() to anon, authenticated;

commit;
notify pgrst, 'reload schema';

-- Verificación (solo nombres de universidades y carreras publicadas):
select * from public.registration_universities();
