-- Run inside a transaction and ROLLBACK. Creates only temporary fixture users.
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); resource uuid; room uuid; response jsonb; professor uuid; result text; attempts integer;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (a,a::text||'@deberes-test.invalid',jsonb_build_object('student_code','26'||lpad((100000+floor(random()*800000))::int::text,6,'0'),'carrera','ia')),
    (b,b::text||'@deberes-test.invalid',jsonb_build_object('student_code','26'||lpad((100000+floor(random()*800000))::int::text,6,'0'),'carrera','ia'));
  perform set_config('request.jwt.claim.sub',a::text,true);
  set local role authenticated;
  update public.profiles set full_name='Fixture temporal',alias='Test'||left(a::text,12) where id=a;
  begin update public.profiles set is_admin=true where id=a; raise exception 'TEST_ADMIN_WRITE_ALLOWED'; exception when insufficient_privilege then null; end;
  begin update public.profiles set chat_blocked_until=null where id=a; raise exception 'TEST_BLOCK_WRITE_ALLOWED'; exception when insufficient_privilege then null; end;
  resource:=public.publish_resource('Recurso de prueba','https://'||a::text||'.example.com/?b=2&a=1','Organiza apuntes para estudiar en grupo.');
  begin perform public.publish_resource('Duplicado','http://www.'||a::text||'.example.com/?utm_source=test&a=1&b=2#fragmento',''); raise exception 'TEST_DUPLICATE_ALLOWED'; exception when raise_exception then if sqlerrm<>'RESOURCE_DUPLICATE' then raise; end if; end;
  begin perform public.publish_resource('Comentario largo','https://long.'||a::text||'.example.com',repeat('palabra ',26)); raise exception 'TEST_LONG_COMMENT_ALLOWED'; exception when raise_exception then if sqlerrm<>'RESOURCE_DESCRIPTION' then raise; end if; end;
  perform public.edit_resource_description(resource,'Comentario del autor actualizado.');
  response:=public.resource_page(a::text,'recent',0);
  if (response->>'total')::int<>1 or not (response->'items'->0->>'is_owner')::boolean then raise exception 'TEST_RESOURCE_PAGE_FAILED'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  begin perform public.edit_resource_description(resource,'Comentario de otro usuario.'); raise exception 'TEST_FOREIGN_EDIT_ALLOWED'; exception when raise_exception then if sqlerrm<>'RESOURCE_NOT_OWNED' then raise; end if; end;
  response:=public.toggle_resource_heart(resource);
  if not (response->>'liked')::boolean or (response->>'hearts')::int<>1 then raise exception 'TEST_HEART_ADD_FAILED'; end if;
  response:=public.toggle_resource_heart(resource);
  if (response->>'liked')::boolean or (response->>'hearts')::int<>0 then raise exception 'TEST_HEART_REMOVE_FAILED'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  insert into public.professors(course_id,name,created_by) values('calc1','PROFESOR '||upper(a::text),a) returning id into professor;
  insert into public.professor_tags values(professor,a,'fija',now()),(professor,a,'aprender',now()),(professor,a,'didactico',now());
  begin insert into public.professor_tags values(professor,a,'relajo',now()); raise exception 'TEST_FOUR_TAGS_ALLOWED'; exception when check_violation then null; when raise_exception then if sqlerrm<>'TAG_LIMIT' then raise; end if; end;
  insert into public.course_difficulty_votes(course_id,student_id,rating) values('calc1',a,4) on conflict(course_id,student_id) do update set rating=4;
  if (public.get_course_difficulty_stats('calc1')->>'user_rating')::int<>4 then raise exception 'TEST_RATING_FAILED'; end if;
  room:=public.create_study_room('calc1','Sala de prueba','',false,'Fixture',gen_random_uuid());
  response:=public.send_moderated_study_message(room,'Podemos repasar juntos el ejercicio.',gen_random_uuid());
  if not (response->>'allowed')::boolean or response->'messages'->0->>'body'<>'Podemos repasar juntos el ejercicio.' then raise exception 'TEST_CLEAN_MESSAGE_FAILED'; end if;
  for attempts in 1..3 loop
    response:=public.send_moderated_study_message(room,'idiota',gen_random_uuid());
    if (response->>'allowed')::boolean then raise exception 'TEST_PROFANITY_ALLOWED'; end if;
  end loop;
  if response->>'error'<>'CHAT_SUSPENDED' then raise exception 'TEST_THREE_STRIKES_FAILED'; end if;
  response:=public.send_moderated_study_message(room,'Ahora quiero enviar otro mensaje.',gen_random_uuid());
  if response->>'error'<>'CHAT_SUSPENDED' then raise exception 'TEST_SUSPENSION_BYPASSED'; end if;
  begin perform app_private.send_study_message(room,'Bypass',gen_random_uuid()); raise exception 'TEST_RAW_SEND_ALLOWED'; exception when insufficient_privilege then null; end;
  reset role;
  if (select count(*) from public.chat_moderation_logs where user_id=a)<>3 then raise exception 'TEST_STRIKES_NOT_RETAINED'; end if;
  if not exists(select 1 from public.profiles where id=a and chat_blocked_until>now()) then raise exception 'TEST_BLOCK_NOT_RETAINED'; end if;
end $$;
