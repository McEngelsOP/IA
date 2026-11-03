import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { CARRERAS } from '../src/institutions/esan/carreras.js'
const admin='11111111-1111-4111-8111-111111111111',student='22222222-2222-4222-8222-222222222222',moderator='33333333-3333-4333-8333-333333333333'
import {setupDatabase} from './helpers/systemDatabase.mjs'
export {setupDatabase}
test('server validation, account isolation, scoped moderation and lossless version upgrade',async()=>{
 const {db,as}=await setupDatabase()
 try {
  assert.equal((await db.query('select count(*)::int n from curriculum_versions where catalog is not null')).rows[0].n,18)
  await as(student)
  await assert.rejects(()=>db.query('select save_lyra_preferences($1,$2)',[{theme:'dark'},admin]),/NO_AUTH/)
  await db.query('select save_lyra_preferences($1,$2)',[{theme:'light'},student])
  await db.query('select save_lyra_preferences($1,$2)',[{homeOrder:['stats','hero']},student])
  assert.deepEqual((await db.query('select values from student_preferences')).rows[0].values,{theme:'light',homeOrder:['stats','hero']})
  await assert.rejects(()=>db.query("insert into student_preferences(student_id) values($1)",[admin]),/row-level security/)
  await assert.rejects(()=>db.query('select save_lyra_preferences($1,$2)',[{is_admin:true},student]),/INVALID_PREFERENCES/)
  for(const call of ['service_dashboard()','set_moderator($1,\'esan\',\'academic\',true)']) await assert.rejects(()=>db.query('select '+call,call.includes('$1')?[student]:[]),/FORBIDDEN/)
  await db.query("insert into incident_reports(student_id,institution_id,category,body) values($1,'esan','academic','Curso que necesita revisión')",[student])
  await as(moderator)
  assert.equal((await db.query('select count(*)::int n from incident_reports')).rows[0].n,0)
  await as(admin)
  await assert.rejects(()=>db.query('select set_institution_grading($1,$2)',['bad',{kind:'numeric',min:null,max:null,passing:null,decimals:2,weighting:'credits'}]),/INVALID_GRADE_SCALE/)
  await db.query("select set_moderator($1,'esan','academic',true)",[moderator])
  await as(moderator)
  const report=(await db.query('select id from incident_reports')).rows[0]
  assert(report)
  await db.query("select resolve_report($1,'investigating')",[report.id])
  await assert.rejects(()=>db.query('select service_dashboard()'),/FORBIDDEN/)
  const next=structuredClone(CARRERAS.ia);next.version='test-next';next.sourceHash='verified-test-source';next.cursos.find(c=>c.id==='calc1').n='Cálculo I revisado'
  await db.query('select publish_curriculum($1,2027,$2)',[next,'Plan de prueba'])
  const bad=structuredClone(next);bad.version='bad-cycle';bad.cursos.find(c=>c.id==='mat0').r=['calc1']
  await assert.rejects(()=>db.query('select publish_curriculum($1,null,null)',[bad]),/CYCLIC_CURRICULUM/)
  bad.version='bad-reference';bad.cursos.find(c=>c.id==='mat0').r=['unknown']
  await assert.rejects(()=>db.query('select publish_curriculum($1,null,null)',[bad]),/UNKNOWN_PREREQUISITE/)
  bad.version='bad-credit';bad.cursos.find(c=>c.id==='mat0').r=[];bad.total=999
  await assert.rejects(()=>db.query('select publish_curriculum($1,null,null)',[bad]),/INVALID_TOTAL_CREDITS/)
  await as(student)
  await assert.rejects(()=>db.query("update profiles set curriculum_version='test-next' where id=$1",[student]),/CURRICULUM_ASSIGNMENT_LOCKED/)
  await db.query('select upgrade_curriculum($1,$2,$3)',[CARRERAS.ia.version,'test-next',student])
  assert.equal((await db.query('select curriculum_version from profiles')).rows[0].curriculum_version,'test-next')
  assert.equal((await db.query('select count(*)::int n from curriculum_transitions')).rows[0].n,1)
  await as(moderator)
  const renamed=structuredClone(next);renamed.version='test-renamed';renamed.cursos.forEach(c=>{if(c.id==='calc1')c.id='calculus1';c.r=c.r.map(id=>id==='calc1'?'calculus1':id)})
  await db.query('select publish_curriculum($1,2028,$2)',[renamed,'Plan con equivalencia'])
  await as(student)
  await assert.rejects(()=>db.query('select upgrade_curriculum($1,$2,$3)',['test-next','test-renamed',student]),/EQUIVALENCE_REVIEW_REQUIRED/)
  await as(moderator)
  await db.query('select set_curriculum_equivalences($1,$2,$3,$4,$5)',['esan','ia','test-next','test-renamed',{calc1:'calculus1'}])
  await as(student)
  await db.query('select upgrade_curriculum($1,$2,$3)',['test-next','test-renamed',student])
  assert.equal((await db.query('select count(*)::int n from curriculum_transitions')).rows[0].n,2)
  await as(admin)
  await db.query("select set_moderator($1,'esan','academic',false)",[moderator])
  await as(moderator)
  await assert.rejects(()=>db.query('select publish_curriculum($1,null,null)',[bad]),/FORBIDDEN/)
  await as('', 'anon')
  await assert.rejects(()=>db.query('select save_lyra_preferences($1,$2)',[{},student]),/permission denied/)
  await db.exec('reset role')
  await db.query("insert into grades(student_id,course_id,grade) values($1,'calc1',16)",[student])
  await assert.rejects(()=>db.query("insert into grades(student_id,course_id,grade) values($1,'prog1',70)",[student]),/GRADE_OUT_OF_SCALE/)
  await assert.rejects(()=>db.query("update curriculum_versions set catalog=jsonb_set(catalog,'{total}','999') where version='test-next'"),/IMMUTABLE_CURRICULUM/)
  const done=(await db.query('select done from progress where student_id=$1',[student])).rows[0].done
  assert.deepEqual(done,['calculus1'])
 }finally{await db.close()}
})
