import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

test('registration catalog exposes approved names and careers to anonymous users without exposing drafts', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated;
      grant usage on schema public to anon, authenticated;
      create table universities(id text primary key, name text, status text);
      create table custom_curricula(institution_id text, career_name text, status text);
      alter table universities enable row level security;
      alter table custom_curricula enable row level security;
      insert into universities values ('esan','Universidad ESAN','approved'), ('u-a','Universidad A','approved'), ('u-b','Universidad B','pending'), ('u-c','Universidad C','rejected');
      insert into custom_curricula values ('u-a','Medicina','approved'), ('u-a','Medicina','approved'), ('u-a','Ingeniería','approved'), ('u-a','Borrador privado','pending'), ('u-a','Rechazada','rejected'), ('u-b','Carrera pendiente','approved');
    `)
    const sql = readFileSync('supabase/registration_universities.sql', 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    await db.exec('set role anon')
    const expected = [
      { id: 'u-a', name: 'Universidad A', careers: ['Ingeniería', 'Medicina'] },
      { id: 'esan', name: 'Universidad ESAN', careers: [] },
    ]
    assert.deepEqual((await db.query('select * from public.registration_universities()')).rows, expected)
    await assert.rejects(db.query('select * from public.custom_curricula'), /permission denied/)
    await assert.rejects(db.query('select * from public.universities'), /permission denied/)
    await db.exec('reset role; set role authenticated')
    assert.deepEqual((await db.query('select * from public.registration_universities()')).rows, expected)
  } finally { await db.close() }
})
