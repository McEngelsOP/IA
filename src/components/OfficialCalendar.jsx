import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EVENT_TYPES, DAYS, civil, addDays, monday, monthDays, labelDate, todayLima, minutes, timeLabel, eventsOn, layoutEvents, validateEvent } from '../lib/calendarModel'
import '../styles/OfficialCalendar.css'
import { calendarWindow, readCalendarPages, readUpcomingClasses } from '../lib/calendarQueries.js'
import { privateReads } from '../lib/sessionCache.js'

const FIELDS = 'id,student_id,title,description,date,start_date,end_date,color,event_type,start_time,end_time,location,course_id,repeat_rule,repeat_until'
const TASK_FIELDS = 'id,student_id,title,due_date,completed'
const blank = day => ({ title: '', description: '', date: day, start_date: null, end_date: null, color: 'gris', event_type: 'personal', start_time: '08:00', end_time: '09:00', location: '', course_id: '', repeat_rule: 'none', repeat_until: '' })
function Icon({ name }) {
  const paths = { left: <path d="m14 6-6 6 6 6"/>, right: <path d="m10 6 6 6-6 6"/>, plus: <path d="M12 5v14M5 12h14"/>, check: <path d="m5 12 4 4 10-10"/>, cal: <><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16"/></>, edit: <><path d="m14 5 5 5M4 20l5-1L20 8l-5-5L4 14z"/></>, trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6m4-6v6"/></> }
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
function OfficialCalendar({ client, user, courses, onBusy }) {
  const [day, setDay] = useState(todayLima), [view, setView] = useState(() => window.matchMedia('(max-width:860px)').matches ? 'agenda' : 'week')
  const [events, setEvents] = useState([]), [tasks, setTasks] = useState([]), [state, setState] = useState('loading')
  const [hidden, setHidden] = useState(new Set()), [draft, setDraft] = useState(null), [taskDraft, setTaskDraft] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [deleting, setDeleting] = useState(false)
  const lock = useRef(false), alive = useRef(true), generation = useRef(0), editor = useRef(null), createButton = useRef(null), previousFocus = useRef(null)
  const windowRange = calendarWindow(day), rangeKey = windowRange.start + ':' + windowRange.end
  const request = useRef(null), pendingWrite = useRef(null)
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; generation.current++; request.current?.abort(); privateReads.forgetPending(user.id, 'calendar:' + rangeKey); privateReads.forgetPending(user.id, 'calendar-upcoming:' + todayLima()) } }, [rangeKey, user.id])
  useEffect(() => { if (draft || taskDraft) { editor.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); editor.current?.querySelector('input')?.focus({ preventScroll: true }) } }, [draft?.id, !!draft, taskDraft?.id, !!taskDraft])
  async function verify() {
    const result = await client.auth.getUser()
    if (result.error || result.data.user?.id !== user.id) throw new Error('session')
  }
  async function load() {
    if (lock.current) return
    const revision = ++generation.current
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setState('loading'); setError('')
    try {
      const results = await privateReads.read(user.id, 'calendar:' + rangeKey, async () => {
        const signal = controller.signal
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        return Promise.all([
          readCalendarPages(client, user.id, 'calendar_events', FIELDS, { ...windowRange, signal }),
          readCalendarPages(client, user.id, 'calendar_tasks', TASK_FIELDS, { ...windowRange, signal }),
          privateReads.read(user.id, 'calendar-upcoming:' + todayLima(), () => readUpcomingClasses(client, user.id, FIELDS, todayLima(), signal))
        ])
      })
      if (alive.current && revision === generation.current) { setEvents([...new Map([...results[0],...results[2]].map(row=>[row.id,row])).values()]); setTasks(results[1]); setState('ready') }
    } catch (e) { if (alive.current && revision === generation.current && e.name !== 'AbortError') { setState('error'); setError('No pudimos cargar tu calendario. Reintenta; si el problema continúa, la configuración de la cuenta necesita revisión.') } }
  }
  async function write(table, payload, id, remove = false) {
    if (lock.current) return false
    let wrote = false
    lock.current = true; setBusy(true); onBusy(true); setError(''); setMessage('')
    try {
      await verify()
      const fingerprint = JSON.stringify([table,payload,id,remove])
      if (pendingWrite.current?.fingerprint !== fingerprint) pendingWrite.current = { fingerprint, id: crypto.randomUUID() }
      let query = client.from(table)
      query = remove ? query.delete() : id ? query.update(payload) : query.upsert({ ...payload, student_id: user.id, id: pendingWrite.current.id }, { onConflict: 'id' })
      if (id) query = query.eq('student_id', user.id).eq('id', id)
      const result = await query.select(table === 'calendar_events' ? FIELDS : TASK_FIELDS).maybeSingle()
      if (result.error || (!remove && !result.data)) throw new Error('write')
      if (!alive.current) return false
      privateReads.clear(user.id); pendingWrite.current = null; wrote = true
      const setter = table === 'calendar_events' ? setEvents : setTasks
      setter(previous => remove ? previous.filter(e => e.id !== id) : id ? previous.map(e => e.id === id ? result.data : e) : [...previous.filter(e => e.id !== result.data.id), result.data])
      setMessage(remove ? 'Eliminado de tu cuenta.' : 'Guardado en tu cuenta.')
      return true
    } catch { if (alive.current) setError('No se pudo guardar. Tus datos anteriores y el borrador se conservan. Reintenta o vuelve a iniciar sesión.'); return false }
    finally { lock.current = false; onBusy(false); if (alive.current) { setBusy(false); if (wrote) load() } }
  }
  function closeEditor() { if (lock.current) return; setDraft(null); setTaskDraft(null); setDeleting(false); (previousFocus.current?.isConnected ? previousFocus.current : createButton.current)?.focus({ preventScroll: true }) }
  function editEvent(e) { if (lock.current) return; previousFocus.current = document.activeElement; setTaskDraft(null); setDraft({ ...e, start_time: timeLabel(e.start_time), end_time: timeLabel(e.end_time), repeat_until: e.repeat_until || '', course_id: e.course_id || '' }); setDeleting(false); setError(''); setMessage('') }
  function createEvent() { if (lock.current) return; editEvent(blank(day)) }
  async function saveEvent(e) {
    e.preventDefault(); const issue = validateEvent(draft)
    if (issue) { setError(issue); return }
    const { id, student_id, ...payload } = draft
    payload.title = payload.title.trim(); payload.start_time ||= null; payload.end_time ||= null; payload.course_id ||= null; payload.repeat_until = payload.repeat_rule === 'weekly' ? payload.repeat_until || null : null
    if (await write('calendar_events', payload, id)) closeEditor()
  }
  async function saveTask(e) {
    e.preventDefault()
    if (!taskDraft.title.trim() || !civil(taskDraft.due_date)) { setError('Escribe un título y una fecha válida para la tarea.'); return }
    if (await write('calendar_tasks', { title: taskDraft.title.trim(), due_date: taskDraft.due_date, completed: taskDraft.completed || false }, taskDraft.id)) closeEditor()
  }
  async function remove() {
    const item = draft || taskDraft
    if (await write(draft ? 'calendar_events' : 'calendar_tasks', null, item.id, true)) closeEditor()
  }
  function navigate(direction) {
    if (view === 'month') { const date = civil(day.slice(0, 8) + '01'); date.setUTCMonth(date.getUTCMonth() + direction); setDay(date.toISOString().slice(0, 10)) }
    else setDay(addDays(day, direction * (view === 'week' ? 7 : 1)))
  }
  const today = todayLima(), week = monday(day), days = ['day', 'agenda'].includes(view) ? [day] : Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const visible = days.flatMap(d => eventsOn(events, d, hidden)), timed = visible.filter(e => e.start_time && e.end_time)
  const firstHour = Math.min(7, ...timed.map(e => Math.floor(minutes(e.start_time) / 60))), lastHour = Math.max(20, ...timed.map(e => Math.ceil(minutes(e.end_time) / 60)))
  const selected = eventsOn(events, day, hidden), dailyTasks = tasks.filter(t => t.due_date === day)
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
  const nextCandidates = events.filter(e => e.event_type === 'clase' && e.start_time).map(e => {
    let start = e.date || e.start_date
    if (!civil(start)) return null
    if (e.repeat_rule === 'weekly' && start < today) { const distance = Math.ceil((civil(today) - civil(start)) / 86400000 / 7); start = addDays(start, distance * 7) }
    if (e.repeat_rule !== 'weekly' && start < today && e.end_date >= today) start = today
    if (start === today && e.start_time.slice(0, 5) <= clock) start = e.repeat_rule === 'weekly' ? addDays(start, 7) : e.end_date > today ? addDays(start, 1) : start
    return start >= today && (start > today || e.start_time.slice(0, 5) > clock) && (e.repeat_rule === 'weekly' || !e.end_date || start <= e.end_date) && (!e.repeat_until || start <= e.repeat_until) ? { ...e, occurrence: start } : null
  }).filter(Boolean).sort((a, b) => a.occurrence.localeCompare(b.occurrence) || a.start_time.localeCompare(b.start_time))
  const next = nextCandidates[0]
  const heading = view === 'week' ? `${labelDate(week, { day: 'numeric', month: 'short' })} – ${labelDate(addDays(week, 6), { day: 'numeric', month: 'short', year: 'numeric' })}` : labelDate(day, ['day', 'agenda'].includes(view) ? { weekday: 'long', day: 'numeric', month: 'long' } : { month: 'long', year: 'numeric' })
  const span = e => e.start_time ? `${timeLabel(e.start_time)} – ${timeLabel(e.end_time)}` : 'Todo el día'
  const set = (name, value) => setDraft(previous => ({ ...previous, [name]: value }))
  if (state === 'loading') return <section className="blk sc" role="status" aria-busy="true"><h2 className="bt">Cargando tu calendario…</h2><p>Consultando tus eventos, horarios y tareas.</p></section>
  if (state === 'error') return <section className="blk sc"><h2 className="bt">Calendario no disponible</h2><p role="alert">{error}</p><button className="h-btn primary" onClick={load}>Reintentar</button></section>
  return <div className={`sc sc-view-${view}${draft || taskDraft ? ' sc-editing' : ''}`} onKeyDown={e => { if (e.key === 'Escape' && (draft || taskDraft) && !busy) { e.stopPropagation(); closeEditor() } }}>
    <div className="sc-status" aria-live="polite">{busy ? 'Guardando…' : message}</div>{error && <p className="sc-error" role="alert">{error}</p>}
    <div className="cw"><section className="blk"><div className="ch"><div className="nv"><button className="hb" aria-label="Período anterior" onClick={() => navigate(-1)}><Icon name="left"/></button><h2 className="cl">{heading}</h2><button className="hb" aria-label="Período siguiente" onClick={() => navigate(1)}><Icon name="right"/></button></div><button className="tdb" onClick={() => setDay(today)}>Hoy</button><div className="seg" role="group" aria-label="Vista del calendario">{[['agenda', 'Agenda'], ['day', 'Día'], ['week', 'Semana'], ['month', 'Mes']].map(([id, label]) => <button key={id} className={view === id ? 'on' : ''} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div><button className="mk" ref={createButton} disabled={busy} onClick={createEvent}><Icon name="plus"/>Crear evento</button></div>
      <div className="sc-datebar"><p className="sc-zone">Hora de Lima · UTC−5</p><label>Ir a fecha<input type="date" value={day} onChange={e => { if (civil(e.target.value)) setDay(e.target.value) }}/></label></div>
      {view === 'agenda' ? null : view === 'month' ? <div className="wkw"><div className="mg">{DAYS.map(d => <em key={d}>{d}</em>)}{monthDays(day).map(d => { const list = eventsOn(events, d, hidden); return <button key={d} className={`mc${d.slice(0, 7) !== day.slice(0, 7) ? ' out' : ''}${d === today ? ' tdy' : ''}`} aria-label={labelDate(d, { day: 'numeric', month: 'long' }) + `, ${list.length} eventos`} onClick={() => { setDay(d); setView('day') }}><b>{civil(d).getUTCDate()}</b>{list.slice(0, 2).map(e => <span key={e.id} className={`mt y-${e.event_type}`}>{e.title}</span>)}{list.length > 2 && <small>+{list.length - 2} más</small>}</button> })}</div></div> : <div className="wkw" tabIndex="0" role="region" aria-label={view === 'week' ? 'Horario semanal; desliza horizontalmente para ver todos los días' : 'Horario del día'}><div className="wk" style={{ '--n': days.length }}><div className="wh"><span/>{days.map(d => <button key={d} className={`dhd${d === today ? ' tdy' : ''}${d === day ? ' sl' : ''}`} aria-label={labelDate(d, { weekday: 'long', day: 'numeric', month: 'long' })} onClick={() => setDay(d)}><small>{DAYS[(civil(d).getUTCDay() + 6) % 7]}</small><b>{civil(d).getUTCDate()}</b></button>)}</div><div className="sc-allday" style={{ '--n': days.length }}><span>Todo el día</span>{days.map(d => <div key={d}>{eventsOn(events, d, hidden).filter(e => !e.start_time).map(e => <button key={e.id} disabled={busy} onClick={() => editEvent(e)}>{e.title}</button>)}</div>)}</div><div className="wb" style={{ height: (lastHour - firstHour) * 60 }}><div className="hr">{Array.from({ length: lastHour - firstHour }, (_, i) => <span key={i} style={{ top: i * 60 }}>{String(firstHour + i).padStart(2, '0')}:00</span>)}</div>{days.map(d => <div className="dc" key={d}>{layoutEvents(eventsOn(events, d, hidden)).map(e => <button key={e.id} className={`ev2 y-${e.event_type}`} disabled={busy} title={`${e.title} · ${span(e)}${e.location ? ` · ${e.location}` : ''}`} aria-label={`${e.title}, ${span(e)}. Editar evento`} onClick={() => editEvent(e)} style={{ top: e.start - firstHour * 60, height: Math.max(12, e.end - e.start - 3), left: `calc(${e.lane * 100 / e.lanes}% + 2px)`, width: `calc(${100 / e.lanes}% - 4px)` }}><b>{e.title}</b><small>{span(e)}</small></button>)}</div>)}</div></div></div>}
      <section className="sc-agenda" aria-label="Agenda del día"><h3>{labelDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>{!selected.length ? <p>Sin eventos para este día{hidden.size ? ' con los filtros actuales' : ''}.</p> : selected.map(e => <button key={e.id} className="sc-agenda-row" disabled={busy} onClick={() => editEvent(e)}><span><b>{e.title}</b><small>{span(e)}{e.location ? ` · ${e.location}` : ''}{e.repeat_rule === 'weekly' ? ' · Cada semana' : ''}</small>{e.description && <span>{e.description}</span>}</span><Icon name="edit"/></button>)}{!events.length && <p>Agrega tu primera clase, entrega o actividad con «Crear evento».</p>}</section>
    </section><aside className="cside">
      {(draft || taskDraft) ? <section className="blk sc-editor" ref={editor} aria-label={draft ? 'Editar evento' : 'Editar tarea'}><h2>{draft ? draft.id ? 'Editar evento' : 'Nuevo evento' : taskDraft.id ? 'Editar tarea' : 'Nueva tarea'}</h2><form onSubmit={draft ? saveEvent : saveTask}><fieldset disabled={busy}>
        <label>Título<input required maxLength="160" value={(draft || taskDraft).title} onChange={e => draft ? set('title', e.target.value) : setTaskDraft({ ...taskDraft, title: e.target.value })}/></label>
        {draft ? <><label>Tipo<select aria-label="Tipo" value={draft.event_type || 'personal'} onChange={e => set('event_type', e.target.value)}>{EVENT_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Curso (opcional)<select aria-label="Curso (opcional)" value={draft.course_id} onChange={e => set('course_id', e.target.value)}><option value="">Sin curso</option>{courses.map(c => <option key={c.id} value={c.id}>{c.n}</option>)}</select></label><label>Fecha inicial<input type="date" required value={draft.date || draft.start_date || ''} onChange={e => { setDraft({ ...draft, date: e.target.value, start_date: draft.start_date ? e.target.value : null }) }}/></label><label>Fecha final (opcional)<input type="date" min={draft.date || draft.start_date} value={draft.end_date || ''} onChange={e => set('end_date', e.target.value || null)}/></label><label className="sc-check"><input type="checkbox" checked={!draft.start_time} onChange={e => setDraft({ ...draft, start_time: e.target.checked ? '' : '08:00', end_time: e.target.checked ? '' : '09:00' })}/>Todo el día</label>{draft.start_time && <div className="sc-time"><label>Inicio<input type="time" required value={draft.start_time} onChange={e => set('start_time', e.target.value)}/></label><label>Fin<input type="time" required value={draft.end_time} onChange={e => set('end_time', e.target.value)}/></label></div>}<label>Repetición<select aria-label="Repetición" value={draft.repeat_rule || 'none'} onChange={e => set('repeat_rule', e.target.value)}><option value="none">No repetir</option><option value="weekly">Cada semana</option></select></label>{draft.repeat_rule === 'weekly' && <label>Repetir hasta (opcional)<input type="date" min={draft.date || draft.start_date} value={draft.repeat_until} onChange={e => set('repeat_until', e.target.value)}/></label>}<label>Lugar (opcional)<input maxLength="160" value={draft.location || ''} onChange={e => set('location', e.target.value)}/></label><label>Descripción (opcional)<textarea maxLength="2000" rows="3" value={draft.description || ''} onChange={e => set('description', e.target.value)}/></label>{draft.repeat_rule === 'weekly' && <p>Editar o eliminar afectará a toda la serie semanal.</p>}</> : <label>Fecha<input type="date" required value={taskDraft.due_date} onChange={e => setTaskDraft({ ...taskDraft, due_date: e.target.value })}/></label>}
        {error && <p role="alert">{error}</p>}<div className="sc-actions"><button className="mk" type="submit">{busy ? 'Guardando…' : 'Guardar'}</button><button className="h-btn" type="button" onClick={closeEditor}>Cancelar</button></div>{(draft || taskDraft).id && <button className="h-btn" type="button" onClick={() => setDeleting(true)}><Icon name="trash"/>Eliminar {draft ? 'evento' : 'tarea'}</button>}
        {deleting && <div className="sc-confirm" role="group" aria-label="Confirmar eliminación"><p>¿Eliminar {draft?.repeat_rule === 'weekly' ? 'toda esta serie semanal' : 'este registro'} de tu cuenta?</p><button className="mk" type="button" onClick={remove}>Confirmar eliminación</button><button className="h-btn" type="button" onClick={() => setDeleting(false)}>Conservar</button></div>}
      </fieldset></form></section> : <><section className="blk"><h2 className="bt"><Icon name="cal"/>{labelDate(day, { month: 'long', year: 'numeric' })}</h2><div className="cg mini">{DAYS.map((d, i) => <b key={d + i}>{d.slice(0, 1)}</b>)}{monthDays(day).map(d => <button key={d} aria-label={labelDate(d, { day: 'numeric', month: 'long' })} aria-pressed={d === day} className={`${d.slice(0, 7) !== day.slice(0, 7) ? 'out ' : ''}${d === today ? 'tdy ' : ''}${d === day ? 'sl' : ''}`} onClick={() => setDay(d)}>{civil(d).getUTCDate()}{eventsOn(events, d).length > 0 && <u/>}</button>)}</div></section><section className="blk hl rem"><small>Próxima clase</small>{next ? <><div className="rtn">{next.title}</div><div className="rme">{labelDate(next.occurrence, { weekday: 'long', day: 'numeric', month: 'short' })} · {span(next)}</div>{next.location && <p>{next.location}</p>}</> : <p>Sin clases próximas registradas.</p>}</section><section className="blk"><h2 className="bt">Filtros</h2>{EVENT_TYPES.map(([id, label]) => <button key={id} className={`fl${hidden.has(id) ? '' : ' on'}`} role="checkbox" aria-checked={!hidden.has(id)} onClick={() => setHidden(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next })}><span className="ck">{!hidden.has(id) && <Icon name="check"/>}</span>{label}</button>)}</section></>}
      <section className="blk"><h2 className="bt">Tareas del día</h2>{!dailyTasks.length && <p>Sin tareas registradas.</p>}{dailyTasks.map(t => <div className="sc-task" key={t.id}><button className={`ck${t.completed ? ' sc-done' : ''}`} role="checkbox" aria-checked={t.completed} aria-label={`Completar ${t.title}`} disabled={busy} onClick={() => write('calendar_tasks', { completed: !t.completed }, t.id)}>{t.completed && <Icon name="check"/>}</button><span className={t.completed ? 'sc-crossed' : ''}>{t.title}</span><button className="hb" disabled={busy} aria-label={`Editar tarea ${t.title}`} onClick={() => { if (lock.current) return; previousFocus.current = document.activeElement; setDraft(null); setTaskDraft({ ...t }); setDeleting(false) }}><Icon name="edit"/></button></div>)}<button className="h-btn" disabled={busy} onClick={() => { if (lock.current) return; previousFocus.current = document.activeElement; setDraft(null); setTaskDraft({ title: '', due_date: day, completed: false }); setDeleting(false); setError(''); setMessage('') }}><Icon name="plus"/>Añadir tarea</button></section>
      <p className="sc-private">Tu calendario y tus tareas son privados.</p>
    </aside></div>
  </div>
}
export function mountOfficialCalendar(container, props) { const root = createRoot(container); root.render(<OfficialCalendar {...props}/>); return () => root.unmount() }

