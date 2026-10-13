import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CARRERAS } from '../data/carreras'
import { AREAS } from '../data/areas'
import { buildMalla, bfs, edgePath, COL_W, LEFT, completedCredits, canTake, previewCompleted, validPlan, canPlan, enrolledIds } from '../lib/curriculumGraph'
import '../styles/OfficialCurriculum.css'
import CourseCommunity from './CourseCommunity'

const MODES = [
  ['open', '¿Qué abre?'], ['req', '¿Qué requiere?'], ['noreq', '¿Qué puedo llevar?'],
  ['done', 'Aprobados'], ['plan', 'Próximo semestre'], ['semester', 'Cursos de este semestre'], ['ficha', 'Ficha del curso']
]
const HINTS = {
  open: 'Selecciona un curso para ver todo lo que abre en cadena.',
  req: 'Selecciona un curso para ver sus prerrequisitos en cadena.',
  noreq: 'Los cursos resaltados están disponibles según tus aprobados y créditos; los cursos en curso se excluyen.',
  done: 'Marca solo los cursos aprobados o convalidados. Cada cambio afecta únicamente al curso elegido.',
  plan: 'Los cursos en curso no se repiten. Los requisitos en curso deberán aprobarse antes de tu próximo semestre.',
  ficha: 'Selecciona un curso para consultar su ficha y registrar su nota.',
  semester: 'Selecciona los cursos que estás llevando ahora y guarda tu matrícula. Puedes elegir cursos de distintos ciclos.'
}
const STATUS = { aprobado: 'Aprobado', convalidado: 'Convalidado', matriculado: 'En curso', desaprobado: 'Desaprobado' }
const norm = text => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const number = n => n.toLocaleString('es-PE', { maximumFractionDigits: 2 })
const MALLAS = new Map()
let semesterSessionDraft = null
function getMalla(key) {
  const career = CARRERAS[key] || CARRERAS.ia
  if (!MALLAS.has(career.key)) MALLAS.set(career.key, buildMalla(career))
  return MALLAS.get(career.key)
}

