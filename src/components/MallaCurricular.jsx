import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { CARRERAS } from '../data/carreras'
import { AREAS } from '../data/areas'
import SidePanel from './SidePanel'
import ProfessorPanel from './ProfessorPanel'
import CourseDetail, { STATUS_META } from './CourseDetail'
import '../styles/MallaCurricular.css'

// ---------- Layout (idéntico al HTML original) ----------
const NODE_W = 200, NODE_H = 58, COL_GAP = 88, ROW_GAP = 18, TOP = 68, LEFT = 26
const COL_W = NODE_W + COL_GAP

// Calcula el grafo y las posiciones de una malla; se hace una sola vez por carrera
function buildMalla(carrera) {
  const cursos = carrera.cursos.map(c => ({ ...c }))
  const byId = {}
  cursos.forEach(c => (byId[c.id] = c))

  const unlocks = {}
  const edges = []
  cursos.forEach(c =>
    c.r.forEach(req => {
      ;(unlocks[req] = unlocks[req] || []).push(c.id)
      edges.push({ from: req, to: c.id })
    })
  )

  // minC: primer ciclo de la malla (0 en ESAN por la pre-formación, 1 en PUCP);
  // las columnas se normalizan para no dejar una franja vacía a la izquierda
  const minC = Math.min(...cursos.map(c => c.c))

  // Orden dentro de cada ciclo: heurística de baricentro (Sugiyama) para que
  // las líneas se crucen lo menos posible. Cada curso se acomoda cerca del
  // promedio vertical de sus requisitos (pasada →) y de los cursos que abre
  // (pasada ←); los cursos sin conexiones caen al fondo de su columna.
  const cols = {}
  cursos.forEach(c => (cols[c.c] = cols[c.c] || []).push(c))
  const colKeys = Object.keys(cols).map(Number).sort((a, b) => a - b)
  const pos = {}
  colKeys.forEach(k => cols[k].forEach((c, i) => (pos[c.id] = i)))
  const suelto = c => c.r.length === 0 && !(unlocks[c.id]?.length)

  const ordenarCol = (k, vecinos) => {
    const keyed = cols[k].map((c, i) => {
      const ps = vecinos(c).map(id => pos[id]).filter(p => p !== undefined)
      const key = ps.length
        ? ps.reduce((a, b) => a + b, 0) / ps.length
        : suelto(c) ? 999 + i : pos[c.id]
      return { c, key, i }
    })
    keyed.sort((a, b) => a.key - b.key || a.i - b.i)
    keyed.forEach((x, i) => (pos[x.c.id] = i))
    cols[k] = keyed.map(x => x.c)
  }

  for (let pasada = 0; pasada < 4; pasada++) {
    colKeys.forEach(k => ordenarCol(k, c => c.r))
    ;[...colKeys].reverse().forEach(k => ordenarCol(k, c => unlocks[c.id] || []))
  }

  let maxRows = 0
  colKeys.forEach(k => {
    maxRows = Math.max(maxRows, cols[k].length)
    cols[k].forEach((c, i) => {
      c.row = i
      c.x = LEFT + (c.c - minC) * COL_W
      c.y = TOP + i * (NODE_H + ROW_GAP)
    })
  })
  const numCols = Math.max(...cursos.map(c => c.c)) - minC + 1
  const W = LEFT * 2 + numCols * COL_W - COL_GAP
  const H = TOP + maxRows * (NODE_H + ROW_GAP) + 26

  return { ...carrera, cursos, byId, unlocks, edges, W, H, minC }
}

const MALLAS = {}
Object.values(CARRERAS).forEach(ca => (MALLAS[ca.key] = buildMalla(ca)))

function bfs(startId, adj) {
  const seen = new Set()
  const q = [...(adj(startId) || [])]
  while (q.length) {
    const x = q.shift()
    if (seen.has(x)) continue
    seen.add(x)
    ;(adj(x) || []).forEach(y => q.push(y))
  }
  return seen
}

