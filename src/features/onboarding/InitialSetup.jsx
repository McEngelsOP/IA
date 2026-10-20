import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SETUP_STEPS, newSetup, completedCourses, changeSemester, togglePending, scheduleEvents, setupPreferences, normalize, resumeSetupStep } from './setupModel.js'
import './InitialSetup.css'

function Mark({ checked = false, arrow = false }) { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{arrow ? <path d="M5 12h14m-6-6 6 6-6 6"/> : checked ? <path d="m5 12 4 4 10-10"/> : <rect x="4" y="4" width="16" height="16" rx="4"/>}</svg> }
function InitialSetup({ client, user, career, saved, preferencesOnly = false, renderPet, onBusy, onClose, onComplete }) {
  const initial = useRef({ ...newSetup(career, document.documentElement.dataset.theme || 'light'), ...(preferencesOnly ? saved?.preferences : saved?.draft), career: career.key })
  const [draft, setDraft] = useState(() => ({ ...initial.current, token: initial.current.token || crypto.randomUUID(), step: preferencesOnly ? 3 : resumeSetupStep(saved?.draft || initial.current) }))
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState(''), [adding, setAdding] = useState(false)
  const panel = useRef(null), heading = useRef(null), lock = useRef(false), alive = useRef(true)
  const courses = career.cursos, cycles = [...new Set(courses.map(c => c.c).filter(n => n > 0))].sort((a, b) => a - b)
  const patch = values => setDraft(d => ({ ...d, ...values }))
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { panel.current?.scrollTo(0, 0); heading.current?.focus({ preventScroll: true }); setError(''); setQuery(''); setAdding(false) }, [draft.step, draft.reviewCycle])
  async function verify() { const result = await client.auth.getUser(); if (result.error || result.data.user?.id !== user.id) throw new Error('Tu sesión venció. Vuelve a iniciar sesión para guardar.') }
  async function persist(next) {
    await verify()
    const result = await client.rpc('save_student_setup_draft', { value: { ...next, career: career.key } })
    if (result.error) throw new Error('No se pudo guardar el borrador. Reintenta; tus selecciones siguen aquí.')
  }
  async function navigate(next, close = false) {
    if (lock.current) return
    lock.current = true; setBusy(true); onBusy(true); setError('')
    try { if (!preferencesOnly) await persist(next); if (alive.current) { if (close) onClose(); else setDraft(next) } }
    catch (e) { if (alive.current) setError(e.message) }
    finally { lock.current = false; if (alive.current) setBusy(false); onBusy(false) }
  }
  function advance() {
    if (draft.step === 1 && draft.reviewCycle < draft.semester) return navigate({ ...draft, reviewCycle: draft.reviewCycle + 1 })
    if (draft.step === 4 && draft.scheduleChoice === 'upload') {
      if (!draft.schedule.length) { setError('Elige tu archivo y revisa la vista previa, o selecciona «Lo armaré después».'); return }
      try { scheduleEvents(draft) } catch (e) { setError(e.message); return }
      const missing = draft.schedule.find(r => r.courseId && !draft.enrolled.includes(r.courseId))
      if (missing) { setError(`«${missing.title}» no está seleccionado entre tus cursos de este ciclo. Regresa a Ciclo y agrégalo antes de importar.`); return }
    }
    navigate({ ...draft, step: draft.step + 1 })
  }
  function back() {
    if (preferencesOnly && draft.step === 5) return navigate({ ...draft, step: 3 })
    if (draft.step === 1 && draft.reviewCycle > 1) return navigate({ ...draft, reviewCycle: draft.reviewCycle - 1 })
    navigate({ ...draft, step: draft.step - 1, ...(draft.step === 2 ? { reviewCycle: draft.semester } : {}) })
  }
  async function finish() {
    if (lock.current) return
    lock.current = true; setBusy(true); onBusy(true); setError('')
    try {
      await verify()
      const preferences = setupPreferences(draft)
      const payload = preferencesOnly ? preferences : { ...preferences, career: career.key, token: draft.token, done: completedCourses(courses, draft), enrolled: draft.enrolled.filter(id => !completedCourses(courses, draft).includes(id)), events: draft.scheduleChoice === 'upload' ? scheduleEvents(draft) : [] }
      const result = await client.rpc(preferencesOnly ? 'save_student_setup_preferences' : 'complete_student_setup', { value: payload })
      if (result.error) throw new Error(result.error.message?.includes('ALREADY_COMPLETED') ? 'La configuración se completó en otra pestaña. Recarga para ver tus datos.' : 'No se pudo confirmar la configuración. No se aplicaron cambios parciales; puedes reintentar.')
      if (alive.current) onComplete(preferences)
    } catch (e) { if (alive.current) setError(e.message) }
    finally { lock.current = false; if (alive.current) setBusy(false); onBusy(false) }
  }
  const enrolled = courses.filter(c => draft.enrolled.includes(c.id)), completed = completedCourses(courses, draft)
  const toggleEnrolled = id => patch({ enrolled: draft.enrolled.includes(id) ? draft.enrolled.filter(v => v !== id) : [...draft.enrolled, id] })
  const courseButton = (c, selected, callback, disabled = false) => <button type="button" key={c.id} className={'setup-course' + (selected ? ' selected' : '')} aria-pressed={selected} onClick={callback} disabled={disabled}><Mark checked={selected}/><span><b>{c.n}</b><small>Ciclo {c.c || 'pre-formación'} · {c.cr} créditos</small></span></button>
  const info = [
    ['¿En qué semestre te encuentras?', 'Marcaremos como llevados los cursos de los ciclos anteriores. En el siguiente paso podrás corregir los pendientes.'],
    [draft.reviewCycle === draft.semester ? `Llegaste a tu ciclo actual: ${draft.semester}` : `¿Te queda algún curso del ciclo ${draft.reviewCycle}?`, draft.reviewCycle === draft.semester ? 'Estos cursos aún no se marcan como llevados. En el siguiente paso elegirás cuáles estás cursando.' : 'Marca solo los cursos que todavía no has llevado. Los demás quedarán como llevados.'],
    ['¿Qué cursos llevas este ciclo?', 'Preseleccionamos los de tu semestre. Desmarca los que no lleves o agrega otros de tu malla.'],
    ['¿Cuántos créditos llevas por ciclo?', 'Planificar usará esta carga habitual para comparar tus próximos semestres.'],
    ['Tu horario se prepara en Mi semestre', 'Cuando termines, podrás importar tu Excel y revisar las clases antes de guardarlas.'],
    ['Personaliza tu espacio', 'Elige cómo quieres estudiar en Mod Focus y el tema de tu espacio. Este paso es opcional.'],
    ['Tu espacio está casi listo', 'Revisa tus elecciones. Solo se aplicarán cuando confirmes.']
  ][draft.step]
  return <div className="setup-backdrop"><section className="setup-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="setup-title" onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); if (!lock.current) navigate(draft, true) }
    if (e.key === 'Tab') { const nodes = [...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')].filter(n => n.getClientRects().length); const first = nodes[0], last = nodes.at(-1); if (e.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { e.preventDefault(); last?.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() } }
  }}>
    <header className="setup-brand"><span dangerouslySetInnerHTML={{ __html: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 2c1 6 4 9 10 10-6 1-9 4-10 10-1-6-4-9-10-10 6-1 9-4 10-10Z"/></svg>' }}/><b>Lyra</b><button className="setup-text" onClick={() => navigate(draft, true)} disabled={busy}>{preferencesOnly ? 'Cerrar' : 'Continuar después'}</button></header>
    <ol className="setup-progress" aria-label="Progreso de configuración">{SETUP_STEPS.map((label, i) => <li key={label} className={i === draft.step ? 'current' : i < draft.step ? 'visited' : ''} aria-current={i === draft.step ? 'step' : undefined}><span/><small>{label}</small></li>)}</ol>
    <h2 id="setup-title" tabIndex="-1" ref={heading}>{info[0]}</h2><p className="setup-intro">{info[1]}</p>
    <fieldset className="setup-body" disabled={busy}>
      {draft.step === 0 && <><p className="setup-career">{career.nombre}</p><div className="setup-semesters" aria-label="Semestre actual">{cycles.map(n => <button key={n} className={(draft.semester === n ? 'current' : draft.semester > n ? 'previous' : '')} aria-pressed={draft.semester === n} onClick={() => setDraft(d => changeSemester(career, d, n))}>{n}</button>)}</div><p className="setup-note">{draft.semester === 1 ? 'Estás empezando: todavía no marcaremos cursos como llevados.' : `Se marcarán como llevados los ciclos 1 al ${draft.semester - 1}, salvo los pendientes que indiques.`}</p>{courses.some(c => c.c === 0) && <p className="setup-muted">Pre-formación se revisa manualmente desde tu malla.</p>}</>}
      {draft.step === 1 && <><div className="setup-cycle-nav"><button onClick={() => navigate({ ...draft, reviewCycle: draft.reviewCycle - 1 })} disabled={draft.reviewCycle === 1}>Ciclo anterior</button><span>Ciclo {draft.reviewCycle} de {draft.semester}</span><button onClick={advance}>{draft.reviewCycle < draft.semester ? 'Siguiente ciclo' : 'Elegir mis cursos'}</button></div><div className="setup-course-list">{courses.filter(c => c.c === draft.reviewCycle).map(c => courseButton(c, draft.reviewCycle === draft.semester ? false : draft.pending.includes(c.id), () => setDraft(d => togglePending(d, c.id, c.c)), draft.reviewCycle === draft.semester))}</div><p className="setup-note">{draft.pending.length} {draft.pending.length === 1 ? 'curso pendiente' : 'cursos pendientes'} de ciclos anteriores. Si no tienes ninguno en este ciclo, puedes avanzar directamente.</p></>}
      {draft.step === 2 && <><div className="setup-course-list">{courses.filter(c => c.c === draft.semester || draft.enrolled.includes(c.id)).map(c => courseButton(c, draft.enrolled.includes(c.id), () => toggleEnrolled(c.id)))}</div><p className="setup-note">{enrolled.length} cursos · {enrolled.reduce((s, c) => s + c.cr, 0)} créditos</p><p className="setup-muted">Los cursos adelantados los puedes llenar manualmente.</p><button className="setup-add" onClick={() => setAdding(v => !v)} aria-expanded={adding}>Agregar otro curso de mi malla</button>{adding && <div className="setup-add-list"><label>Buscar curso<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre del curso"/></label><div className="setup-course-list">{courses.filter(c => !completed.includes(c.id) && !draft.enrolled.includes(c.id) && normalize(c.n).includes(normalize(query))).map(c => courseButton(c, false, () => toggleEnrolled(c.id)))}</div></div>}</>}
      {draft.step === 3 && <><div className="setup-load"><output>{draft.credits}</output><span>créditos por ciclo</span></div><div className="setup-loads">{[12, 14, 16, 18, 20, 24].map(n => <button key={n} aria-pressed={draft.credits === n} onClick={() => patch({ credits: n })}>{n}</button>)}</div><label className="setup-field setup-narrow">Otra carga habitual<input type="number" min="1" max="30" step="0.5" value={draft.credits} onChange={e => patch({ credits: Number(e.target.value) })}/></label><p className="setup-muted">Es una estimación para planificar, no un límite oficial de matrícula.</p></>}
      {draft.step === 4 && <><p>La importación de horarios se encuentra en <b>Mi semestre → Importar horario de Excel</b>. Allí podrás confirmar las fechas y corregir cada clase.</p>{draft.scheduleChoice === 'upload' && draft.schedule.length > 0 ? <><p>Conservamos las {draft.schedule.length} clases de tu borrador anterior. Se guardarán cuando confirmes esta configuración.</p><button type="button" className="setup-text" onClick={() => patch({ scheduleChoice: 'later', schedule: [] })}>Configurar el horario después</button></> : <p className="setup-note">Por ahora guardaremos tu carrera, avance y cursos actuales.</p>}</>}
      {draft.step === 5 && <><div className="setup-pets">{[['cat', 'Miso', 'Tranquilo y constante'], ['rabbit', 'Nube', 'Suave y relajado'], ['owl', 'Sabio', 'Curioso y observador']].map(([key, name, desc]) => <button key={key} aria-pressed={draft.companion === key} onClick={() => patch({ companion: key })}><span dangerouslySetInnerHTML={{ __html: renderPet(key) }}/><b>{name}</b><small>{desc}</small></button>)}</div><div className="setup-preferences"><label>Método de estudio<select value={draft.method} onChange={e => patch({ method: e.target.value })}><option value="p25">Pomodoro · 25 min</option><option value="p45">Estudio · 45 min</option><option value="p90">Profundo · 90 min</option></select></label><label>Estilo del reloj<select value={draft.clockStyle} onChange={e => patch({ clockStyle: e.target.value })}>{[['ring', 'Anillo'], ['digital', 'Digital'], ['arc', 'Arco'], ['dots', 'Puntos']].map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label></div><div className="setup-theme" role="group" aria-label="Tema">{[['dark', 'Oscuro'], ['light', 'Claro']].map(([k, label]) => <button key={k} aria-pressed={draft.theme === k} onClick={() => patch({ theme: k })}>{label}</button>)}</div></>}
      {draft.step === 6 && <><dl className="setup-summary">{(preferencesOnly ? [] : [['Semestre', `Ciclo ${draft.semester}`], ['Llevados', `${completed.length} cursos de ciclos anteriores`], ['Pendientes', `${draft.pending.length} cursos de ciclos anteriores`], ['Este ciclo', `${enrolled.length} cursos · ${enrolled.reduce((s, c) => s + c.cr, 0)} créditos`] ]).concat([['Carga habitual', `${draft.credits} créditos por ciclo`], ...(preferencesOnly ? [] : [['Horario', draft.scheduleChoice === 'upload' ? `${draft.schedule.length} clases por semana · ${draft.scheduleStart} al ${draft.scheduleEnd}` : 'Lo configuraré después']]), ['Espacio', `${{ cat: 'Miso', rabbit: 'Nube', owl: 'Sabio' }[draft.companion]} · ${draft.method === 'p25' ? '25' : draft.method === 'p90' ? '90' : '45'} min · tema ${draft.theme === 'dark' ? 'oscuro' : 'claro'}`]]).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{!preferencesOnly && <details><summary>Ver cursos de este ciclo</summary><ul>{enrolled.map(c => <li key={c.id}>{c.n}</li>)}</ul></details>}<p className="setup-note">{preferencesOnly ? 'Los cambios se aplicarán a tus preferencias de estudio.' : 'Tu malla, tus cursos matriculados, Planificar y el calendario quedarán preparados. Puedes ajustar tus cursos después desde la malla.'}</p></>}
    </fieldset>
    {error && <p className="setup-error" role="alert">{error}</p>}
    <footer className="setup-footer"><button className="setup-text" onClick={back} disabled={busy || draft.step === (preferencesOnly ? 3 : 0)}>Atrás</button><span role="status">{busy ? 'Guardando…' : preferencesOnly ? 'Preferencias de estudio' : `Paso ${draft.step + 1} de 7`}</span>{draft.step === 5 && <button className="setup-text" onClick={advance} disabled={busy}>Omitir por ahora</button>}<button className="setup-primary" onClick={draft.step === 6 ? finish : () => { if (draft.step === 3 && (!Number.isFinite(draft.credits) || draft.credits < 1 || draft.credits > 30 || draft.credits * 2 % 1)) { setError('Elige una carga de 1 a 30 créditos, en pasos de 0,5.'); return } if (preferencesOnly && draft.step === 3) navigate({ ...draft, step: 5 }); else advance() }} disabled={busy}>{busy ? 'Guardando…' : draft.step === 6 ? preferencesOnly ? 'Guardar preferencias' : 'Confirmar y entrar' : draft.step === 1 && draft.reviewCycle < draft.semester ? 'Siguiente ciclo' : 'Continuar'}<Mark arrow/></button></footer>
  </section></div>
}
export function mountInitialSetup(container, props) { const root = createRoot(container); root.render(<InitialSetup {...props}/>); return () => root.unmount() }
