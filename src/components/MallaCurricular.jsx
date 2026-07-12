import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { CURSOS, CICLOS, TOTAL_CRED } from '../data/cursos'
import SidePanel from './SidePanel'
import ProfessorPanel from './ProfessorPanel'
import '../styles/MallaCurricular.css'

// ---------- Layout (idéntico al HTML original) ----------
const NODE_W = 200, NODE_H = 58, COL_GAP = 88, ROW_GAP = 18, TOP = 68, LEFT = 26
const COL_W = NODE_W + COL_GAP

const byId = {}
CURSOS.forEach(c => (byId[c.id] = c))

const unlocks = {}
const edges = []
CURSOS.forEach(c =>
  c.r.forEach(req => {
    ;(unlocks[req] = unlocks[req] || []).push(c.id)
    edges.push({ from: req, to: c.id })
  })
)

const rowsPerCol = {}
CURSOS.forEach(c => {
  c.row = rowsPerCol[c.c] = (rowsPerCol[c.c] ?? -1) + 1
  c.x = LEFT + c.c * COL_W
  c.y = TOP + c.row * (NODE_H + ROW_GAP)
})
const maxRows = Math.max(...Object.values(rowsPerCol)) + 1
const W = LEFT * 2 + 11 * COL_W - COL_GAP
const H = TOP + maxRows * (NODE_H + ROW_GAP) + 26

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

