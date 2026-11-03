-- Apply manually after 202611020002_universities.sql and 202611020003_curriculum_analysis.sql.
-- Course names, credits and cycles are required; codes and prerequisites are optional. Existing rows, progress and published versions stay intact.
begin;
create or replace function public.validate_curriculum_rows(items jsonb) returns void
language plpgsql set search_path='' as $$
declare item jsonb;
begin
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 400 then raise exception 'INVALID_CURRICULUM';end if;
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item)<>'object'
   or length(trim(coalesce(item->>'code','')))>40
   or coalesce(length(trim(item->>'name')),0) not between 2 and 180
   or coalesce(trim(item->>'credits'),'') !~ '^[0-9]+(\.[0-9]+)?$'
   or (item->>'credits')::numeric not between 0 and 40
   or coalesce(trim(item->>'cycle'),'') !~ '^[0-9]{1,2}$'
   or (item->>'cycle')::int not between 0 and 20
   or coalesce(nullif(trim(item->>'type'),''),'curso') not in ('curso','taller','electivo')
   or length(trim(coalesce(item->>'requirements','')))>800
  then raise exception 'INVALID_CURRICULUM_ROW';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(items) a(v)
   where nullif(trim(v->>'code'),'') is not null
   group by lower(trim(v->>'code')) having count(*)>1)
 then raise exception 'DUPLICATE_COURSE';end if;
end $$;
revoke all on function public.validate_curriculum_rows(jsonb) from public,anon,authenticated;

create or replace function public.revise_curriculum(p_curriculum uuid,p_career text,p_rows jsonb,p_source text,p_source_text text,p_source_url text default '') returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.custom_curricula; uni text;
begin
 if auth.uid() is null then raise exception 'NO_AUTH'; end if;
 perform pg_advisory_xact_lock(310004);
 select university_name into uni from public.profiles where id=auth.uid() for update;
 select * into c from public.custom_curricula where id=p_curriculum and owner_id=auth.uid() for update;
 if c.id is null then raise exception 'CURRICULUM_UNAVAILABLE'; end if;
 if c.status='approved' then raise exception 'CURRICULUM_ALREADY_APPROVED'; end if;
 if exists(select 1 from public.curriculum_analysis_jobs where curriculum_id=c.id and status<>'completed') then raise exception 'ANALYSIS_BUSY'; end if;
 if p_career is null or char_length(trim(p_career)) not between 2 and 120 or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 400 or p_source is null or char_length(p_source)>255 or p_source_text is null or char_length(p_source_text)>180000 then raise exception 'INVALID_CURRICULUM'; end if;
 perform public.validate_curriculum_rows(p_rows);
 -- Row positions are academic IDs. Never silently remap an existing student's progress.
 if (exists(select 1 from public.student_setup where student_id=auth.uid() and completed_at is not null) or exists(select 1 from public.course_status where student_id=auth.uid()) or exists(select 1 from public.grades where student_id=auth.uid()) or exists(select 1 from public.progress where student_id=auth.uid() and (cardinality(done)>0 or cardinality(plan)>0))) and
 (select jsonb_agg(case when nullif(trim(v->>'code'),'') is not null then 'code:'||lower(trim(v->>'code')) else 'name:'||lower(trim(v->>'name')) end order by n) from jsonb_array_elements(c.rows) with ordinality a(v,n)) is distinct from
 (select jsonb_agg(case when nullif(trim(v->>'code'),'') is not null then 'code:'||lower(trim(v->>'code')) else 'name:'||lower(trim(v->>'name')) end order by n) from jsonb_array_elements(p_rows) with ordinality a(v,n)) then raise exception 'COURSE_IDS_LOCKED'; end if;
 update public.custom_curricula set career_name=trim(p_career),rows=p_rows,markdown=public.curriculum_to_markdown(uni,p_career,p_rows,p_source),source_name=p_source,source_url=coalesce(trim(p_source_url),''),status='pending',validation_state='draft',updated_at=clock_timestamp() where id=c.id;
 insert into public.curriculum_review_log(curriculum_id,actor_id,actor_kind,decision,note,evidence) values(c.id,auth.uid(),'student','revised','Nueva versión enviada.',jsonb_build_object('previous_rows',c.rows,'previous_source',(select source_text from public.curriculum_sources where curriculum_id=c.id),'previous_analysis',c.analysis_summary));
 insert into public.curriculum_sources values(c.id,p_source_text) on conflict(curriculum_id) do update set source_text=excluded.source_text;
 perform public.request_curriculum_analysis(c.id);
end $$;
revoke all on function public.revise_curriculum(uuid,text,jsonb,text,text,text) from public,anon;
grant execute on function public.revise_curriculum(uuid,text,jsonb,text,text,text) to authenticated;


create or replace function public.promote_custom_curriculum() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare courses jsonb:='[]';cycles jsonb:='{}';item jsonb;idx int:=0;req text;refs jsonb;known boolean;catalog jsonb;hash text:=md5(new.rows::text);begin
 if new.status<>'approved' or old.status='approved' then return new;end if;
 for item in select value from jsonb_array_elements(new.rows) loop
 idx:=idx+1;req:=trim(coalesce(item->>'requirements',''));
 select coalesce(jsonb_agg('u-'||new.id::text||'-'||n),'[]') into refs from jsonb_array_elements(new.rows) with ordinality a(v,n) where nullif(trim(v->>'code'),'') is not null and lower(trim(v->>'code')) in(select lower(trim(x)) from regexp_split_to_table(req,'[,;]') x);
 known:=lower(req) in ('ninguno','sin requisitos','no aplica') or (req<>'' and jsonb_array_length(refs)=(select count(*) from regexp_split_to_table(req,'[,;]') x));
 courses:=courses||jsonb_build_array(jsonb_build_object('id','u-'||new.id::text||'-'||idx,'n',item->>'name','code',coalesce(item->>'code',''),'cr',(item->>'credits')::numeric,'c',coalesce(nullif(trim(item->>'cycle'),'')::int,0),'type',coalesce(nullif(trim(item->>'type'),''),'curso'),'r',case when known then refs else '[]' end,'prerequisitesKnown',known)||case when known then '{}'::jsonb else jsonb_build_object('requirementNote',coalesce(nullif(req,''),'Prerrequisitos no indicados en la fuente.')) end);
 cycles:=cycles||jsonb_build_object(coalesce(nullif(trim(item->>'cycle'),''),'0'),jsonb_build_object('t',case when coalesce(nullif(trim(item->>'cycle'),''),'0')::int<>0 then 'Ciclo '||(item->>'cycle') when exists(select 1 from jsonb_array_elements(new.rows) a(v) where nullif(trim(v->>'cycle'),'') is null) then 'Sin ciclo indicado' else 'Formación adicional' end,'s','Malla aportada'));
 end loop;
 catalog:=jsonb_build_object('key',new.id::text,'version',new.id::text,'institutionId',new.institution_id,'nombre',new.career_name,'uni',(select name from universities where id=new.institution_id),'source',new.source_name,'sourceHash',hash,'total',(select sum((v->>'credits')::numeric) from jsonb_array_elements(new.rows) a(v)),'cursos',courses,'ciclos',cycles,'foot','Malla aportada y revisada por coherencia. Confirma vigencia con tu universidad.');
 insert into curriculum_versions(institution_id,career_key,version,source_hash,source_document,catalog,published_at) values(new.institution_id,new.id::text,new.id::text,hash,new.source_name,catalog,now()) on conflict do nothing;return new;end$$;

commit;
notify pgrst,'reload schema';
