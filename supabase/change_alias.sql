-- ============================================================
-- Query 23 · ARCADE: Permitir cambiar el nombre secreto (alias)
-- ============================================================
-- 1. Eliminar el trigger que impide cambiar el alias desde la app
drop trigger if exists profiles_lock_alias on public.profiles;

-- 2. Función para propagar el cambio de alias a los comentarios y puntajes viejos
create or replace function public.sync_profile_alias()
returns trigger
language plpgsql
security definer
as $$
begin
  if old.alias is distinct from new.alias then
    -- Actualizar el alias en los puntajes del Arcade
    update public.game_scores
       set alias = new.alias
     where student_id = new.id;
     
    -- Actualizar el alias en los comentarios de herramientas
    update public.tool_comments
       set alias = new.alias
     where author_id = new.id;
     
    -- Actualizar el alias en las reseñas de cursos
    update public.course_comments
       set alias = new.alias
     where author_id = new.id;
  end if;
  return new;
end;
$$;

-- 3. Trigger para ejecutar la sincronización al actualizar el alias
drop trigger if exists profiles_sync_alias on public.profiles;
create trigger profiles_sync_alias
after update of alias on public.profiles
for each row execute procedure public.sync_profile_alias();
