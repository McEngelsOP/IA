import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setupDatabase } from './helpers/systemDatabase.mjs'
import { extractCurriculum, validateRows, curriculumMarkdown, customCatalog } from '../src/features/institutions/curriculumMarkdown.js'
import { inspectRows, decide, SYSTEM } from '../supabase/functions/curriculum-analysis/policy.mjs'

const source = 'Curso;Créditos;Ciclo\nMatemáticas;4;1\nBiología;3,5;2'
const { rows } = extractCurriculum(source)

test('names, credits and cycles import and round trip without invented codes or prerequisites', () => {
  assert.equal(validateRows(rows), '')
  assert.equal(rows[1].credits, '3.5')
  assert(rows.every(r => r.code === '' && r.requirements === '' && r.cycle !== ''))
  const markdown = curriculumMarkdown({ university: 'Universidad Prueba', career: 'Medicina', rows })
  assert(!markdown.includes('Por verificar'))
  assert.deepEqual(extractCurriculum(markdown).rows, rows)
  assert.equal(validateRows([{ name: 'Matemáticas', credits: 4, cycle: 1 }, { name: 'Biología', credits: 3.5, cycle: 2 }]), '')
  const catalog = customCatalog({ id: 'draft', rows, career_name: 'Medicina' })
  assert.equal(catalog.total, 7.5)
  assert.equal(catalog.ciclos[1].t, 'Ciclo 1')
  assert.deepEqual(catalog.cursos.map(c => c.id), ['u-draft-1', 'u-draft-2'])
  assert(catalog.cursos.every(c => c.r.length === 0 && !c.prerequisitesKnown))
})

test('required values and invalid supplied optional values still produce actionable errors', () => {
  for (const [patch, pattern] of [
    [{ name: '' }, /nombre/], [{ credits: '' }, /créditos/], [{ credits: '-1' }, /créditos/],
    [{ credits: '41' }, /créditos/], [{ cycle: '' }, /ciclo/], [{ cycle: undefined }, /ciclo/], [{ cycle: '21' }, /ciclo/], [{ cycle: 'primero' }, /ciclo/],
    [{ code: 'x'.repeat(41) }, /código/], [{ requirements: 'x'.repeat(801) }, /requisitos/],
  ]) assert.match(validateRows([{ ...rows[0], ...patch }]), pattern)
  assert.match(validateRows(rows.map(r => ({ ...r, code: 'MAT1' }))), /único/)
  assert.equal(validateRows([{ ...rows[0], credits: '0' }]), '')
})

test('AI rules accept absent prerequisites but retain contradictions in supplied relationships', () => {
  assert.deepEqual(inspectRows(rows, source), [])
  const assessment = { kind: 'curriculum', confidence: .95, summary: 'Coherente', issues: [] }
  assert.equal(decide([assessment, assessment], inspectRows(rows, source)).decision, 'approved')
  assert.match(SYSTEM, /Código, tipo y prerrequisitos son opcionales/)
  const linked = [{ ...rows[0], code: 'MAT1', cycle: '2' }, { ...rows[1], code: 'BIO1', cycle: '', requirements: 'MAT1' }]
  assert.deepEqual(inspectRows(linked, source), []) // Missing cycle is not cycle zero.
  linked[1].cycle = '1'
  assert(inspectRows(linked, source).some(i => /posterior/.test(i.message)))
  linked[0].requirements = 'MAT1'
  assert(inspectRows(linked, source).some(i => /sí mismo/.test(i.message)))
})

test('SQL accepts optional fields on submit and revision, publishes stable IDs and protects progress', async () => {
  const { db, as } = await setupDatabase()
  const owner = '44444444-4444-4444-8444-444444444444', other = '55555555-5555-4555-8555-555555555555'
  const cid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  try {
    await db.exec(`create role service_role;alter table profiles add student_code text;alter table profiles add email text;alter table profiles add alias text;create table student_setup(student_id uuid primary key,completed_at timestamptz);`)
    for (const name of ['202611020002_universities.sql', '202611020003_curriculum_analysis.sql']) await db.exec(readFileSync('supabase/migrations/' + name, 'utf8'))
    const patch = readFileSync('supabase/curriculum_optional_fields.sql', 'utf8')
    await db.exec(patch)
    await db.exec(patch) // Manual activation is safe to repeat.
    await db.exec(`insert into universities(id,name,status) values('u-test','Universidad Prueba','approved');insert into profiles(id,institution_id,university_name) values('${owner}','u-test','Universidad Prueba'),('${other}','u-test','Universidad Prueba');`)
    for (const invalid of [[{ ...rows[0], name: '' }], [{ ...rows[0], credits: '' }], [{ ...rows[0], credits: 41 }], [{ ...rows[0], cycle: '' }], [{ name: 'Matemáticas', credits: 4 }], rows.map(r => ({ ...r, code: 'MAT1' }))]) {
      await assert.rejects(() => db.query('select validate_curriculum_rows($1)', [invalid]), /INVALID_CURRICULUM_ROW|DUPLICATE_COURSE/)
    }
    await db.query('select validate_curriculum_rows($1)', [[{ name: 'Matemáticas', credits: 4, cycle: 1 }, { name: 'Biología', credits: 3.5, cycle: 2 }]])
    await as(owner)
    await assert.rejects(() => db.query('select validate_curriculum_rows($1)', [rows]), /permission denied/)
    await db.query('select submit_curriculum_v2($1,$2,$3,$4,$5,$6)', [cid, 'Medicina', rows, '', 'Malla.txt', source])
    await as(other)
    assert.equal((await db.query('select * from custom_curricula')).rows.length, 0)
    await assert.rejects(() => db.query('select revise_curriculum($1,$2,$3,$4,$5)', [cid, 'Medicina', rows, 'Malla.txt', source]), /CURRICULUM_UNAVAILABLE/)
    await db.exec("reset role;update curriculum_analysis_jobs set status='completed',created_at=now()-interval '10 minutes';")
    await as(owner)
    const revised = rows.map(r => ({ ...r, credits: '5' }))
    await db.query('select revise_curriculum($1,$2,$3,$4,$5)', [cid, 'Medicina', revised, 'Malla.txt', source])
    await db.exec("reset role;update curriculum_analysis_jobs set status='completed',created_at=now()-interval '10 minutes';")
    await db.query('insert into student_setup values($1,now())', [owner])
    await as(owner)
    await assert.rejects(() => db.query('select revise_curriculum($1,$2,$3,$4,$5)', [cid, 'Medicina', [...revised].reverse(), 'Malla.txt', source]), /COURSE_IDS_LOCKED/)
    await db.exec("reset role;update custom_curricula set status='approved';")
    const catalog = (await db.query('select catalog from curriculum_versions where career_key=$1', [cid])).rows[0].catalog
    const draft = customCatalog({ id: cid, rows: revised, career_name: 'Medicina' })
    assert.deepEqual(catalog.cursos, draft.cursos)
    assert.deepEqual(catalog.ciclos, draft.ciclos)
    assert.equal(catalog.total, 10)
  } finally { await db.close() }
})
