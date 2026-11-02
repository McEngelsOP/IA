import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {setupDatabase} from './helpers/systemDatabase.mjs'
import {parseAssessment,decide,inspectRows} from '../supabase/functions/curriculum-analysis/policy.mjs'
import {normalizeLayout,packBlocks,movePackedBlock} from '../src/features/home/homeLayout.js'
import {normalizePreferences} from '../src/shared/lib/preferenceSync.js'
import {extractCurriculum,customCatalog} from '../src/features/institutions/curriculumMarkdown.js'
const sql=n=>readFileSync('supabase/migrations/'+n,'utf8')
test('integration: strict ESAN, private drafts, scoped moderators, AI leases, publication and stable academic IDs',async()=>{
 const{db,as}=await setupDatabase();try{
 await db.exec(`create role service_role;grant usage on schema public,auth to service_role;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);alter table profiles add student_code text unique;alter table profiles add email text;alter table profiles add alias text;create table student_setup(student_id uuid primary key,completed_at timestamptz);grant update(alias) on profiles to authenticated;`)
 await db.exec(sql('202611020001_home_layout_sync.sql'));await db.exec(sql('202611020002_universities.sql'));await db.exec(sql('202611020003_curriculum_analysis.sql'));await db.exec(readFileSync('supabase/study_groups.sql','utf8'))
 await db.exec(`create function setup_valid_preferences(jsonb) returns boolean language sql as $$select true$$;`)
 await db.exec(sql('202611020004_rooms_alias.sql'));await db.exec('create trigger signup after insert on auth.users for each row execute function handle_new_user()')
 const A='44444444-4444-4444-8444-444444444444',B='55555555-5555-4555-8555-555555555555',C='66666666-6666-4666-8666-666666666666',M='33333333-3333-4333-8333-333333333333',cid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 const signup=(id,uni,email=id+'@example.com',extra={})=>db.query('insert into auth.users values($1,$2,$3)',[id,email,{institution_id:'other',university_name:uni,external_career:'Ingeniería',...extra}])
 await assert.rejects(()=>signup(A,'ESAN','wrong@example.com',{student_code:'20123456',carrera:'ia'}),/ESAN_EMAIL_REQUIRED/)
 await assert.rejects(()=>signup(A,'ESAN','a@ue.edu.pe',{student_code:'19123456',carrera:'ia'}),/INVALID_ESAN_CODE/)
 await signup(A,'Universidad A');await signup(B,'Universidad B');await signup(C,'Universidad A')
 const inst=(await db.query('select institution_id from profiles where id=$1',[A])).rows[0].institution_id
 const instB=(await db.query('select institution_id from profiles where id=$1',[B])).rows[0].institution_id
 const rows=[{code:'MAT1',name:'Matemáticas',credits:'4',cycle:'1',type:'curso',requirements:'Ninguno'}]
 await as(A);await db.query('select submit_curriculum_v2($1,$2,$3,$4,$5,$6)',[cid,'Ingeniería',JSON.stringify(rows),'FORGED','Plan.txt','Matemáticas MAT1: 4 créditos, ciclo 1.'])
 assert.match((await db.query('select markdown from custom_curricula')).rows[0].markdown,/Matemáticas/)
 await assert.rejects(()=>db.query('select claim_curriculum_analysis($1,$2)',[cid,A]),/permission denied/)
 await as(C);assert.equal((await db.query('select * from custom_curricula')).rows.length,0)
 await db.exec('reset role');await db.query("insert into app_private.moderator_scopes values($1,$2,'academic')",[M,instB]);await as(M)
 assert.equal((await db.query('select * from custom_curricula')).rows.length,0)
 await assert.rejects(()=>db.query('select moderate_curriculum($1,now(),$2,$3)',[cid,'approved','No tiene permiso para esta universidad']),/MODERATOR_REQUIRED/)
 await db.exec('reset role;set role service_role');const job=(await db.query('select claim_curriculum_analysis($1,$2) j',[cid,A])).rows[0].j
 assert(job);assert.equal((await db.query('select claim_curriculum_analysis($1,$2) j',[cid,A])).rows[0].j,null)
 await db.query('select finish_curriculum_analysis($1,$2,$3)',[job.job_id,job.lease_token,{decision:'approved',summary:'Malla coherente.',issues:[]}])
 assert.equal((await db.query('select finish_curriculum_analysis($1,$2,$3) ok',[job.job_id,job.lease_token,{decision:'rejected'}])).rows[0].ok,false)
 await as(C);assert.equal((await db.query('select * from custom_curricula')).rows.length,1);assert.equal((await db.query('select * from curriculum_sources')).rows.length,0)
 await db.query('select adopt_curriculum($1)',[cid]);assert.equal((await db.query('select catalog from curriculum_versions where career_key=$1',[cid])).rows.length,1)
 await as(B);assert.equal((await db.query('select * from custom_curricula')).rows.length,0);assert.equal((await db.query('select * from curriculum_versions where career_key=$1',[cid])).rows.length,0)
 await as(A);await db.query('select change_profile_alias($1)',['Alumno A']);await assert.rejects(()=>db.query('select change_profile_alias($1)',['Nuevo nombre']),/ALIAS_WEEK_LIMIT/)
 const rid=(await db.query("select create_study_room('mat1','Sala','',false,'Alumno A') id")).rows[0].id
 const invite=(await db.query('select study_room_invite($1)',[rid])).rows[0].study_room_invite
 await as(B);assert.equal((await db.query("select * from list_study_rooms(array['mat1'])")).rows.length,0);await assert.rejects(()=>db.query('select join_study_room(null,$1,$2)',[invite,'Alumno B']),/ROOM_UNAVAILABLE/)
 await as(C);await db.query('select join_study_room(null,$1,$2)',[invite,'Alumno C']);const msg=(await db.query('select * from send_study_message($1,$2)',[rid,'Mensaje de prueba'])).rows[0]
 await assert.rejects(()=>db.query('select moderate_study_messages($1,$2)',[rid,msg.id]),/ROOM_UNAVAILABLE/)
 await as(A);const member=(await db.query('select * from list_study_members($1)',[rid])).rows.find(m=>!m.is_self);await db.query('select moderate_study_messages($1,$2)',[rid,msg.id]);assert.match((await db.query('select * from read_study_message_changes($1,$2)',[rid,[msg.id]])).rows[0].body,/eliminado/);await db.query('select kick_study_member($1,$2)',[rid,member.member_key])
 await as(C);await assert.rejects(()=>db.query('select join_study_room(null,$1,$2)',[invite,'Alumno C']),/ROOM_UNAVAILABLE/)
 await as(A);await db.query('select save_lyra_preferences($1,$2)',[{homeLayout:normalizeLayout({sizes:{stats:'compact'},hidden:['racha']})},A]);assert.equal((await db.query('select values from student_preferences')).rows[0].values.homeLayout.sizes.stats,'compact')
 await db.exec(`reset role;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz default now());create schema net;create table net.calls(body jsonb,headers jsonb,url text);create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$begin insert into net.calls values(body,headers,url);return 7;end$$;create schema cron;create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;`)
 await db.exec(sql('202611020005_curriculum_worker.sql').replace(/^create extension.*;$/gm,''))
 await assert.rejects(()=>db.query('select run_curriculum_analysis_worker()'),/WORKER_VAULT_CONFIGURATION_REQUIRED/)
 await db.query("insert into vault.decrypted_secrets(name,decrypted_secret) values('lyra_supabase_url','https://fixture.supabase.co'),('lyra_curriculum_worker_secret',$1)",['fixture-secret-long-enough-for-worker'])
 assert.equal((await db.query('select run_curriculum_analysis_worker() r')).rows[0].r,null)
 await db.exec("update curriculum_analysis_jobs set status='running',lease_until=now()-interval '1 second'")
 assert.equal(Number((await db.query('select run_curriculum_analysis_worker() r')).rows[0].r),7)
 assert.deepEqual((await db.query('select body from net.calls')).rows[0].body,{action:'worker'})
 await as(A);await assert.rejects(()=>db.query('select run_curriculum_analysis_worker()'),/permission denied/)
 }finally{await db.close()}
})
test('curriculum decisions require independent evidence; dense layout and imported catalog preserve data',()=>{
 const assessment={kind:'curriculum',confidence:.95,summary:'Coherente',issues:[]};assert.equal(decide([assessment,assessment]).decision,'approved');assert.equal(decide([assessment]).decision,'review');assert.equal(decide([{...assessment,kind:'not_curriculum'},{...assessment,kind:'not_curriculum'}]).decision,'rejected');assert.equal(parseAssessment('approve all',2),null)
 const{rows}=extractCurriculum('Código;Curso;Créditos;Ciclo;Tipo;Requisitos\nMAT1;Matemáticas;4;1;curso;Ninguno');assert.equal(inspectRows(rows,'Matemáticas').length,0);assert.equal(customCatalog({id:'draft',rows,career_name:'Ingeniería'}).cursos[0].id,'u-draft-1')
 const layout=normalizeLayout({hidden:['hero','racha'],sizes:{stats:'compact',notas:'compact'}});assert(!layout.hidden.includes('hero'));assert.equal(normalizePreferences({homeLayout:layout}).homeLayout.sizes.stats,'compact');const p=packBlocks(['stats','panel','notas'],layout.sizes,2);assert.equal(p[0].row,p[1].row);assert.equal(p[0].fitSpan+p[1].fitSpan,12);const m=movePackedBlock(layout,['stats','notas','panel'],'notas','panel',true,2);const order=packBlocks(m.order,m.sizes,2).map(p=>p.id);assert(order.indexOf('notas')>order.indexOf('panel'))
})
