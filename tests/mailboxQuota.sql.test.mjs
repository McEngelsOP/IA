import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

test('mailbox quota persists per user, resets hourly, expires and denies raw table access', async () => {
  const db = new PGlite()
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222'
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated;
      create table profiles(id uuid primary key);insert into profiles values('${a}'),('${b}');`)
    const migration = readdirSync('supabase/migrations').find(p => p.endsWith('_mailbox_request_limits.sql'))
    const sql = readFileSync('supabase/migrations/' + migration, 'utf8')
    await db.exec(sql); await db.exec(sql)
    const as = async id => db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`)
    const take = async () => (await db.query('select mailbox_take_quota() allowed')).rows[0].allowed
    await as(a); assert.equal(await take(), true); assert.equal(await take(), false)
    await assert.rejects(() => db.query('select * from app_private.mailbox_limits'), /permission denied/)
    await as(b); assert.equal(await take(), true)
    await db.exec(`reset role;update app_private.mailbox_limits set last_sent_at=now()-interval '2 minutes',attempts=5 where student_id='${a}';`)
    await as(a); assert.equal(await take(), false)
    await db.exec(`reset role;update app_private.mailbox_limits set window_start=now()-interval '2 hours' where student_id='${a}';`)
    await as(a); assert.equal(await take(), true)
    await as('33333333-3333-4333-8333-333333333333'); await assert.rejects(take, /PROFILE_REQUIRED/)
    await as(''); await assert.rejects(take, /NO_AUTH/)
    await db.exec('reset role;set role anon;'); await assert.rejects(take, /permission denied/)
  } finally { await db.close() }
})
