const TABLES = [
  ['profiles', 'id'], ['progress', 'student_id'], ['grades', 'student_id'],
  ['course_status', 'student_id'], ['student_setup', 'student_id'],
  ['calendar_events', 'student_id'], ['calendar_tasks', 'student_id']
]
export async function readAcademicRecord(client, userId) {
  const verified = await client.auth.getUser()
  if (verified.error || verified.data.user?.id !== userId) throw new Error('SESSION_CHANGED')
  const entries = await Promise.all(TABLES.map(async ([table, owner]) => {
    const rows = []
    for (let offset = 0; ; offset += 500) {
      const result = await client.from(table).select('*').eq(owner, userId).order(table === 'grades' || table === 'course_status' ? 'course_id' : table === 'profiles' || table.startsWith('calendar_') ? 'id' : 'student_id').range(offset, offset + 499)
      if (result.error) throw result.error
      rows.push(...(result.data || []))
      if (!result.data || result.data.length < 500) break
    }
    return [table, rows]
  }))
  const session = await client.auth.getUser()
  if (session.error || session.data.user?.id !== userId) throw new Error('SESSION_CHANGED')
  return { product: 'Lyra', formatVersion: 1, exportedAt: new Date().toISOString(), ...Object.fromEntries(entries) }
}

export function downloadAcademicRecord(record) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = `lyra-registro-academico-${record.exportedAt.slice(0, 10)}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