const edgePath = e => {
  const a = byId[e.from], b = byId[e.to]
  const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2
  const x2 = b.x, y2 = b.y + NODE_H / 2
  const dx = Math.max((x2 - x1) * 0.45, 36)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

// ---------- Componente ----------
export default function MallaCurricular({ user, onLogout }) {
  const [mode, setMode] = useState('open') // 'open' | 'req' | 'done'
  const [selected, setSelected] = useState(null)
  const [done, setDone] = useState(() => new Set())
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

  const creditosLlevados = (set) => {
    let cr = 0
    set.forEach(id => (cr += byId[id].cr))
    return cr
  }

  // ---------- Interacción ----------
  const select = id => {
    setLastAction(null)
    setSelected(prev => (prev === id ? null : id))
  }

  const toggleDone = id => {
    const next = new Set(done)
    let action
    if (next.has(id)) {
      // Desmarcar: cae el curso, su cadena de requisitos y todo lo que dependía de ellos
      next.delete(id)
      let quitados = 0
      bfs(id, x => byId[x].r).forEach(x => {
        if (next.has(x)) { next.delete(x); quitados++ }
      })
      let cambio = true
      while (cambio) {
        cambio = false
        next.forEach(x => {
          if (byId[x].r.some(req => !next.has(req))) {
            next.delete(x); quitados++; cambio = true
          }
        })
      }
      action = { verbo: 'desmarcado', name: byId[id].n, extra: quitados }
    } else {
      // Marcar: sus requisitos previos se marcan en automático
      next.add(id)
      let agregados = 0
      bfs(id, x => byId[x].r).forEach(x => {
        if (!next.has(x)) { next.add(x); agregados++ }
      })
      action = { verbo: 'marcado como llevado', name: byId[id].n, extra: agregados }
    }
    setDone(next)
    setLastAction(action)
    persist(next)
  }

  const changeMode = m => {
    setMode(m)
    setLastAction(null)
    if (m === 'done') setSelected(null)
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
  const chain = selected
    ? mode === 'open'
      ? bfs(selected, x => unlocks[x])
      : bfs(selected, x => byId[x].r)
    : null

  const nodeClass = c => {
    if (mode === 'done' || !selected) {
      return 'node' + (done.has(c.id) ? ' done' : '')
    }
    if (c.id === selected) return 'node sel'
    if (chain.has(c.id)) return 'node ' + (done.has(c.id) ? 'done' : mode === 'open' ? 'open' : 'req')
    return 'node dim' + (done.has(c.id) ? ' done' : '')
  }

  const edgeClass = e => {
    if (!selected || mode === 'done') return 'e'
    const isOpen = mode === 'open'
    const inChain = isOpen
      ? chain.has(e.to) && (e.from === selected || chain.has(e.from))
      : chain.has(e.from) && (e.to === selected || chain.has(e.to))
    return 'e ' + (inChain ? (isOpen ? 'hl-open' : 'hl-req') : 'dim')
  }

  // ---------- Barra de estado ----------
  const pill = done.size > 0 && (
    <span className="pill g">{done.size} llevados · {creditosLlevados(done)} / {TOTAL_CRED} créd</span>
  )

  let status
  if (lastAction) {
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
  } else if (selected) {
    const c = byId[selected]
    const n = chain.size
    const pend = [...chain].filter(x => !done.has(x)).length
    if (n === 0) {
      status = (
        <><strong>{c.n}</strong>&nbsp;{mode === 'open' ? 'no abre ningún curso en la malla.' : 'no tiene cursos previos como requisito.'}</>
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
        </>
      )
    }
  } else {
    status = <>Explora la malla: <strong>Cálculo I</strong> y <strong>Álgebra Lineal</strong> son buenos puntos de partida. {pill}</>
  }

  if (!loaded) {
    return <div className="malla-loading mono">CARGANDO TU PROGRESO…</div>
  }

  return (
    <div className={'malla-page' + (mode === 'done' ? ' marking' : '')}>
      <header className="malla-top">
        <div>
          <div className="eyebrow mono">Universidad ESAN · Ingeniería en Inteligencia Artificial</div>
          <h1>Malla curricular interactiva</h1>
          <div className="meta">
            Plan de estudios <b>presencial</b><span className="sep">·</span>
            Total <b>200 créditos</b><span className="sep">·</span>
            <b>10</b> ciclos + pre-formación
          </div>
          <div className="hint">
            {isGuest
              ? 'Modo visitante: puedes explorar y marcar cursos, pero nada se guarda al salir. Crea una cuenta para conservar tu avance.'
              : 'Toca un curso para ver su cadena de dependencias. En el modo «Marcar llevados», toca los cursos que ya aprobaste — se guardan en tu cuenta.'}
          </div>
        </div>
        <div className="user-box">
          <span className="mono user-code">{studentCode}</span>
          {syncError && <span className="sync-warn">⚠ sin guardar</span>}
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
        </div>
        <div className="legend">
          {mode !== 'done' && (
            <span><span className="sw" style={{ background: 'var(--navy)' }} />Seleccionado</span>
          )}
          {mode === 'open' && (
            <span><span className="sw" style={{ background: 'var(--green-soft)', border: '1.5px solid var(--green)' }} />Cursos que abre</span>
          )}
          {mode === 'req' && (
            <span><span className="sw" style={{ background: 'var(--amber-soft)', border: '1.5px solid var(--amber)' }} />Requisitos previos</span>
          )}
          <span><span className="sw" style={{ background: '#EDEFEC', border: '1.5px solid #C7CDC7' }} />Llevado</span>
        </div>
      </div>

      <div className="status">{status}</div>

      {!isGuest && selected && (
        <ProfessorPanel user={user} course={byId[selected]} />
      )}

      <div className="frame">
        <div className="scroller" ref={scrollerRef} onClick={onScrollerClick} onMouseDown={onMouseDown}>
          <div className="canvas" style={{ width: W, height: H }}>
            <svg className="edges" width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg">
              {edges.map((e, i) => (
                <path key={i} d={edgePath(e)} className={edgeClass(e)} />
              ))}
            </svg>
            {Object.entries(CICLOS).map(([num, info]) => (
              <div key={num} className="col-h mono" style={{ left: LEFT + num * COL_W }}>
                {info.t}<em>{info.s}</em>
              </div>
            ))}
            {CURSOS.map(c => (
              <div
                key={c.id}
                className={nodeClass(c)}
                style={{ left: c.x, top: c.y }}
                onClick={ev => onNodeClick(ev, c.id)}
              >
                <span className="chk">✓</span>
                <div className="nm">{c.n}</div>
                <div className="cr mono">
                  {c.id === 'tesis1' ? `${c.cr} créd · 140 créd. previos` : `${c.cr} créd`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="malla-foot mono">
        TESIS I REQUIERE 140 CRÉDITOS APROBADOS · ELECTIVOS SEGÚN ESPECIALIDAD · CURSOS DE PRE-FORMACIÓN CONVALIDABLES POR EXAMEN
      </footer>

      {!isGuest && (
        <SidePanel user={user} open={panelOpen} onClose={() => setPanelOpen(false)} done={done} />
      )}
    </div>
  )
}
