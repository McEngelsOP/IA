import { calendarRisks } from '../../core/calendar/prevention.js'
import { monday, todayLima, addDays } from '../../core/calendar/calendarModel.js'
export default function CalendarPrevention({ events, tasks, draft }) {
  const risks = calendarRisks(events, tasks), week = monday(todayLima()), summary = calendarRisks(events, tasks, week, 7)
  const draftRisks = draft?.title && draft?.start_time ? calendarRisks([...events.filter(e => e.id !== draft.id), { ...draft, id: 'draft' }], [], draft.date || todayLima()).conflicts.filter(c => c.a.id === 'draft' || c.b.id === 'draft') : []
  return <section className="blk calendar-prevention" aria-label="Prevención y resumen semanal"><h2>Tu semana, con tiempo</h2><p>Del {week} al {addDays(week, 6)} · {[...summary.weeks.values()].flat().length} entregas o exámenes · {summary.conflicts.length} choques.</p>
    {draftRisks.length > 0 && <p role="alert">El horario propuesto se cruza con {draftRisks.slice(0, 3).map(c => (c.a.id === 'draft' ? c.b : c.a).title).join(', ')}. Revisa las horas antes de guardar.</p>}
    <details><summary>Revisar las próximas 4 semanas</summary>{risks.conflicts.length ? <ul>{risks.conflicts.slice(0, 12).map((c, i) => <li key={i}>{c.date}: {c.a.title} coincide con {c.b.title}.</li>)}</ul> : <p>Sin choques de horarios registrados.</p>}{risks.busyWeeks.length ? <ul>{risks.busyWeeks.map(w => <li key={w.week}>Semana del {w.week}: {w.entries.length} entregas o exámenes pendientes. Considera adelantar tareas.</li>)}</ul> : <p>Sin semanas con 4 o más entregas o exámenes pendientes.</p>}</details><p>Configura los recordatorios opcionales y las horas de silencio en Preferencias.</p>
  </section>
}
