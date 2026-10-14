export const EVENT_TYPES = [['clase', 'Clases'], ['examen', 'Exámenes'], ['entrega', 'Entregas'], ['estudio', 'Estudio'], ['personal', 'Personal']]
export const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const DAY = 86400000
export function civil(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? date : null
}
export const dateKey = date => date.toISOString().slice(0, 10)
export const addDays = (key, n) => dateKey(new Date(+civil(key) + n * DAY))
export const monday = key => addDays(key, -((civil(key).getUTCDay() + 6) % 7))
export const dayDiff = (a, b) => Math.round((civil(a) - civil(b)) / DAY)
export const labelDate = (key, options) => civil(key).toLocaleDateString('es-PE', { ...options, timeZone: 'UTC' })
export function todayLima(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
export const minutes = value => { const [h, m] = (value || '').split(':').map(Number); return h * 60 + m }
export const timeLabel = value => value?.slice(0, 5) || ''
export function monthDays(key) {
  const first = key.slice(0, 8) + '01', start = monday(first)
  const next = new Date(+civil(first)); next.setUTCMonth(next.getUTCMonth() + 1)
  const count = Math.ceil((dayDiff(addDays(dateKey(next), -1), start) + 1) / 7) * 7
  return Array.from({ length: count }, (_, i) => addDays(start, i))
}
export function occurs(event, day) {
  const start = event.date || event.start_date, end = event.end_date || start
  if (!civil(start) || !civil(day) || day < start) return false
  if (event.repeat_rule === 'weekly') return (!event.repeat_until || day <= event.repeat_until) && dayDiff(day, start) % 7 === 0
  return day <= (civil(end) ? end : start)
}
export function eventsOn(events, day, hidden = new Set()) {
  return events.filter(e => !hidden.has(e.event_type || 'personal') && occurs(e, day))
    .sort((a, b) => minutes(a.start_time || '00:00') - minutes(b.start_time || '00:00') || a.title.localeCompare(b.title, 'es'))
}
export function layoutEvents(events) {
  const sorted = events.filter(e => e.start_time && e.end_time).map(e => ({ ...e, start: minutes(e.start_time), end: minutes(e.end_time) })).sort((a, b) => a.start - b.start || b.end - a.end)
  const groups = []; let group = [], maxEnd = -1
  for (const e of sorted) {
    if (e.start >= maxEnd && group.length) { groups.push(group); group = []; maxEnd = -1 }
    group.push(e); maxEnd = Math.max(maxEnd, e.end)
  }
  if (group.length) groups.push(group)
  return groups.flatMap(list => {
    const ends = []
    const assigned = list.map(e => { let lane = ends.findIndex(end => end <= e.start); if (lane < 0) lane = ends.length; ends[lane] = e.end; return { ...e, lane } })
    return assigned.map(e => ({ ...e, lanes: ends.length }))
  })
}

// Una sola columna por día. Los cruces se presentan como una lista dentro
// del mismo intervalo, sin convertir cada curso en una franja lateral.
export function timedEventGroups(events) {
  const sorted = events.filter(e => e.start_time && e.end_time)
    .map(e => ({ ...e, start: minutes(e.start_time), end: minutes(e.end_time) }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const groups = []
  for (const event of sorted) {
    const last = groups.at(-1)
    if (last && event.start < last.end) { last.events.push(event); last.end = Math.max(last.end, event.end) }
    else groups.push({ id: event.id, start: event.start, end: event.end, events: [event] })
  }
  return groups
}
const validTime = value => {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value || '')) return false
  const [hour, minute, second = 0] = value.split(':').map(Number)
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 && second >= 0 && second < 60
}
export function validateEvent(e) {
  const start = e.date || e.start_date
  if (!e.title.trim() || e.title.trim().length > 160) return 'Escribe un título de hasta 160 caracteres.'
  if (!civil(start) || (e.end_date && (!civil(e.end_date) || e.end_date < start))) return 'Revisa las fechas del evento.'
  if (!!e.start_time !== !!e.end_time || (e.start_time && (!validTime(e.start_time) || !validTime(e.end_time) || minutes(e.start_time) >= minutes(e.end_time) || minutes(e.end_time) >= 1440))) return 'La hora final debe ser posterior a la inicial, dentro del mismo día.'
  if (e.repeat_rule === 'weekly' && e.repeat_until && (!civil(e.repeat_until) || e.repeat_until < start)) return 'La repetición debe terminar después de la fecha inicial.'
  if (e.repeat_rule === 'weekly' && e.end_date && e.end_date !== start) return 'Un horario semanal debe comenzar y terminar el mismo día.'
  return ''
}

// Solo columnas editables: layoutEvents añade start/end/lane/lanes al dibujar.
export function eventPayload(event) {
  return {
    title: event.title.trim(), description: event.description || '',
    date: event.date || null, start_date: event.start_date || null, end_date: event.end_date || null,
    color: event.color || 'gris', event_type: event.event_type || 'personal',
    start_time: event.start_time || null, end_time: event.end_time || null,
    location: (event.location || '').trim(), course_id: event.course_id || null,
    repeat_rule: event.repeat_rule || 'none',
    repeat_until: event.repeat_rule === 'weekly' ? event.repeat_until || null : null,
  }
}
export const CALENDAR_PIXELS_PER_MINUTE = 1.5
export function eventGeometry(event, firstHour) {
  return { top: (event.start - firstHour * 60) * CALENDAR_PIXELS_PER_MINUTE,
    height: Math.max(12, (event.end - event.start) * CALENDAR_PIXELS_PER_MINUTE - 4) }
}


