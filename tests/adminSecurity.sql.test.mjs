import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

test('admin RPCs deny anonymous callers, missing profiles and ordinary students', async () => {
  const db = new PGlite()
  const admin = '11111111-1111-4111-8111-111111111111'
  const student = '22222222-2222-4222-8222-222222222222'
  const missing = '33333333-3333-4333-8333-333333333333'
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated;
      create table profiles(id uuid primary key,student_code text,email text,carrera text,alias text,created_at timestamptz default now());`)
    await db.exec(readFileSync('supabase/admin_panel.sql', 'utf8'))
    const migration = readdirSync('supabase/migrations').find(p => p.endsWith('_admin_authorization_hardening.sql'))
    const sql = readFileSync('supabase/migrations/' + migration, 'utf8')
    await db.exec(sql); await db.exec(sql)
    await db.exec(`insert into profiles(id,is_admin) values('${admin}',true),('${student}',false);`)
    const as = async id => db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`)
    const denied = ['admin_get_users()', 'admin_get_all_comments()', 'admin_get_stats()',
      `admin_update_user_carrera('${student}','ia')`, `admin_clear_user_alias('${student}')`,
      `admin_delete_comment('${student}','course')`]
    for (const id of ['', missing, student]) {
      await as(id)
      assert.equal((await db.query('select is_app_admin() allowed')).rows[0].allowed, false)
      for (const call of denied) await assert.rejects(() => db.query('select ' + call), /Acceso denegado/)
    }
    await as(admin)
    assert.equal((await db.query('select is_app_admin() allowed')).rows[0].allowed, true)
    assert.equal((await db.query('select * from admin_get_users()')).rows.length, 2)
    await db.exec('reset role;set role anon;')
    for (const call of [...denied, 'is_app_admin()']) await assert.rejects(() => db.query('select ' + call), /permission denied/)
  } finally { await db.close() }
})
