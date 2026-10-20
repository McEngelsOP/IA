export const MAX_EXCEL_BYTES = 2 * 1024 * 1024
export const MAX_SCHEDULE_TEXT = 16000
export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const d = new Date(value + 'T12:00:00Z')
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value
}
export function validateSemester(start, end) {
  if (!validDate(start) || !validDate(end) || end < start) return 'Completa las fechas de inicio y fin del semestre.'
  if ((new Date(end) - new Date(start)) / 86400000 > 240) return 'El semestre no puede superar 240 días.'
  return ''
}
const time = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
export function validateClass(r) {
  if (typeof r.title !== 'string' || !r.title.trim() || r.title.trim().length > 160) return 'Revisa el nombre del curso.'
  if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) return 'Selecciona el día de la clase.'
  if (!time(r.start_time) || !time(r.end_time) || r.end_time <= r.start_time) return 'Revisa las horas: el fin debe ser posterior al inicio.'
  if (typeof r.location !== 'string' || r.location.length > 160) return 'El lugar admite hasta 160 caracteres.'
  return ''
}
export function parseSchedule(answer) {
  const cleaned = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const data = JSON.parse(cleaned)
  if (!Array.isArray(data.classes) || data.classes.length > 50) throw new Error('Respuesta de horario inválida.')
  const classes = data.classes.map(r => ({ title: r.title, weekday: r.weekday, start_time: r.start_time, end_time: r.end_time, location: r.location || '' }))
  if (classes.some(validateClass)) throw new Error('La IA devolvió clases incompletas. Revisa el formato del Excel.')
  return { classes, semester_start: validDate(data.semester_start) ? data.semester_start : '', semester_end: validDate(data.semester_end) ? data.semester_end : '' }
}
export function compactSheet(rows) {
  if (!Array.isArray(rows) || rows.length > 300 || rows.some(r => r.length > 24)) throw new Error('Usa una hoja de horario de hasta 300 filas y 24 columnas.')
  const compact = rows.map(row => row.map(cell => cell instanceof Date ? cell.toISOString() : cell == null ? '' : String(cell).trim())).filter(row => row.some(Boolean))
  const text = JSON.stringify(compact)
  if (text.length > MAX_SCHEDULE_TEXT || !compact.length) throw new Error('La hoja está vacía o contiene demasiada información. Usa una hoja solo con tu horario.')
  return text
}
export function classEvent(r, start, end) {
  const issue = validateSemester(start, end) || validateClass(r)
  if (issue) throw new Error(issue)
  const date = new Date(start + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + (r.weekday - (date.getUTCDay() + 6) % 7 + 7) % 7)
  const first = date.toISOString().slice(0, 10)
  if (first > end) throw new Error('El período no incluye todos los días seleccionados.')
  return { title: r.title.trim(), date: first, start_date: null, end_date: null, event_type: 'clase', start_time: r.start_time, end_time: r.end_time, location: r.location.trim(), repeat_rule: 'weekly', repeat_until: end, color: 'gris' }
}
export const eventSignature = e => JSON.stringify([e.title.trim().toLocaleLowerCase('es'), e.date || e.start_date, e.start_time?.slice(0, 5), e.end_time?.slice(0, 5), e.repeat_until, e.repeat_rule])
export function conflictingClasses(rows) {
  return rows.some((r, i) => rows.slice(i + 1).some(s => r.weekday === s.weekday && r.start_time < s.end_time && s.start_time < r.end_time))
}
