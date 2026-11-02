create or replace function public.save_lyra_preferences(p_patch jsonb,p_owner uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or auth.uid() is distinct from p_owner then raise exception 'NO_AUTH' using errcode='42501'; end if;
 if jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text)>100000 or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('homeLayout','homeOrder','glow','diagnosis','theme','sidebar','focus','notifications')) then raise exception 'INVALID_PREFERENCES'; end if;
 if p_patch ? 'homeLayout' and (jsonb_typeof(p_patch->'homeLayout')<>'object' or octet_length((p_patch->'homeLayout')::text)>5000) then raise exception 'INVALID_LAYOUT'; end if;
 if p_patch ? 'theme' and p_patch->>'theme' not in ('light','dark') then raise exception 'INVALID_THEME'; end if;
 if p_patch ? 'sidebar' and p_patch->>'sidebar' not in ('full','rail') then raise exception 'INVALID_SIDEBAR'; end if;
 if p_patch ? 'homeOrder' and (jsonb_typeof(p_patch->'homeOrder')<>'array' or jsonb_array_length(p_patch->'homeOrder')>7 or exists(select 1 from jsonb_array_elements_text(p_patch->'homeOrder') k where k not in ('hero','hoy','stats','notas','racha','semestre','panel'))) then raise exception 'INVALID_ORDER'; end if;
 insert into public.student_preferences(student_id,values) values(auth.uid(),p_patch)
 on conflict(student_id) do update set values=student_preferences.values||excluded.values,updated_at=clock_timestamp()
 returning jsonb_build_object('values',values,'updated_at',updated_at) into result;
 return result;
end $$;
revoke all on function public.save_lyra_preferences(jsonb,uuid) from public,anon;
grant execute on function public.save_lyra_preferences(jsonb,uuid) to authenticated;


notify pgrst,'reload schema';
