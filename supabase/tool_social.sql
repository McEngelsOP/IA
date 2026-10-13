-- ============================================================
-- Sílabo IA · Likes y comentarios anónimos en herramientas
-- Cada alumno puede dar like a una herramienta (uno por persona)
-- y comentarla firmando con un "nombre secreto" (alias) que puede cambiar
-- desde su perfil. El anonimato es real: el alias lo estampa el
-- servidor y la columna author_id NO es legible desde el cliente
-- (permiso a nivel de columna), así nadie puede mapear alias → uuid
-- ni insertar comentarios a nombre de otro.
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Nombre sugerido de la query: 12 · Social de herramientas
-- ============================================================

-- 1. Nombre secreto del alumno (único y editable desde su perfil)
alter table public.profiles
  add column alias text
  check (alias is null or char_length(trim(alias)) between 3 and 24);

create unique index profiles_alias_uniq
  on public.profiles (lower(trim(alias)));

-- El alias es editable; change_alias.sql sincroniza sus comentarios y puntajes.
-- No recrear profiles_lock_alias ni lock_alias(): fueron retirados.

-- 2. Likes: uno por alumno por herramienta (PK compuesta)
create table public.tool_likes (
  tool_id uuid not null references public.tools(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (tool_id, student_id)
);

alter table public.tool_likes enable row level security;

create policy "Authenticated read tool likes"
on public.tool_likes for select to authenticated
using (true);

create policy "Students insert own tool like"
on public.tool_likes for insert to authenticated
with check (auth.uid() = student_id);

create policy "Students delete own tool like"
on public.tool_likes for delete to authenticated
using (auth.uid() = student_id);

-- 3. Comentarios anónimos (firmados con el alias)
create table public.tool_comments (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references public.tools(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  alias text not null,
  body text not null,
  created_at timestamptz default now(),
  constraint tool_comments_body_length check (char_length(trim(body)) between 2 and 300)
);

alter table public.tool_comments enable row level security;

create policy "Authenticated read tool comments"
on public.tool_comments for select to authenticated
using (true);

create policy "Students delete own tool comments"
on public.tool_comments for delete to authenticated
using (auth.uid() = author_id);

-- El alias lo estampa el servidor desde profiles: el cliente no puede
-- firmar con el alias de otro, y sin alias elegido no se puede comentar.
create or replace function public.stamp_comment_alias()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  select alias into new.alias from public.profiles where id = new.author_id;
  if new.alias is null then
    raise exception 'Elige tu nombre secreto antes de comentar';
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_comment_alias()
  from public, anon, authenticated;

create trigger tool_comments_stamp_alias
before insert on public.tool_comments
for each row execute procedure public.stamp_comment_alias();

-- 4. Anonimato a nivel de columna: nadie lee author_id ni escribe alias.
--    El cliente debe pedir columnas explícitas (select=*) fallaría —
--    la app ya lo hace así.
revoke select on public.tool_comments from anon, authenticated;
grant select (id, tool_id, alias, body, created_at)
  on public.tool_comments to authenticated;

revoke insert on public.tool_comments from anon, authenticated;
grant insert (tool_id, author_id, body)
  on public.tool_comments to authenticated;

revoke update on public.tool_comments from anon, authenticated;

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


create policy "Students insert own tool comments"
on public.tool_comments for insert to authenticated
with check (
  auth.uid() = author_id
  and public.my_tool_comment_count(tool_id) < 5
);