const edgePath = (e, byId) => {
  const a = byId[e.from], b = byId[e.to]
  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2
  const x2 = b.x, y2 = b.y + NODE_H / 2
  const dx = Math.max((x2 - x1) * 0.45, 36)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

// ---------- Componente ----------
export default function MallaCurricular({ user, carrera, onSwitchCarrera, onLogout }) {
  // Malla activa según la carrera del alumno (o la elegida por el visitante)
  const M = MALLAS[carrera] || MALLAS.ia
  const { byId, unlocks, edges } = M

  const [mode, setMode] = useState('open') // 'open' | 'req' | 'done' | 'ficha'
  const [selected, setSelected] = useState(null)
  const [done, setDone] = useState(() => new Set())
  const [statuses, setStatuses] = useState({}) // { course_id: fila de course_status }
  const [loaded, setLoaded] = useState(false)
  const [lastAction, setLastAction] = useState(null) // mensaje tras marcar/desmarcar
  const [syncError, setSyncError] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false) // panel lateral (solo con sesión)

  const scrollerRef = useRef(null)
  const dragRef = useRef(null)

  // Sin usuario = modo visitante: el avance solo se guarda en este dispositivo
  const isGuest = !user
  const studentCode = isGuest
    ? 'VISITANTE'
    : user.user_metadata?.student_code || user.email

  // Cargar progreso desde Supabase (el visitante siempre parte de cero)
  useEffect(() => {
    if (isGuest) {
      localStorage.removeItem('malla-visitante') // limpia restos de versiones previas
      setLoaded(true)
      return
    }
    let cancelled = false
    supabase
      .from('progress')
      .select('done')
      .eq('student_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('[progress:load]', error)
        if (data?.done) setDone(new Set(data.done))
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [isGuest, user?.id])

  // Cargar los estados académicos (dan color a los cursos en la ficha)
  useEffect(() => {
    if (isGuest) return
    let cancelled = false
    supabase
      .from('course_status')
      .select('course_id, status, times_taken, passed_at, personal_note')
      .eq('student_id', user.id)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { console.error('[status:load]', error); return }
        const map = {}
        ;(data || []).forEach(r => (map[r.course_id] = r))
        setStatuses(map)
      })
    return () => { cancelled = true }
  }, [isGuest, user?.id])

  // Guardar progreso (el visitante no persiste nada: solo dura la sesión abierta)
  const persist = useCallback(async (set) => {
    if (isGuest) return
    const { error } = await supabase
      .from('progress')
      .upsert({ student_id: user.id, done: [...set], updated_at: new Date().toISOString() })
    if (error) {
      console.error('[progress:save]', error)
      setSyncError(true)
    } else {
      setSyncError(false)
    }
  }, [isGuest, user?.id])

  const handleLogout = async () => {
    if (!isGuest) await supabase.auth.signOut()
    onLogout()
  }

  // Ids ajenos a esta malla (p. ej. de la otra carrera) no suman ni rompen nada
  const creditosLlevados = (set) => {
    let cr = 0
    set.forEach(id => (cr += byId[id]?.cr || 0))
    return cr
  }

  // Primer curso del set cuyo requisito de créditos aprobados (rc) no se cumple
  const rcUnmet = (set) => {
    const total = creditosLlevados(set)
    for (const id of set) {
      const c = byId[id]
      if (c?.rc && total - c.cr < c.rc) return c
    }
    return null
  }

  // ---------- Interacción ----------
  const select = id => {
    setLastAction(null)
    setSelected(prev => (prev === id ? null : id))
  }

  // Desmarcar en cascada: cae el curso, su cadena de requisitos y todo lo que dependía de ellos
  const cascadeRemove = (id, base) => {
    const next = new Set(base)
    next.delete(id)
    let quitados = 0
    bfs(id, x => byId[x]?.r).forEach(x => {
      if (next.has(x)) { next.delete(x); quitados++ }
    })
    let cambio = true
    while (cambio) {
      cambio = false
      const total = creditosLlevados(next)
      next.forEach(x => {
        const c = byId[x]
        if (!c) return
        if (c.r.some(req => !next.has(req)) || (c.rc && total - c.cr < c.rc)) {
          next.delete(x); quitados++; cambio = true
        }
      })
    }
    return { next, quitados }
  }

  // Marcar con requisitos previos en automático; falta = curso cuyo rc no se cumple
  const cascadeAdd = (id, base) => {
    const next = new Set(base)
    next.add(id)
    let agregados = 0
    bfs(id, x => byId[x]?.r).forEach(x => {
      if (!next.has(x)) { next.add(x); agregados++ }
    })
    return { next, agregados, falta: rcUnmet(next) }
  }

  // Mantiene course_status coherente con los llevados: los cursos que caen
  // pierden su estado aprobado/convalidado, y los que entran dejan de estar
  // matriculados/desaprobados (pasan a aprobado).
  const reconcileStatuses = async (prevSet, nextSet) => {
    if (isGuest) return
    const dropped = [...prevSet].filter(x => !nextSet.has(x)
      && (statuses[x]?.status === 'aprobado' || statuses[x]?.status === 'convalidado'))
    const upgraded = [...nextSet].filter(x => !prevSet.has(x)
      && (statuses[x]?.status === 'matriculado' || statuses[x]?.status === 'desaprobado'))
    if (dropped.length) {
      setStatuses(s => { const n = { ...s }; dropped.forEach(x => delete n[x]); return n })
      const { error } = await supabase
        .from('course_status').delete()
        .eq('student_id', user.id).in('course_id', dropped)
      if (error) console.error('[status:clean]', error)
    }
    if (upgraded.length) {
      setStatuses(s => {
        const n = { ...s }
        upgraded.forEach(x => (n[x] = { ...n[x], status: 'aprobado' }))
        return n
      })
      const { error } = await supabase
        .from('course_status').update({ status: 'aprobado' })
        .eq('student_id', user.id).in('course_id', upgraded)
      if (error) console.error('[status:clean]', error)
    }
  }

  const toggleDone = id => {
    let next, action
    if (done.has(id)) {
      const r = cascadeRemove(id, done)
      next = r.next
      action = { verbo: 'desmarcado', name: byId[id].n, extra: r.quitados }
    } else {
      const r = cascadeAdd(id, done)
      // Cursos con requisito de créditos: no se pueden marcar sin el avance suficiente
      if (r.falta) {
        setLastAction({ blocked: true, name: r.falta.n, rc: r.falta.rc, cred: creditosLlevados(done) })
        return
      }
      next = r.next
      action = { verbo: 'marcado como llevado', name: byId[id].n, extra: r.agregados }
    }
    reconcileStatuses(done, next)
    setDone(next)
    setLastAction(action)
    persist(next)
  }

  // Guardar el estado académico desde la ficha (row = null → pendiente).
  // Aprobado/convalidado marcan el curso como llevado; los demás lo quitan.
  const saveStatus = async (courseId, row) => {
    let next = done
    if (row === null || row.status === 'matriculado' || row.status === 'desaprobado') {
      if (done.has(courseId)) next = cascadeRemove(courseId, done).next
    } else if (!done.has(courseId)) {
      const r = cascadeAdd(courseId, done)
      if (r.falta) {
        return {
          error: `${r.falta.n} requiere ${r.falta.rc} créditos aprobados y llevas ` +
            `${creditosLlevados(done)}. Marca más cursos llevados primero.`
        }
      }
      next = r.next
    }
    if (next !== done) {
      await reconcileStatuses(done, next)
      setDone(next)
      persist(next)
    }
    if (row === null) {
      const { error } = await supabase
        .from('course_status').delete()
        .match({ student_id: user.id, course_id: courseId })
      if (error) { console.error('[status:delete]', error); return { error: 'No se pudo guardar el estado.' } }
      setStatuses(s => { const n = { ...s }; delete n[courseId]; return n })
    } else {
      const { error } = await supabase
        .from('course_status')
        .upsert({ student_id: user.id, course_id: courseId, ...row, updated_at: new Date().toISOString() })
      if (error) { console.error('[status:save]', error); return { error: 'No se pudo guardar el estado.' } }
      setStatuses(s => ({ ...s, [courseId]: row }))
    }
    return { ok: true }
  }

  const changeMode = m => {
    setMode(m)
    setLastAction(null)
    if (m === 'done' || m === 'ficha') setSelected(null)
  }

  const onNodeClick = (ev, id) => {
    ev.stopPropagation()
    if (mode === 'done') toggleDone(id)
    else select(id)
  }

  const onScrollerClick = () => {
    if (dragRef.current?.suppressClick) { dragRef.current.suppressClick = false; return }
    if (mode === 'done') return
    setSelected(null)
    setLastAction(null)
  }

  // Arrastrar para desplazar el lienzo
  const onMouseDown = ev => {
    if (ev.target.closest('.node') || ev.target.closest('button')) return
    const s = scrollerRef.current
    dragRef.current = { x: ev.clientX, y: ev.clientY, sl: s.scrollLeft, st: s.scrollTop, moved: false }
    s.classList.add('drag')
  }
  useEffect(() => {
    const move = ev => {
      const d = dragRef.current
      if (!d || d.x === undefined) return
      const dx = ev.clientX - d.x, dy = ev.clientY - d.y
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
      const s = scrollerRef.current
      if (s) { s.scrollLeft = d.sl - dx; s.scrollTop = d.st - dy }
    }
    const up = () => {
      const d = dragRef.current
      if (d?.moved) dragRef.current = { suppressClick: true }
      else dragRef.current = null
      scrollerRef.current?.classList.remove('drag')
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  // ---------- Clases visuales ----------
  const chain = selected && (mode === 'open' || mode === 'req')
    ? mode === 'open'
      ? bfs(selected, x => unlocks[x])
      : bfs(selected, x => byId[x]?.r)
    : null

  // Estado efectivo en la ficha: fila guardada o aprobado implícito si está llevado
  const fichaStatus = c => statuses[c.id]?.status ?? (done.has(c.id) ? 'aprobado' : null)

  const nodeClass = c => {
    if (mode === 'ficha') {
      const st = fichaStatus(c)
      return 'node ficha' + (st ? ' st-' + st : '') + (c.id === selected ? ' ring' : '')
    }
    if (mode === 'done' || !selected) {
      return 'node' + (done.has(c.id) ? ' done' : '')
    }
    if (c.id === selected) return 'node sel'
    if (chain.has(c.id)) return 'node ' + (done.has(c.id) ? 'done' : mode === 'open' ? 'open' : 'req')
    return 'node dim' + (done.has(c.id) ? ' done' : '')
  }

  const edgeClass = e => {
    if (!selected || mode === 'done' || mode === 'ficha') return 'e'
    const isOpen = mode === 'open'
    const inChain = isOpen
      ? chain.has(e.to) && (e.from === selected || chain.has(e.from))
      : chain.has(e.from) && (e.to === selected || chain.has(e.to))
    return 'e ' + (inChain ? (isOpen ? 'hl-open' : 'hl-req') : 'dim')
  }

  // ---------- Barra de estado ----------
  const pill = done.size > 0 && (
    <span className="pill g">{done.size} llevados · {creditosLlevados(done)} / {M.total} créd</span>
  )

  let status
  if (lastAction?.blocked) {
    status = (
      <>
        <strong>{lastAction.name}</strong> requiere <b>{lastAction.rc} créditos aprobados</b> y
        llevas {lastAction.cred}. Marca más cursos llevados primero. {pill}
      </>
    )
  } else if (lastAction) {
    status = (
      <>
        <strong>{lastAction.name}</strong>&nbsp;{lastAction.verbo}
        {lastAction.extra > 0 && (
          lastAction.verbo === 'desmarcado'
            ? <> (junto con {lastAction.extra} {lastAction.extra === 1 ? 'curso de su cadena' : 'cursos de su cadena'})</>
            : <> (+{lastAction.extra} {lastAction.extra === 1 ? 'requisito previo' : 'requisitos previos'} en automático)</>
        )}. {pill}
      </>
    )
  } else if (mode === 'done') {
    status = <>Toca los cursos que ya llevaste para marcarlos o desmarcarlos. {pill}</>
  } else if (mode === 'ficha') {
    status = <>Toca un curso para abrir su ficha: estado, nota, veces llevado, fecha de aprobación y reseñas anónimas. {pill}</>
  } else if (selected) {
    const c = byId[selected]
    const n = chain.size
    const pend = [...chain].filter(x => !done.has(x)).length
    const rcNote = mode === 'req' && c.rc && (
      <>&nbsp;Además necesita <b>{c.rc} créditos aprobados</b>.</>
    )
    if (n === 0) {
      status = (
        <><strong>{c.n}</strong>&nbsp;{mode === 'open' ? 'no abre ningún curso en la malla.' : 'no tiene cursos previos como requisito.'}{rcNote}</>
      )
    } else if (mode === 'open') {
      status = (
        <>
          <strong>{c.n}</strong> abre en cadena&nbsp;
          <span className="pill g">{n} {n === 1 ? 'curso' : 'cursos'}</span>
          {pend < n && <>&nbsp;· {pend} {pend === 1 ? 'pendiente' : 'pendientes'}, {n - pend} ya {n - pend === 1 ? 'llevado' : 'llevados'}</>}
        </>
      )
    } else {
      status = (
        <>
          <strong>{c.n}</strong> requiere en cadena&nbsp;
          <span className="pill a">{n} {n === 1 ? 'curso previo' : 'cursos previos'}</span>
          {pend < n && <>&nbsp;· solo {pend} {pend === 1 ? 'pendiente' : 'pendientes'}, {n - pend} ya {n - pend === 1 ? 'llevado' : 'llevados'}</>}
          {rcNote}
        </>
      )
    }
  } else {
    status = <>Explora la malla: <strong>{M.hint[0]}</strong> y <strong>{M.hint[1]}</strong> son buenos puntos de partida. {pill}</>
  }

  if (!loaded) {
    return <div className="malla-loading mono">CARGANDO TU PROGRESO…</div>
  }

  return (
    <div className={'malla-page' + (mode === 'done' ? ' marking' : '')}>
      <header className="malla-top">
        <div>
          <div className="eyebrow mono">{M.uni} · {M.nombre}</div>
          <h1>Malla curricular interactiva</h1>
          <div className="meta">
            Plan de estudios <b>presencial</b><span className="sep">·</span>
            Total <b>{M.total} créditos</b><span className="sep">·</span>
            {M.ciclosLabel}
          </div>
          <div className="hint">
            {isGuest
              ? 'Modo visitante: puedes explorar y marcar cursos, pero nada se guarda al salir. Crea una cuenta para conservar tu avance.'
              : 'Si evidencias errores en la malla curricular, tan solo manda un correro a <<solopcional16@gmail.com>> con el asunto "Error en la malla" y describe el problema. Gracias por tu ayuda.'}
          </div>
        </div>
        <div className="user-box">
          <span className="mono user-code">{studentCode}</span>
          {syncError && <span className="sync-warn">⚠ sin guardar</span>}
          {isGuest && onSwitchCarrera && (
            <button className="panel-btn" onClick={onSwitchCarrera}>
              ⇄ Cambiar de carrera
            </button>
          )}
          {!isGuest && (
            <button className="panel-btn" onClick={() => setPanelOpen(true)}>
              ☰ Mi panel
            </button>
          )}
          <button className="logout-btn" onClick={handleLogout}>
            {isGuest ? 'Crear cuenta / Entrar' : 'Cerrar sesión'}
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="modes">
          <button className={mode === 'open' ? 'on' : ''} onClick={ev => { ev.stopPropagation(); changeMode('open') }}>Qué abre</button>
          <button className={mode === 'req' ? 'on' : ''} onClick={ev => { ev.stopPropagation(); changeMode('req') }}>Qué requiere</button>
          <button className={mode === 'done' ? 'on' : ''} onClick={ev => { ev.stopPropagation(); changeMode('done') }}>Marcar llevados</button>
          {!isGuest && (
            <button className={mode === 'ficha' ? 'on' : ''} onClick={ev => { ev.stopPropagation(); changeMode('ficha') }}>Ficha del curso</button>
          )}
        </div>
        <div className="legend">
          {mode === 'ficha' ? (
            <>
              {Object.entries(STATUS_META).map(([k, m]) => (
                <span key={k}><span className="sw" style={{ background: m.soft, border: `1.5px solid ${m.color}` }} />{m.label}</span>
              ))}
              <span><span className="sw" style={{ background: '#fff', border: '1.5px solid #C7CDC7' }} />Pendiente</span>
            </>
          ) : (
            <>
              {mode !== 'done' && (
                <span><span className="sw" style={{ background: '#022F42' }} />Seleccionado</span>
              )}
              {mode === 'open' && (
                <span><span className="sw" style={{ background: 'var(--green-soft)', border: '1.5px solid var(--green)' }} />Cursos que abre</span>
              )}
              {mode === 'req' && (
                <span><span className="sw" style={{ background: 'var(--amber-soft)', border: '1.5px solid var(--amber)' }} />Requisitos previos</span>
              )}
              <span><span className="sw" style={{ background: '#EDEFEC', border: '1.5px solid #C7CDC7' }} />Llevado</span>
            </>
          )}
        </div>
      </div>

      <div className="area-legend">
        <span className="area-title mono">LÍNEAS ·</span>
        {Object.keys(AREAS).filter(k => M.cursos.some(c => c.a === k)).map(k => (
          <span key={k}><span className="sw" style={{ background: AREAS[k].color }} />{AREAS[k].label}</span>
        ))}
      </div>

      <div className="status">{status}</div>

      {M.electivos && (
        <details className="elec-panel">
          <summary className="mono">
            📚 CATÁLOGO DE ELECTIVOS · {M.electivos.length} GRUPOS
          </summary>
          <div className="elec-groups">
            {M.electivos.map(g => (
              <details key={g.grupo} className="elec-group">
                <summary>
                  {g.grupo} <span className="mono elec-count">{g.cursos.length} opciones</span>
                </summary>
                {g.nota && <p className="elec-nota">{g.nota}</p>}
                <div className="elec-list">
                  {g.cursos.map(cu => (
                    <div key={cu.k} className="elec-row">
                      <span className="elec-clave mono">{cu.k}</span>
                      <span className="elec-nombre">{cu.n}</span>
                      {cu.req && <span className="elec-req">req: {cu.req}</span>}
                      <span className="elec-cr mono">{cu.cr} créd</span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </details>
      )}

      {!isGuest && selected && mode !== 'ficha' && (
        <ProfessorPanel user={user} course={byId[selected]} />
      )}

      <div className="frame">
        <div className="scroller" ref={scrollerRef} onClick={onScrollerClick} onMouseDown={onMouseDown}>
          <div className="canvas" style={{ width: M.W, height: M.H }}>
            <svg className="edges" width={M.W} height={M.H} viewBox={`0 0 ${M.W} ${M.H}`} xmlns="http://www.w3.org/2000/svg">
              {edges.map((e, i) => {
                const cls = edgeClass(e)
                // Color por área del curso al que llega la línea; el resaltado
                // verde/ámbar de la cadena seleccionada tiene prioridad
                const style = cls.includes('hl') ? undefined : { stroke: AREAS[byId[e.to].a]?.color }
                return <path key={i} d={edgePath(e, byId)} className={cls} style={style} />
              })}
            </svg>
            {Object.entries(M.ciclos).map(([num, info]) => (
              <div key={num} className="col-h mono" style={{ left: LEFT + (num - M.minC) * COL_W }}>
                {info.t}<em>{info.s}</em>
              </div>
            ))}
            {M.cursos.map(c => (
              <div
                key={c.id}
                className={nodeClass(c)}
                style={{ left: c.x, top: c.y }}
                onClick={ev => onNodeClick(ev, c.id)}
              >
                <span className="chk">✓</span>
                <div className="nm">{c.n}</div>
                <div className="cr mono">
                  {c.rc ? `${c.cr} créd · ${c.rc} créd. previos` : `${c.cr} créd`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="malla-foot mono">
        {M.foot}
      </footer>

      {!isGuest && (
        <SidePanel user={user} open={panelOpen} onClose={() => setPanelOpen(false)} done={done} cursos={M.cursos} ciclos={M.ciclos} statuses={statuses} />
      )}

      {!isGuest && (
        <CourseDetail
          user={user}
          course={mode === 'ficha' && selected ? byId[selected] : null}
          ciclos={M.ciclos}
          byId={byId}
          statusRow={selected ? statuses[selected] : undefined}
          isDone={selected ? done.has(selected) : false}
          onSaveStatus={saveStatus}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
