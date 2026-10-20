import { addDays, civil, monday, todayLima } from '../../core/calendar/calendarModel.js'

export const SETUP_STEPS = ['Semestre', 'Pendientes', 'Ciclo', 'Carga', 'Horario', 'Espacio', 'Resumen']
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
export function newSetup(career, theme = 'light') {
  return { career: career.key, semester: 1, pending: [], enrolled: career.cursos.filter(c => c.c === 1).map(c => c.id), credits: 16, schedule: [], scheduleChoice: 'later', scheduleStart: todayLima(), scheduleEnd: addDays(todayLima(), 120), theme, companion: 'cat', method: 'p45', clockStyle: 'ring', step: 0, setupVersion: 2, reviewCycle: 1 }
}
export function resumeSetupStep(draft = {}) {
  const step = Number.isInteger(draft.step) ? draft.step : 0
  return Math.max(0, Math.min(6, draft.setupVersion === 2 ? step : step >= 4 ? step - 1 : step))
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
export function timeValue(value) {
  if (value instanceof Date) return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`
  if (typeof value === 'number' && value >= 0 && value < 1) { const m = Math.round(value * 1440); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::00)?\s*(am|pm)?$/i)
  if (!match || +match[2] > 59 || +match[1] > 23 || (match[3] && (+match[1] < 1 || +match[1] > 12))) return ''
  let h = +match[1]; if (match[3]) h = h % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0)
  return `${String(h).padStart(2, '0')}:${match[2]}`
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
export function setupPreferences(draft) { return { semester: draft.semester, mention: '', credits: draft.credits, theme: draft.theme, companion: draft.companion, method: draft.method, clockStyle: draft.clockStyle } }
