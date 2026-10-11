import { addDays, civil, monday, todayLima } from './calendarModel.js'

export const SETUP_STEPS = ['Semestre', 'Pendientes', 'Ciclo', 'Mención', 'Carga', 'Horario', 'Espacio', 'Resumen']
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
export function newSetup(career, theme = 'light') {
  return { career: career.key, semester: 1, pending: [], enrolled: career.cursos.filter(c => c.c === 1).map(c => c.id), mention: '', undecided: true, credits: 16, schedule: [], scheduleChoice: 'later', scheduleStart: todayLima(), scheduleEnd: addDays(todayLima(), 120), theme, companion: 'cat', method: 'p45', clockStyle: 'ring', step: 0, reviewCycle: 1 }
}
export function completedCourses(courses, draft) {
  return courses.filter(c => c.c > 0 && c.c < draft.semester && !draft.pending.includes(c.id)).map(c => c.id)
}
export function changeSemester(career, draft, semester) {
  return { ...draft, semester, pending: draft.pending.filter(id => career.cursos.some(c => c.id === id && c.c <= semester)), enrolled: career.cursos.filter(c => c.c === semester).map(c => c.id), reviewCycle: 1 }
}
export function togglePending(draft, id, courseCycle) {
  // Current-cycle courses have not been marked as completed. Their selection is made next.
  if (courseCycle >= draft.semester) return draft
  return { ...draft, pending: draft.pending.includes(id) ? draft.pending.filter(v => v !== id) : [...draft.pending, id] }
}
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '')
  const first = text.split(/\r?\n/)[0], separator = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]
  const rows = []; let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (!quoted && char === separator) { row.push(cell); cell = '' }
    else if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(c => c.trim())) rows.push(row); row = []; cell = '' }
    else cell += char
  }
  if (quoted) throw new Error('Hay comillas sin cerrar en el CSV. Revisa el archivo.')
  row.push(cell); if (row.some(c => c.trim())) rows.push(row)
  return rows
}
export function timeValue(value) {
  if (value instanceof Date) return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`
  if (typeof value === 'number' && value >= 0 && value < 1) { const m = Math.round(value * 1440); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::00)?\s*(am|pm)?$/i)
  if (!match || +match[2] > 59 || +match[1] > 23 || (match[3] && (+match[1] < 1 || +match[1] > 12))) return ''
  let h = +match[1]; if (match[3]) h = h % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0)
  return `${String(h).padStart(2, '0')}:${match[2]}`
}
export const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const DAY_KEYS = [['lunes', 'lun', '1'], ['martes', 'mar', '2'], ['miercoles', 'mie', '3'], ['jueves', 'jue', '4'], ['viernes', 'vie', '5'], ['sabado', 'sab', '6'], ['domingo', 'dom', '7']]
export const COLUMNS = [['day', 'Día'], ['start', 'Hora de inicio'], ['end', 'Hora de fin'], ['course', 'Curso'], ['room', 'Aula (opcional)']]
const ALIASES = { day: ['dia', 'day'], start: ['hora de inicio', 'hora inicio', 'inicio', 'start', 'start time'], end: ['hora de fin', 'hora fin', 'fin', 'end', 'end time'], course: ['curso', 'asignatura', 'course'], room: ['aula', 'salon', 'room'] }
export function detectColumns(headers) { return Object.fromEntries(COLUMNS.map(([key]) => [key, headers.findIndex(h => ALIASES[key].includes(normalize(h)))])) }
export function scheduleRows(rows, mapping, courses) {
  const keys = ['day', 'start', 'end', 'course'], indexes = keys.map(k => Number(mapping[k]))
  if (indexes.some(v => v < 0) || new Set(indexes).size < 4) throw new Error('Elige una columna distinta para día, inicio, fin y curso.')
  if (rows.length < 2 || rows.length > 201) throw new Error('El archivo debe contener entre 1 y 200 clases, con títulos en la primera fila.')
  const seen = new Set()
  return rows.slice(1).filter(row => row.some(v => v != null && String(v).trim())).map((row, i) => {
    const day = DAY_KEYS.findIndex(list => list.includes(normalize(row[mapping.day]).replace(/\.$/, '')))
    const start = timeValue(row[mapping.start]), end = timeValue(row[mapping.end]), title = String(row[mapping.course] ?? '').trim(), room = mapping.room >= 0 ? String(row[mapping.room] ?? '').trim() : ''
    const course = courses.find(c => normalize(c.n) === normalize(title) || c.id === title)
    let issue = day < 0 ? 'Día inválido' : !start || !end || end <= start ? 'Revisa las horas' : !title || title.length > 160 ? 'Curso vacío o demasiado largo' : room.length > 160 ? 'Aula demasiado larga' : ''
    const key = [day, start, end, title].join('|'); if (seen.has(key)) issue ||= 'Clase duplicada'; seen.add(key)
    return { row: i + 2, day, start, end, title, room, courseId: course?.id || '', issue }
  })
}
export function scheduleEvents(draft) {
  if (!draft.schedule.length) return []
  if (!civil(draft.scheduleStart) || !civil(draft.scheduleEnd) || draft.scheduleEnd < draft.scheduleStart) throw new Error('Revisa las fechas de inicio y fin del ciclo.')
  return draft.schedule.map((row, i) => {
    if (row.issue || row.day < 0 || row.day > 6 || !timeValue(row.start) || !timeValue(row.end) || row.end <= row.start) throw new Error('Corrige las filas señaladas antes de continuar.')
    let date = addDays(monday(draft.scheduleStart), row.day); if (date < draft.scheduleStart) date = addDays(date, 7)
    if (date > draft.scheduleEnd) throw new Error('El rango de fechas no incluye todos los días de tus clases.')
    return { id: `setup-${draft.token}-${i}`, index: i, title: row.title, location: row.room, course_id: row.courseId || null, date, start_time: row.start, end_time: row.end, event_type: 'clase', color: 'azul', repeat_rule: 'weekly', repeat_until: draft.scheduleEnd }
  })
}
export function setupPreferences(draft) { return { semester: draft.semester, mention: draft.undecided ? '' : draft.mention.trim(), credits: draft.credits, theme: draft.theme, companion: draft.companion, method: draft.method, clockStyle: draft.clockStyle } }