function Icon({ name }) {
  const paths = { search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>, left: <path d="m14 6-6 6 6 6"/>, right: <path d="m10 6 6 6-6 6"/>, tick: <path d="m5 12 4 4 10-10"/>, close: <path d="m6 6 12 12M6 18 18 6"/> }
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function OfficialCurriculum({ career, user, client, sessionMode, initialDone, initialPlan, statuses: initialStatuses, initialGrades, currentSemester, onSemesterChange = () => {}, onProgressChange, onGradeChange, onStatusChange, onBusy }) {
  const M = getMalla(career)
  const [savedSemester, setSavedSemester] = useState(currentSemester || ''), [semester, setSemester] = useState(currentSemester || ''), [onlyRelated, setOnlyRelated] = useState(false)
  const [preferredView, setPreferredView] = useState(null), [cycle, setCycle] = useState('all')
  const view = preferredView || 'graph'
  const surface = useRef(null)
  const cachedSemester = semesterSessionDraft?.owner === user?.id && semesterSessionDraft?.career === career ? semesterSessionDraft : null
  const [mode, setMode] = useState(cachedSemester?.mode || 'open'), [selected, setSelected] = useState(null)
  const [done, setDone] = useState(() => new Set(initialDone)), [plan, setPlan] = useState(() => validPlan(M, new Set(initialPlan), new Set(initialDone), initialStatuses))
  const [grades, setGrades] = useState(initialGrades), [area, setArea] = useState(null)
  const [query, setQuery] = useState(''), [matchIndex, setMatchIndex] = useState(0), [zoom, setZoom] = useState(1)
  const [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [gradeDraft, setGradeDraft] = useState('')
  const [statuses, setStatuses] = useState(initialStatuses), [statusDraft, setStatusDraft] = useState('')
  const [semesterDraft, setSemesterDraft] = useState(() => new Set(cachedSemester?.ids || Object.keys(initialStatuses).filter(id => initialStatuses[id]?.status === 'matriculado')))
  useEffect(() => { semesterSessionDraft = { owner: user?.id, career, mode: mode === 'semester' ? 'semester' : 'open', ids: mode === 'semester' ? [...semesterDraft] : null } }, [user?.id, career, mode, semesterDraft])
  const scroller = useRef(null), areas = useRef(null), search = useRef(null), detail = useRef(null), confirm = useRef(null)
  const drag = useRef(null), locked = useRef(false), mounted = useRef(true), previousFocus = useRef(null)
  const isLive = sessionMode === 'live' && !!user && !!client
  const credits = completedCredits(M, done), available = M.cursos.filter(c => canTake(c, done, credits, statuses))
  const course = M.byId[selected]
  const chain = useMemo(() => selected && ['open', 'req'].includes(mode)
    ? bfs(selected, id => mode === 'open' ? M.unlocks[id] : M.byId[id]?.r) : new Set(), [M, selected, mode])
  const matches = useMemo(() => query.trim() ? M.cursos.filter(c => norm(c.n).includes(norm(query.trim()))) : [], [M, query])
  const matchSet = new Set(matches.map(c => c.id))
  const visibleCourses = M.cursos.filter(c => (cycle === 'all' || String(c.c) === cycle) && (!area || c.a === area) && (!query.trim() || matchSet.has(c.id)))
  const cycleKeys = Object.keys(M.ciclos).map(Number).sort((a, b) => a - b)
  function focusCourse(id) { surface.current?.querySelector(`[data-course="${id}"]`)?.focus({ preventScroll: true }) }
  const cleanPlan = validPlan(M, plan, done, statuses)
  const planned = M.cursos.filter(c => cleanPlan.has(c.id)), planCredits = planned.reduce((sum, c) => sum + c.cr, 0)
  const afterCurrent = new Set([...done, ...enrolledIds(statuses)])
  const planAfter = new Set([...afterCurrent, ...cleanPlan])
  const opensAfter = M.cursos.filter(c => canTake(c, planAfter, completedCredits(M, planAfter)) && !canTake(c, afterCurrent, completedCredits(M, afterCurrent)))

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setStatusDraft(course ? statuses[course.id]?.status || '' : '') }, [course?.id, statuses])
  useEffect(() => { setGradeDraft(course && Number.isFinite(grades[course.id]) ? String(grades[course.id]) : '') }, [course?.id, grades])
  useEffect(() => {
    const c = matches[matchIndex]
    if (c) scroller.current?.scrollTo({ left: Math.max(0, c.x * zoom - 80), top: Math.max(0, c.y * zoom - 100), behavior: 'auto' })
  }, [matches, matchIndex, zoom, view])
  useEffect(() => {
    if (mode === 'ficha' && course) {
      detail.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
      detail.current?.focus({ preventScroll: true })
    }
  }, [mode, course?.id])
  useEffect(() => { if (pending) { confirm.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' }); confirm.current?.focus({ preventScroll: true }) } }, [pending])
  useEffect(() => {
    const handler = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.current?.focus(); search.current?.select() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function changeMode(next) {
    if (locked.current || mode === next) return
    setMode(next); setOnlyRelated(false); setPending(null); setMessage(''); setError('')
    if (next === 'semester') { setSemester(savedSemester); setSemesterDraft(enrolledIds(statuses)) }
    if (!['open', 'req'].includes(next)) setSelected(null)
  }
  async function verifiedUser() {
    const verified = await client.auth.getUser()
    if (verified.error || verified.data.user?.id !== user.id) throw new Error('session_failed')
  }
  function begin() { locked.current = true; setBusy(true); onBusy(true); setError(''); setMessage('') }
  function finish() { locked.current = false; onBusy(false); if (mounted.current) setBusy(false) }
  function applyAcademic(result) {
    const nextDone = new Set(result.done || []), nextStatuses = result.statuses ? Object.fromEntries(result.statuses.map(row => [row.course_id, row])) : statuses
    const nextPlan = validPlan(M, new Set(result.plan || []), nextDone, nextStatuses)
    onProgressChange(nextDone, nextPlan)
    if (result.statuses) for (const id of new Set([...Object.keys(statuses), ...Object.keys(nextStatuses)])) onStatusChange(id, nextStatuses[id] || null)
    if (mounted.current) { setDone(nextDone); setPlan(nextPlan); setStatuses(nextStatuses); setSemesterDraft(enrolledIds(nextStatuses)) }
  }
  async function saveProgress(nextDone, nextPlan) {
    if (locked.current) return false
    begin()
    try {
      let result
      if (isLive) {
        await verifiedUser()
        const saved = await client.rpc('save_academic_progress', { p_done: [...nextDone], p_plan: [...nextPlan], p_expected_done: [...done] })
        if (saved.error) throw saved.error
        result = saved.data
      } else {
        const nextStatuses = { ...statuses }
        for (const id of done) if (!nextDone.has(id)) delete nextStatuses[id]
        for (const id of nextDone) nextStatuses[id] = { ...nextStatuses[id], course_id: id, status: 'aprobado' }
        result = { done: [...nextDone], plan: [...nextPlan], statuses: Object.values(nextStatuses) }
      }
      applyAcademic(result)
      if (mounted.current) { setMessage(isLive ? 'Avance y estados actualizados en tu cuenta.' : 'Cambios aplicados a esta vista.'); setPending(null) }
      return true
    } catch (e) {
      if (mounted.current) setError(e.message?.includes('academic_state_changed') ? 'Tu avance cambió en otra pestaña. Recarga antes de volver a guardar.' : 'No se pudo guardar. Tu avance anterior se conserva; reintenta.')
      return false
    } finally { finish() }
  }
  function requestDone(id) {
    if (locked.current) return
    const preview = previewCompleted(M, done, id)
    if (preview.blocked) { setError(`${preview.blocked.n} requiere ${preview.blocked.rc} créditos aprobados previos. Registra primero tu avance.`); return }
    previousFocus.current = document.activeElement
    setPending({ ...preview, id }); setError(''); setMessage('')
  }
  function cancelPending() { setPending(null); previousFocus.current?.focus({ preventScroll: true }) }
  async function confirmDone() {
    const id = pending?.id
    if (pending && await saveProgress(pending.next, validPlan(M, plan, pending.next, statuses))) {
      focusCourse(id)
    }
  }
  function togglePlan(id) {
    if (locked.current) return
    const next = validPlan(M, plan, done, statuses)
    if (next.has(id)) next.delete(id)
    else if (!canPlan(M, M.byId[id], done, statuses)) { setError('Este curso ya está aprobado, está en curso o tiene requisitos pendientes. Elige un curso disponible para el próximo semestre.'); return }
    else next.add(id)
    saveProgress(done, next)
  }
  function selectCourse(id) {
    if (drag.current?.moved || locked.current) return
    setError(''); setMessage('')
    if (mode === 'semester') {
      if (done.has(id)) { setError('Este curso ya está aprobado. Selecciona los que estás llevando actualmente.'); return }
      setSemesterDraft(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next }); return
    }
    if (mode === 'done') requestDone(id)
    else if (mode === 'plan') togglePlan(id)
    else setSelected(previous => previous === id ? null : id)
  }
  async function saveGrade(e) {
    e.preventDefault()
    if (locked.current || !course || (!done.has(course.id) && statuses[course.id]?.status !== 'desaprobado')) return
    const raw = gradeDraft.trim(), value = raw === '' ? null : Number(raw.replace(',', '.'))
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 20)) { setError('Escribe una nota entre 0 y 20.'); return }
    begin()
    try {
      if (isLive) {
        await verifiedUser()
        const result = value === null
          ? await client.from('grades').delete().match({ student_id: user.id, course_id: course.id })
          : await client.from('grades').upsert({ student_id: user.id, course_id: course.id, grade: value, updated_at: new Date().toISOString() }, { onConflict: 'student_id,course_id' })
        if (result.error) throw result.error
      }
      onGradeChange(course.id, value)
      if (mounted.current) {
        setGrades(previous => { const next = { ...previous }; if (value === null) delete next[course.id]; else next[course.id] = value; return next })
        setMessage(isLive ? 'Nota guardada en tu cuenta y en Inicio.' : 'Nota aplicada a esta vista; no se guarda en la nube.')
      }
    } catch { if (mounted.current) setError('No se pudo guardar la nota. La anterior se conserva; reintenta.') }
    finally { finish() }
  }
  async function saveStatus(e) {
    e.preventDefault()
    if (locked.current || !isLive || !course || done.has(course.id)) return
    begin()
    try {
      await verifiedUser()
      const nextStatuses = { ...statuses }; if (statusDraft) nextStatuses[course.id] = { status: statusDraft }; else delete nextStatuses[course.id]
      const result = await client.rpc('save_academic_course_status', { p_course: course.id, p_status: statusDraft, p_plan: [...validPlan(M, plan, done, nextStatuses)] })
      if (result.error) throw result.error
      applyAcademic(result.data)
      if (mounted.current) setMessage('Estado y plan actualizados. Inicio y Focus usan esta matrícula.')
    } catch { if (mounted.current) setError('No se pudo guardar el estado. El registro anterior se conserva; reintenta.') }
    finally { finish() }
  }
  async function saveSemester() {
    if (locked.current || !isLive) return
    if (!semester) { setError('Indica tu semestre actual antes de guardar.'); return }
    if (semesterDraft.size > 30) { setError('Selecciona como máximo 30 cursos.'); return }
    begin()
    try {
      await verifiedUser()
      const nextStatuses = Object.fromEntries(Object.entries(statuses).filter(([id, row]) => row.status !== 'matriculado' || semesterDraft.has(id)))
      for (const id of semesterDraft) nextStatuses[id] = { status: 'matriculado' }
      const result = await client.rpc('save_current_semester', { p_courses: [...semesterDraft], p_semester: Number(semester), p_plan: [...validPlan(M, plan, done, nextStatuses)] })
      if (result.error || !result.data?.statuses) throw new Error('save')
      applyAcademic(result.data)
      setSavedSemester(Number(semester)); onSemesterChange(Number(semester))
      if (mounted.current) setMessage('Semestre y matrícula guardados. Los cursos en curso se retiraron del plan futuro.')
    } catch { if (mounted.current) setError('No se pudo guardar la matrícula. La selección se conserva; reintenta.') }
    finally { finish() }
  }
  function adjustZoom(next) {
    const z = Math.min(1.8, Math.max(0.6, Math.round(next * 100) / 100)), node = scroller.current
    if (!node) return
    const left = (node.scrollLeft + node.clientWidth / 2) * z / zoom - node.clientWidth / 2
    const top = (node.scrollTop + node.clientHeight / 2) * z / zoom - node.clientHeight / 2
    setZoom(z)
    requestAnimationFrame(() => { if (node.isConnected) { node.scrollLeft = left; node.scrollTop = top } })
  }
  function nodeClass(c) {
    const classes = ['oc-node']
    if (done.has(c.id)) classes.push('is-done')
    else if (statuses[c.id]?.status === 'matriculado') classes.push('is-enrolled')
    if (selected === c.id) classes.push('is-selected')
    if (chain.has(c.id)) classes.push(mode === 'req' ? 'is-required' : 'is-opened')
    if (['noreq', 'plan'].includes(mode)) classes.push((mode === 'plan' ? canPlan(M, c, done, statuses) : canTake(c, done, credits, statuses)) ? 'is-available' : done.has(c.id) ? '' : 'is-unavailable')
    if (cleanPlan.has(c.id)) classes.push('is-planned')
    if (mode === 'semester' && semesterDraft.has(c.id)) classes.push('is-selected')
    if (area && c.a !== area) classes.push('is-muted')
    if (selected && ['open', 'req'].includes(mode) && selected !== c.id && !chain.has(c.id)) classes.push('is-muted')
    if (query.trim()) classes.push(matchSet.has(c.id) ? 'is-match' : 'is-muted')
    return classes.filter(Boolean).join(' ')
  }
  function lineClass(edge) {
    const active = selected && (mode === 'open'
      ? chain.has(edge.to) && (edge.from === selected || chain.has(edge.from))
      : mode === 'req' && chain.has(edge.from) && (edge.to === selected || chain.has(edge.to)))
    return `oc-edge${active ? ' is-chain ' + mode : ''}${(selected && ['open', 'req'].includes(mode) && !active) || (area && M.byId[edge.to].a !== area) ? ' is-muted' : ''}`
  }
  const hasFilter = !!(area || query.trim() || (selected && ['open','req'].includes(mode)) || ['plan','noreq'].includes(mode))
  const focused = c => (!area || c.a === area) && (!query.trim() || matchSet.has(c.id)) && (!selected || !['open','req'].includes(mode) || c.id === selected || chain.has(c.id)) && (mode !== 'plan' || canPlan(M,c,done,statuses)) && (mode !== 'noreq' || canTake(c,done,credits,statuses))
  const graphVisible = c => !onlyRelated || !hasFilter || focused(c)
  const displayedCourses = visibleCourses.filter(graphVisible)
  const modeGroup = ['done','semester'].includes(mode) ? 'progress' : mode === 'plan' ? 'plan' : 'explore'
  const list = ids => ids.map(id => M.byId[id]).filter(Boolean).map(c => <button key={c.id} type="button" className="oc-link" onClick={() => { setSelected(c.id); setPending(null); }}>{c.n}</button>)
  const selectedStatus = course && (done.has(course.id) ? statuses[course.id]?.status === 'convalidado' ? 'convalidado' : 'aprobado' : ['aprobado', 'convalidado'].includes(statuses[course.id]?.status) ? null : statuses[course.id]?.status)

  return <section className="oc" ref={surface} aria-label="Malla curricular interactiva" onKeyDown={e => {
    if (e.key === 'Escape' && pending && !busy) { e.stopPropagation(); cancelPending() }
    else if (e.key === 'Escape' && selected) { e.stopPropagation(); const id = selected; setSelected(null); focusCourse(id) }
  }}>
    <div className="oc-header">
      <div><h2>{M.nombre}</h2><p>{M.uni} · {M.ciclosLabel} · {number(M.total)} créditos</p></div>
      <div className="oc-progress"><strong>{M.cursos.filter(c => done.has(c.id)).length}<span> / {M.cursos.length} aprobados</span></strong><span>{number(credits)} / {number(M.total)} créditos</span></div>
    </div>
    {!isLive && <p className="oc-visitor">Modo visitante. Explora la malla de {M.uni}. Los cambios duran mientras esta página esté abierta. <a href="./login.html">Iniciar sesión</a></p>}
    <div className="oc-workspace-controls">
      <div className="oc-modes" role="group" aria-label="Qué quieres hacer">{[['explore','Explorar','open'],['progress','Mi avance','done'],['plan','Próximo semestre','plan']].map(([group,label,target]) => <button key={group} type="button" className={modeGroup === group ? 'on' : ''} aria-pressed={modeGroup === group} disabled={busy} onClick={() => changeMode(target)}>{modeGroup === group && <Icon name="tick"/>}{label}</button>)}</div>
      {modeGroup === 'explore' && <label className="oc-explore-select">Ver<select aria-label="Qué explorar" value={mode} onChange={e => changeMode(e.target.value)}>{MODES.filter(([key]) => ['open','req','noreq','ficha'].includes(key)).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
      {modeGroup === 'progress' && <div className="oc-submodes" role="group" aria-label="Registro académico">{[['done','Aprobados'],['semester','Este semestre']].map(([key,label]) => <button key={key} type="button" aria-pressed={mode === key} disabled={busy} onClick={() => changeMode(key)}>{label}</button>)}</div>}
      <button className="oc-semester-edit" type="button" disabled={busy} onClick={() => changeMode('semester')}>{savedSemester ? `Semestre actual: ${savedSemester}` : 'Indicar mi semestre'} · Editar</button>
    </div>
    <div className="oc-view-switch" role="group" aria-label="Vista de la malla">
      <button type="button" aria-pressed={view === 'cycles'} disabled={busy} onClick={() => setPreferredView('cycles')}>Por ciclos</button>
      <button type="button" aria-pressed={view === 'graph'} disabled={busy} onClick={() => setPreferredView('graph')}>Grafo completo</button>
    </div>
    <div className="oc-tools">
      <label className="oc-search"><Icon name="search"/><input ref={search} value={query} placeholder="Buscar curso…" aria-label="Buscar curso en la malla" onChange={e => { setQuery(e.target.value); setMatchIndex(0); }} onKeyDown={e => {
        if (e.key === 'Enter' && view === 'graph' && matches.length) { e.preventDefault(); setMatchIndex(i => (i + 1) % matches.length) }
        if (e.key === 'Escape') { e.stopPropagation(); setQuery('') }
      }}/>{query && <>{view === 'graph' && <span>{matches.length ? `${matchIndex + 1}/${matches.length}` : '0'}</span>}<button type="button" aria-label="Limpiar búsqueda de cursos" onClick={() => { setQuery(''); search.current?.focus() }}><Icon name="close"/></button></>}</label>
      {view === 'graph' && <div className="oc-zoom" role="group" aria-label="Tamaño del grafo"><button type="button" onClick={() => adjustZoom(zoom - 0.15)} disabled={zoom <= 0.6} aria-label="Alejar grafo">−</button><button type="button" onClick={() => adjustZoom(1)} aria-label="Restablecer tamaño del grafo">{Math.round(zoom * 100)}%</button><button type="button" onClick={() => adjustZoom(zoom + 0.15)} disabled={zoom >= 1.8} aria-label="Acercar grafo">+</button></div>}
    </div>
    <div className="oc-area-row"><span>Áreas</span><button type="button" className="oc-arrow" aria-label="Áreas anteriores" onClick={() => areas.current.scrollBy({ left: -240, behavior: 'auto' })}><Icon name="left"/></button><div className="oc-areas" ref={areas} role="group" aria-label="Áreas de Matemáticas a Electivos"><button type="button" aria-pressed={!area} onClick={() => setArea(null)}>Todas</button>{Object.entries(AREAS).filter(([key]) => M.cursos.some(c => c.a === key)).map(([key, a]) => <button key={key} type="button" aria-pressed={area === key} onClick={() => setArea(area === key ? null : key)}><i style={{ background: a.color }} aria-hidden="true"/>{a.label}</button>)}</div><button type="button" className="oc-arrow" aria-label="Áreas siguientes" onClick={() => areas.current.scrollBy({ left: 240, behavior: 'auto' })}><Icon name="right"/></button></div>
    <div className="oc-legend" aria-label="Estados de cursos"><span className="passed">Aprobado</span><span className="enrolled">En curso</span><span className="planned">Plan futuro</span><label><input type="checkbox" checked={onlyRelated && hasFilter} disabled={!hasFilter || busy} onChange={e => setOnlyRelated(e.target.checked)}/>Ocultar cursos fuera del filtro</label></div>
    <div className="oc-status" role="status" aria-live="polite">{busy ? 'Guardando…' : course && ['open', 'req'].includes(mode) ? <><strong>{course.n}</strong> {mode === 'open' ? 'abre' : 'requiere'} {chain.size} {mode === 'open' ? 'cursos en cadena' : 'cursos previos'}{mode === 'req' && course.rc ? ` · ${course.rc} créditos aprobados previos` : ''}.</> : mode === 'plan' ? <>{planned.length} cursos · {number(planCredits)} créditos en tu plan. {HINTS.plan}</> : HINTS[mode]}{mode === 'noreq' && ` ${available.length} cursos disponibles.`}</div>
    {error && <p className="oc-feedback error" role="alert">{error}</p>}{message && <p className="oc-feedback" role="status">{message}</p>}
    {mode === 'semester' && <section className="oc-details oc-semester" aria-label="Matrícula de este semestre">
      <h3>Cursos de este semestre</h3>
      <label className="oc-semester-number">Mi semestre actual<select aria-label="Mi semestre actual" value={semester} disabled={busy} onChange={e => setSemester(e.target.value)}><option value="">Seleccionar semestre</option>{cycleKeys.filter(n => n > 0).map(n => <option key={n} value={n}>Semestre {n}</option>)}</select></label><p>Este dato es independiente del ciclo de tus cursos: puedes tener pendientes o adelantar cursos.</p>
      <p>{semesterDraft.size} cursos · {number(M.cursos.filter(c => semesterDraft.has(c.id)).reduce((sum, c) => sum + c.cr, 0))} créditos. Selecciona tu matrícula real; esto no confirma una matrícula oficial.</p>
      <div className="oc-semester-list">{M.cursos.filter(c => !done.has(c.id) && (!query.trim() || matchSet.has(c.id))).map(c => <label key={c.id}><input type="checkbox" checked={semesterDraft.has(c.id)} disabled={busy || !isLive} onChange={() => selectCourse(c.id)}/><span>{c.n}<small>Ciclo {c.c} · {number(c.cr)} créditos</small></span></label>)}</div>
      {!isLive && <p>Inicia sesión para guardar los cursos de este semestre.</p>}
      <div className="oc-actions"><button type="button" className="oc-primary" disabled={busy || !isLive} onClick={saveSemester}>{busy ? 'Guardando…' : 'Guardar cursos del semestre'}</button><button type="button" disabled={busy} onClick={() => changeMode('open')}>Cerrar</button></div>
    </section>}
    {pending && <div className="oc-confirm" ref={confirm} tabIndex="-1" aria-label="Revisar cambios de cursos aprobados">
      <h3>{pending.added.length ? 'Confirmar cursos aprobados' : 'Confirmar cursos desmarcados'}</h3>
      <p>{pending.added.length ? 'Se registrará como aprobado únicamente este curso:' : 'Se quitará la aprobación únicamente de este curso. Los demás aprobados se conservan:'}</p>
      <ul>{[...pending.added, ...pending.removed].map(c => <li key={c.id}>{c.n}</li>)}</ul>
      <div className="oc-actions"><button type="button" className="oc-primary" disabled={busy} onClick={confirmDone}>{busy ? 'Guardando…' : 'Confirmar cambios'}</button><button type="button" disabled={busy} onClick={cancelPending}>Cancelar</button></div>
    </div>}
    {query.trim() && !matches.length && <p className="oc-feedback" role="status">No encontramos cursos con «{query}». Prueba otro nombre o limpia la búsqueda.</p>}
    {view === 'graph' && <>
    <div className="oc-scroller" ref={scroller} tabIndex="0" role="region" aria-label="Grafo de cursos por ciclo; desplaza para explorar" onPointerDown={e => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button')) return
      drag.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
    }} onPointerMove={e => {
      const d = drag.current; if (!d) return
      const dx = e.clientX - d.x, dy = e.clientY - d.y
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
      e.currentTarget.scrollLeft = d.left - dx; e.currentTarget.scrollTop = d.top - dy
    }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <div style={{ width: M.W * zoom, height: M.H * zoom }}><div className="oc-canvas" style={{ width: M.W, height: M.H, transform: `scale(${zoom})` }}>
        <svg className="oc-edges" width={M.W} height={M.H} viewBox={`0 0 ${M.W} ${M.H}`} aria-hidden="true">{M.edges.map(e => <path key={`${e.from}-${e.to}`} className={lineClass(e)} hidden={!graphVisible(M.byId[e.from]) || !graphVisible(M.byId[e.to])} d={edgePath(e, M.byId)} style={{ '--area-color': AREAS[M.byId[e.to].a]?.color || 'var(--ic)' }}/>)}</svg>
        {Object.entries(M.ciclos).map(([num, info]) => <div key={num} className="oc-column" style={{ left: LEFT + (num - M.minC) * COL_W }}>{info.t}<span>{info.s}</span></div>)}
        {M.cursos.map(c => <button type="button" data-course={c.id} key={c.id} className={nodeClass(c)} hidden={!graphVisible(c)} style={{ left: c.x, top: c.y }} title={`${c.n} · ${c.cr} créditos${c.rc ? ` · Requiere ${c.rc} créditos previos` : ''}`} aria-pressed={mode === 'done' ? done.has(c.id) : mode === 'plan' ? plan.has(c.id) : mode === 'semester' ? semesterDraft.has(c.id) : selected === c.id} disabled={busy || (mode === 'plan' && !canPlan(M, c, done, statuses))} onClick={() => selectCourse(c.id)}>
          {(done.has(c.id) || plan.has(c.id)) && <span className="oc-check"><Icon name="tick"/></span>}<span className="oc-name">{c.n}</span><span className="oc-credits">{number(c.cr)} créd{c.rc ? ` · ${c.rc} previos` : ''}{done.has(c.id) ? ' · Aprobado' : statuses[c.id]?.status === 'matriculado' ? ' · En curso' : cleanPlan.has(c.id) ? ' · Plan futuro' : ''}</span>
        </button>)}
      </div></div>
    </div>
    </>}
    {view === 'cycles' && <div className="oc-cycle-view">
      <label className="oc-cycle-picker">Ciclo<select value={cycle} onChange={e => setCycle(e.target.value)}><option value="all">Todos los ciclos</option>{cycleKeys.map(n => <option key={n} value={n}>{M.ciclos[n].t}</option>)}</select></label>
      <p className="oc-list-count" role="status">{displayedCourses.length} cursos · {area ? AREAS[area]?.label : 'Todas las áreas'}</p>
      {cycleKeys.filter(n => displayedCourses.some(c => c.c === n)).map(n => <section key={n} className="oc-cycle-section" aria-label={M.ciclos[n].t}>
        <h3>{M.ciclos[n].t}<small>{M.ciclos[n].s}</small></h3>
        <div className="oc-course-list">{displayedCourses.filter(c => c.c === n).map(c => <button key={c.id} type="button" data-course={c.id} className={nodeClass(c)} disabled={busy || (mode === 'plan' && !canPlan(M, c, done, statuses))} aria-pressed={mode === 'done' ? done.has(c.id) : mode === 'plan' ? plan.has(c.id) : mode === 'semester' ? semesterDraft.has(c.id) : selected === c.id} onClick={() => selectCourse(c.id)}>
          <span className="oc-name">{c.n}</span><span className="oc-credits">{number(c.cr)} créditos · {done.has(c.id) ? 'Aprobado' : statuses[c.id]?.status === 'matriculado' ? 'En curso' : cleanPlan.has(c.id) ? 'Plan futuro' : STATUS[statuses[c.id]?.status] || 'Pendiente'}</span>
          {(done.has(c.id) || plan.has(c.id)) && <span className="oc-check"><Icon name="tick"/></span>}
        </button>)}</div>
      </section>)}
      {!displayedCourses.length && <p className="oc-list-empty">No hay cursos con estos filtros. Cambia el ciclo, el área o la búsqueda.</p>}
    </div>}
    <div className="oc-bottom"><span>{view === 'graph' ? 'Desliza o arrastra para explorar todos los ciclos.' : 'Toca un curso para usar la acción seleccionada.'}</span><span>{area ? AREAS[area].label : 'Todas las áreas'}{view === 'graph' && ` · ${Math.round(zoom * 100)}%`}</span></div>
    {mode === 'plan' && <section className="oc-details" aria-label="Plan del próximo ciclo"><h3>Tu próximo ciclo</h3>{planned.length ? <><p>{planned.length} cursos · {number(planCredits)} créditos. Al aprobarlos, tendrías {opensAfter.length} cursos adicionales disponibles.</p><ul className="oc-plan-list">{planned.map(c => <li key={c.id}><span>{c.n}<small>{number(c.cr)} créditos · {M.ciclos[c.c].t}</small></span><button type="button" disabled={busy} aria-label={`Quitar ${c.n} del plan`} onClick={() => togglePlan(c.id)}><Icon name="close"/></button></li>)}</ul><button type="button" disabled={busy} onClick={() => saveProgress(done, new Set())}>Vaciar plan</button></> : <p>Tu plan está vacío. Selecciona cursos disponibles para agregarlos.</p>}</section>}
    {mode === 'ficha' && (course ? <section className="oc-details" ref={detail} tabIndex="-1" aria-label={`Ficha de ${course.n}`}>
      <div className="oc-detail-head"><h3>{course.n}</h3><button type="button" aria-label="Cerrar ficha del curso" onClick={() => { const id = selected; setSelected(null); focusCourse(id) }}><Icon name="close"/></button></div>
      <dl className="oc-facts"><div><dt>Ciclo</dt><dd>{M.ciclos[course.c].t}</dd></div><div><dt>Créditos</dt><dd>{number(course.cr)}</dd></div><div><dt>Área</dt><dd>{AREAS[course.a]?.label}</dd></div><div><dt>Estado</dt><dd>{STATUS[selectedStatus] || 'Pendiente'}</dd></div></dl>
      <h4>¿Qué requiere?</h4><p className="oc-course-links">{course.r.length ? list(course.r) : 'Sin prerrequisitos de cursos.'}</p>{course.rc > 0 && <p>Requiere {course.rc} créditos aprobados previos. Tu avance: {number(credits)} créditos.</p>}{course.requirementNote && <p>{course.requirementNote}</p>}
      <h4>¿Qué abre?</h4><p className="oc-course-links">{M.unlocks[course.id]?.length ? list(M.unlocks[course.id]) : 'No abre otros cursos directamente.'}</p>
      {statuses[course.id]?.times_taken && <p>Veces llevado: {statuses[course.id].times_taken}{statuses[course.id].passed_at ? ` · Fecha registrada: ${new Date(statuses[course.id].passed_at).toLocaleDateString('es-PE')}` : ''}</p>}
      {!done.has(course.id) && <form className="oc-grade" onSubmit={saveStatus}><label>Estado académico<select value={statusDraft} disabled={busy || !isLive} onChange={e => setStatusDraft(e.target.value)}><option value="">Pendiente</option><option value="matriculado">En curso</option><option value="desaprobado">Desaprobado</option>{['aprobado', 'convalidado'].includes(statusDraft) && <option value={statusDraft}>{STATUS[statusDraft]}</option>}</select></label><button type="submit" className="oc-primary" disabled={busy || !isLive}>Guardar estado</button><p>Los cursos matriculados aparecen en Inicio y Mod Focus.</p></form>}
      <div className="oc-actions"><button type="button" disabled={busy} onClick={() => requestDone(course.id)}>{done.has(course.id) ? 'Quitar aprobación' : 'Marcar como aprobado'}</button></div>
      {done.has(course.id) || statuses[course.id]?.status === 'desaprobado' ? <form className="oc-grade" onSubmit={saveGrade}><label>Nota / 20<input aria-label={`Nota de ${course.n}`} inputMode="decimal" value={gradeDraft} disabled={busy} placeholder="Sin nota" onChange={e => setGradeDraft(e.target.value)}/></label><button type="submit" className="oc-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar nota'}</button><p>Deja el campo vacío para eliminar la nota. La nota también aparece en Inicio.</p></form> : <p>Marca el curso como llevado para registrar su nota.</p>}
      <CourseCommunity key={course.id} course={course} client={client} user={isLive ? user : null} onBusy={value => { locked.current = value; setBusy(value); onBusy(value) }}/>
    </section> : <div className="oc-details"><h3>Ficha del curso</h3><p>Selecciona un curso para consultar sus requisitos, créditos y registro académico.</p></div>)}
    <p className="oc-foot">{M.foot}</p>
  </section>
}

export function mountOfficialCurriculum(container, props) {
  const root = createRoot(container)
  root.render(<OfficialCurriculum {...props}/>)
  return () => root.unmount()
}
