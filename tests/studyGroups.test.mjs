import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeMessages, validRoom, cleanInvite, studyError } from '../src/features/groups/studyGroups.js'

test('messages merge overlapping pages and refreshes without losing older history', () => {
  const older = { id: 'a', created_at: '2026-10-08T10:00:00Z', body: 'Anterior' }
  const repeated = { id: 'b', created_at: '2026-10-08T10:01:00Z', body: 'Recibido' }
  const newest = { id: 'c', created_at: '2026-10-08T10:02:00Z', body: 'Nuevo' }
  const current = [older, repeated]
  const merged = mergeMessages(current, [newest, { ...repeated, is_mine: true }])
  assert.deepEqual(merged.map(m => m.id), ['a', 'b', 'c'])
  assert.equal(merged[1].is_mine, true)
  assert.deepEqual(current, [older, repeated])
})

test('message order uses actual timestamps and stable IDs across offsets and fractional seconds', () => {
  const messages = [
    { id: 'b', created_at: '2026-10-08T10:00:00Z' },
    { id: 'c', created_at: '2026-10-08T10:00:00.001Z' },
    { id: 'a', created_at: '2026-10-08T05:00:00-05:00' }
  ]
  assert.deepEqual(mergeMessages([], messages).map(m => m.id), ['a', 'b', 'c'])
})

test('room validation rejects unknown courses and whitespace-only identity, honors limits', () => {
  const courses = [{ id: 'calc1' }]
  const draft = { course: 'calc1', name: 'Repaso', description: '', nickname: 'Ana' }
  assert.equal(validRoom(draft, courses), '')
  for (const patch of [{ course: 'inventado' }, { name: '  ' }, { nickname: '  ' }, { name: 'x'.repeat(81) }, { nickname: 'x'.repeat(41) }, { description: 'x'.repeat(501) }]) {
    assert.notEqual(validRoom({ ...draft, ...patch }, courses), '')
  }
  assert.equal(validRoom({ ...draft, name: 'x'.repeat(80), nickname: 'x'.repeat(40), description: 'x'.repeat(500) }, courses), '')
})

test('invitations accept copied spacing and hyphens without inventing an access code', () => {
  assert.equal(cleanInvite(' AAaa-BBBB cccc\ndddd '), 'aaaabbbbccccdddd')
  assert.equal(cleanInvite(''), '')
})

test('known server failures give actionable copy and unknown failures preserve drafts', () => {
  assert.match(studyError({ message: 'MESSAGE_LIMIT' }), /diez mensajes/)
  assert.match(studyError({ message: 'ROOM_UNAVAILABLE' }), /Revisa el código/)
  assert.match(studyError({ code: 'PGRST202' }), /configuración en el servidor/)
  assert.match(studyError(new Error('private internal detail')), /borrador se conservan/)
  assert.equal(studyError(new Error('private internal detail'), 'Reintenta la lectura.'), 'Reintenta la lectura.')
})
