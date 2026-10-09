-- Diagnóstico de solo lectura. Una consulta devuelve todas las secciones en el SQL Editor.
-- No consulta registros de usuarios ni cambia tablas, permisos o triggers.
with targets(name) as (
  values ('profiles'),('progress'),('calendar_events'),('calendar_tasks'),
         ('study_rooms'),('study_room_members'),('study_messages'),('study_room_messages'),('focus_study_sessions')
), functions as (
  select p.oid, n.nspname, p.proname,
         case when p.prokind in ('f','p') then pg_get_functiondef(p.oid) else '' end as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
)
select 'table' as section, 'public.'||t.name as object_name,
       jsonb_build_object(
         'exists', to_regclass(format('public.%I',t.name)) is not null,
         'columns', coalesce((
           select jsonb_agg(jsonb_build_object('name',c.column_name,'type',c.udt_name,'nullable',c.is_nullable) order by c.ordinal_position)
           from information_schema.columns c
           where c.table_schema='public' and c.table_name=t.name
         ),'[]'::jsonb)
       ) as details
from targets t
union all
select 'event_trigger', e.evtname,
       jsonb_build_object('enabled',e.evtenabled,'event',e.evtevent,'tags',e.evttags,
                          'function',n.nspname||'.'||p.proname,
                          'mentions_room_id',position('room_id' in pg_get_functiondef(p.oid))>0)
from pg_event_trigger e
join pg_proc p on p.oid=e.evtfoid
join pg_namespace n on n.oid=p.pronamespace
union all
select 'function_referencing_room_id', f.nspname||'.'||f.proname,
       jsonb_build_object('signature',f.oid::regprocedure::text)
from functions f where position('room_id' in f.definition)>0
order by section,object_name;
