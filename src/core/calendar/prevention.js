import { addDays, monday, eventsOn, minutes, todayLima } from './calendarModel.js'
export function calendarRisks(events, tasks, start = todayLima(), days = 28, threshold = 4) {
  const conflicts = [], weeks = new Map()
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i), today = eventsOn(events, date), timed = today.filter(e => e.start_time && e.end_time)
    for (let a = 0; a < timed.length; a++) for (let b = a + 1; b < timed.length; b++) {
      if (minutes(timed[a].start_time) < minutes(timed[b].end_time) && minutes(timed[b].start_time) < minutes(timed[a].end_time)) conflicts.push({ date, a: timed[a], b: timed[b] })
    }
    const deadlines = [...today.filter(e => ['entrega', 'examen'].includes(e.event_type)).map(e => ({ ...e, date })), ...tasks.filter(t => !t.completed && t.due_date === date).map(t => ({ ...t, date }))]
    const key = monday(date)
    weeks.set(key, [...(weeks.get(key) || []), ...deadlines])
  }
  return { conflicts, busyWeeks: [...weeks].filter(([, entries]) => entries.length >= threshold).map(([week, entries]) => ({ week, entries })), weeks }
}
export function inQuietHours(now, settings) {
  if (!settings.quietStart || !settings.quietEnd) return false
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timeZone || 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  return settings.quietStart === settings.quietEnd || (settings.quietStart < settings.quietEnd ? clock >= settings.quietStart && clock < settings.quietEnd : clock >= settings.quietStart || clock < settings.quietEnd)
}
export function dueReminders(events, tasks, settings, now = new Date()) {
  if (!settings.enabled || inQuietHours(now, settings)) return []
  const zone = settings.timeZone || 'America/Lima'
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]))
  const date = `${parts.year}-${parts.month}-${parts.day}`, time = +parts.hour * 60 + +parts.minute
  const result = []
  for (const e of eventsOn(events, date)) if (e.start_time) {
    const delta = minutes(e.start_time) - time
    if (delta >= 0 && delta <= (settings.leadMinutes || 30)) result.push({ key: `event:${e.id}:${date}`, title: e.title, body: `Hoy a las ${e.start_time.slice(0, 5)}` })
  }
  for (const t of tasks) if (!t.completed && t.due_date === date) result.push({ key: `task:${t.id}:${date}`, title: t.title, body: 'Entrega pendiente para hoy.' })
  if (settings.weekly && monday(date) === date && time >= 8 * 60) {
    const summary = calendarRisks(events, tasks, date, 7)
    const total = [...summary.weeks.values()].flat().length
    result.push({ key: `week:${date}`, title: 'Tu semana en Lyra', body: `${total} entregas o exámenes · ${summary.conflicts.length} choques de horario.` })
  }
  return result
}
