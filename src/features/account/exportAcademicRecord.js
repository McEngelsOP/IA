import { createAcademicRecordPdf } from './academicRecordPdf.js'

// Read only the fields used by the report, including on profiles with private columns.
const TABLES = [
  ['profiles', 'id', 'id,full_name,alias,student_code,email,carrera,institution_id,curriculum_version,university_name,external_career,custom_curriculum_id', 'tu perfil'],
  ['progress', 'student_id', 'done,plan', 'tu avance'],
  ['grades', 'student_id', 'course_id,grade', 'tus calificaciones'],
  ['course_status', 'student_id', 'course_id,status,times_taken,passed_at,personal_note', 'los estados de tus cursos'],
  ['student_setup', 'student_id', 'preferences,completed_at', 'tus preferencias académicas'],
  ['calendar_events', 'student_id', 'id,title,description,date,start_date,end_date,event_type,start_time,end_time,location,course_id,repeat_rule,repeat_until', 'tu agenda'],
  ['calendar_tasks', 'student_id', 'id,title,due_date,completed,course_id', 'tus tareas']
]
export async function readAcademicRecord(client, userId, signal) {
  const verified = await client.auth.getUser()
  if (verified.error || verified.data.user?.id !== userId) throw new Error('SESSION_CHANGED')
  const entries = await Promise.all(TABLES.map(async ([table, owner, fields, section]) => {
    const rows = []
    for (let offset = 0; ; offset += 500) {
      let query = client.from(table).select(fields).eq(owner, userId).order(table === 'grades' || table === 'course_status' ? 'course_id' : table === 'profiles' || table.startsWith('calendar_') ? 'id' : 'student_id').range(offset, offset + 499)
      if (signal) query = query.abortSignal(signal)
      const result = await query
      if (result.error || !Array.isArray(result.data)) throw Object.assign(new Error('EXPORT_READ_FAILED', { cause: result.error }), { section })
      rows.push(...result.data)
      if (result.data.length < 500) break
    }
    return [table, rows]
  }))
  if (signal?.aborted) throw new Error('EXPORT_TIMEOUT')
  const session = await client.auth.getUser()
  if (session.error || session.data.user?.id !== userId) throw new Error('SESSION_CHANGED')
  return { product: 'Lyra', formatVersion: 1, exportedAt: new Date().toISOString(), ...Object.fromEntries(entries) }
}

export function downloadAcademicRecord(record, catalog = null, { keepAvailable = false } = {}) {
  const pdf = createAcademicRecordPdf(record, catalog)
  const url = URL.createObjectURL(pdf.output('blob'))
  const link = document.createElement('a')
  const exportedDate = new Date(record.exportedAt).toLocaleDateString('sv-SE', { timeZone: 'America/Lima' })
  link.href = url; link.download = `lyra-registro-academico-${exportedDate}.pdf`
  document.body.appendChild(link); link.click(); link.remove()
  // Delayed downloads on mobile must retain their Blob until the browser reads it.
  let disposed = false
  const dispose = () => { if (!disposed) { disposed = true; URL.revokeObjectURL(url) } }
  if (!keepAvailable) setTimeout(dispose, 60000)
  return { url, filename: link.download, dispose }
}
