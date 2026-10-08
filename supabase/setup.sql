-- ============================================================
-- Sílabo IA · Configuración de autenticación
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1. Tabla de perfiles: vincula cada usuario con su código de alumno
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  student_code text unique not null,
  email text not null,
  full_name text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Cada alumno solo puede ver su propio perfil
create policy "Users can view own profile"
on public.profiles for select
using (auth.uid() = id);

create policy "Users can update own profile"
on public.profiles for update
using (auth.uid() = id);

-- 2. Trigger: crea el perfil automáticamente al registrarse.
--    El código de alumno llega en los metadatos del signUp.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, student_code, email)
  values (
    new.id,
    upper(trim(coalesce(new.raw_user_meta_data->>'student_code', ''))),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- El login por código se resuelve exclusivamente en la Edge Function auth-by-code.
