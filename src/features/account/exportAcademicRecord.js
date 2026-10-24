import { renderAcademicRecord } from './academicRecordReport.js'

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

export function downloadAcademicRecord(record, catalog = null) {
  const url = URL.createObjectURL(new Blob([renderAcademicRecord(record, catalog)], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  const exportedDate = new Date(record.exportedAt).toLocaleDateString('sv-SE', { timeZone: 'America/Lima' })
  link.href = url; link.download = `lyra-registro-academico-${exportedDate}.html`
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
