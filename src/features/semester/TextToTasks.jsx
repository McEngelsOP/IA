import { useEffect, useRef, useState } from 'react'
import { MAX_TASK_TEXT } from '../../core/calendar/taskExtraction.mjs'
let sessionDraft = null

export default function TextToTasks({ client, user, courses, onSaved, onBusy, disabled = false }) {
  const cached = sessionDraft?.owner === user.id ? sessionDraft : null
  const [open, setOpen] = useState(cached?.open || false), [text, setText] = useState(cached?.text || ''), [rows, setRows] = useState(cached?.rows || null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [admin, setAdmin] = useState(false), [health, setHealth] = useState(null), [healthBusy, setHealthBusy] = useState(false), [healthError, setHealthError] = useState('')
  const alive = useRef(true), lock = useRef(false), input = useRef(null), request = useRef(null), healthRequest = useRef(null), healthLock = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); healthRequest.current?.abort() } }, [])
  useEffect(() => { client.rpc('is_app_admin').then(r => { if (alive.current) setAdmin(!r.error && r.data === true) }).catch(() => {}) }, [client, user.id])
  useEffect(() => { sessionDraft = { owner: user.id, open, text, rows } }, [user.id, open, text, rows])
  useEffect(() => { if (open) input.current?.focus() }, [open])
  const update = (index, name, value) => setRows(old => old.map((r, i) => i === index ? { ...r, [name]: value } : r))
  async function checkProviders() {
    if (healthLock.current) return
    healthLock.current = true; setHealthBusy(true); setHealthError('')
    const controller = new AbortController(); healthRequest.current = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      // Read recorded health without spending a chat request or calling AI providers.
      const result = await client.rpc('service_dashboard').abortSignal(controller.signal)
      if (result.error || !Array.isArray(result.data?.providers)) throw result.error || new Error('health')
      if (alive.current) setHealth(result.data.providers)
    } catch (issue) {
      if (alive.current) setHealthError(controller.signal.aborted
        ? 'La consulta tardó demasiado. Reintenta; no se consumió cuota de IA.'
        : issue?.code === '42501'
          ? 'Tu cuenta ya no tiene permiso para consultar este estado. Actualiza la página.'
          : 'No se pudo actualizar el estado registrado. Reintenta; puedes seguir creando tareas.')
    } finally { clearTimeout(timeout); healthLock.current = false; if (alive.current) setHealthBusy(false) }
  }
  async function generate(e) {
    e.preventDefault(); if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage(''); onBusy(true)
    request.current = new AbortController()
    const timeout = setTimeout(() => request.current.abort(), 55000)
    try {
      const { data, error: issue } = await client.functions.invoke('text-to-tasks', { body: { text }, signal: request.current.signal })
      if (issue) {
        let message = 'No pudimos generar tareas. Reintenta o añade una tarea manualmente.'
        try { message = (await issue.context.json()).message || message } catch { /* no JSON disponible */ }
        throw new Error(message)
      }
      if (!Array.isArray(data?.tasks)) throw new Error('La respuesta no es válida. Reintenta.')
      if (alive.current) {
        setRows(data.tasks.map(r => ({ ...r, id: crypto.randomUUID(), selected: true })))
        if (!data.tasks.length) setMessage('No encontramos tareas explícitas. Añade indicaciones concretas al texto.')
      }
    } catch (e) { if (alive.current) setError(e.name === 'AbortError' ? 'La IA tardó demasiado. Tu texto se conserva; reintenta.' : e.message) }
    finally { clearTimeout(timeout); lock.current = false; onBusy(false); if (alive.current) setBusy(false) }
  }
  async function save(e) {
    e.preventDefault(); if (lock.current) return
    const chosen = rows.filter(r => r.selected)
    if (!chosen.length) { setError('Selecciona al menos una tarea.'); return }
    if (chosen.some(r => !r.title.trim() || !r.due_date)) { setError('Completa el título y la fecha de cada tarea seleccionada.'); return }
    lock.current = true; setBusy(true); onBusy(true); setError('')
    try {
      const auth = await client.auth.getUser()
      if (auth.error || auth.data.user?.id !== user.id) throw new Error('session')
      const payload = chosen.map(r => ({ id: r.id, student_id: user.id, title: r.title.trim(), due_date: r.due_date, course_id: r.course_id || null, completed: false }))
      // UUID estables: reintentar una respuesta perdida no duplica tareas.
      const result = await client.from('calendar_tasks').upsert(payload, { onConflict: 'id' }).select('id,student_id,title,due_date,course_id,completed')
      if (result.error || result.data?.length !== payload.length) throw new Error('save')
      if (alive.current) { onSaved(result.data); setRows(null); setText(''); setMessage(`${result.data.length} tareas guardadas. Consulta sus fechas en el calendario.`) }
    } catch { if (alive.current) setError('No se pudo guardar. Las propuestas se conservan; reintenta.') }
    finally { lock.current = false; onBusy(false); if (alive.current) setBusy(false) }
  }
  return <section className="blk sc-text-tasks" aria-label="Texto a tareas">
    <button type="button" className="h-btn" disabled={busy || disabled} aria-expanded={open} onClick={() => setOpen(!open)}>Texto → tareas</button>
    {open && <>
      <h2 className="bt">Convierte instrucciones en tareas</h2>
      <p>Pega las indicaciones de tu profesor. Revisa las propuestas antes de guardarlas.</p>
      <form onSubmit={generate}><fieldset disabled={busy || disabled}>
        <label htmlFor="task-source">Indicaciones</label><textarea ref={input} id="task-source" required minLength={10} maxLength={MAX_TASK_TEXT} rows={5} value={text} onChange={e => { setText(e.target.value); setRows(null); setMessage('') }} placeholder="Ejemplo: entregar el informe el viernes y preparar la exposición para el lunes."/>
        <small>{text.length} / {MAX_TASK_TEXT} caracteres · Se enviará al proveedor de IA disponible.</small>
        <button className="mk" type="submit" disabled={text.trim().length < 10}>{busy ? 'Procesando…' : 'Generar propuestas'}</button>
      </fieldset></form>
      {rows?.length > 0 && <form onSubmit={save}><fieldset disabled={busy || disabled}>
        <h3>Revisa tus tareas</h3><p>Las fechas interpretadas necesitan tu revisión. Completa las que falten.</p>
        <div className="sc-proposals">{rows.map((r, i) => <div className="sc-task-proposal" key={r.id}>
          <label className="sc-check"><input type="checkbox" checked={r.selected} onChange={e => update(i, 'selected', e.target.checked)}/>Guardar tarea {i + 1}</label>
          <label>Título<input required={r.selected} maxLength={160} value={r.title} onChange={e => update(i, 'title', e.target.value)}/></label>
          <label>Fecha{!r.due_date && <small>Completa la fecha</small>}<input type="date" required={r.selected} value={r.due_date || ''} onChange={e => update(i, 'due_date', e.target.value)}/></label>
          <label>Curso<select value={r.course_id || ''} onChange={e => update(i, 'course_id', e.target.value)}><option value="">Sin curso</option>{courses.map(c => <option key={c.id} value={c.id}>{c.n}</option>)}</select></label>
        </div>)}</div>
        <div className="sc-actions"><button className="mk" type="submit">Guardar seleccionadas</button><button className="h-btn" type="button" onClick={() => { setRows(null); setError('') }}>Descartar propuestas</button></div>
      </fieldset></form>}
    </>}
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{message}</p>
    {admin && open && <details className="sc-provider-health"><summary>Estado de los servicios de IA</summary><p>Solo administrador · consulta el último estado registrado sin consumir cuota de IA. No realiza una prueba de disponibilidad actual.</p><button type="button" className="h-btn" disabled={healthBusy || disabled} onClick={checkProviders}>{healthBusy ? 'Consultando estado…' : 'Actualizar estado de IA'}</button>{healthError && <p role="alert">{healthError}</p>}{health && <div role="status" aria-live="polite">{health.length ? <ul>{health.map(p => <li key={p.provider}><strong>{p.provider}</strong>: {new Date(p.retry_until) > new Date() ? 'En pausa temporal' : ({ ok: 'Última respuesta correcta', not_configured: 'Sin configurar', rate_limited: 'Cuota agotada o pausa temporal', provider_configuration: 'Revisar configuración', provider_timeout: 'Última consulta sin respuesta a tiempo', provider_unavailable: 'Última consulta no disponible' }[p.last_status] || 'Sin actividad registrada')}{p.last_model && ` · ${p.last_model}`}{p.updated_at && <small>Registrado el {new Date(p.updated_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })} · hora de Lima</small>}</li>)}</ul> : <p>Aún no hay actividad registrada de proveedores.</p>}</div>}</details>}

  </section>
}
