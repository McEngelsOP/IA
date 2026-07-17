import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react'
import { supabase } from '../lib/supabaseClient'
import { CARRERAS } from '../data/carreras'
import { AREAS } from '../data/areas'
import SidePanel from './SidePanel'
import CourseDetail, { STATUS_META } from './CourseDetail'
import { LOGROS } from '../lib/logros'
import useMediaQuery from '../lib/useMediaQuery'
import '../styles/MallaCurricular.css'

// El arcade se descarga solo cuando alguien pulsa el botón (code-splitting):
// así el juego no engorda la carga inicial de la malla.
const Arcade = lazy(() => import('./Arcade'))
const AcademicCalendar = lazy(() => import('./AcademicCalendar'))

// Para el buscador: sin tildes ni mayúsculas ("Calculo" encuentra "Cálculo")
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

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

  const [mode, setMode] = useState('open') // 'open' | 'req' | 'noreq' | 'done' | 'ficha'
  const [selected, setSelected] = useState(null)
  const [done, setDone] = useState(() => new Set())
  const [statuses, setStatuses] = useState({}) // { course_id: fila de course_status }
  const [loaded, setLoaded] = useState(false)
  const [lastAction, setLastAction] = useState(null) // mensaje tras marcar/desmarcar
  const [syncError, setSyncError] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false) // panel lateral (solo con sesión)
  const [arcadeOpen, setArcadeOpen] = useState(false) // pantalla interna de juegos
  const [logroToast, setLogroToast] = useState(null) // logros recién desbloqueados
  const [busca, setBusca] = useState('') // buscador de cursos
  const [matchIdx, setMatchIdx] = useState(0) // Enter salta al siguiente resultado
  const [courseStats, setCourseStats] = useState(null) // agregados por curso (query 28) · null = sin pedir
  const [planModalOpen, setPlanModalOpen] = useState(false) // modal de detalles del plan
  const [calendarOpen, setCalendarOpen] = useState(false) // vista de calendario academico

  // Pantalla chica = interfaz móvil: sin arcade (no está optimizado para
  // táctil) y con zoom de pellizco sobre la malla. Reacciona al girar.
  const isMobile = useMediaQuery('(max-width: 760px)')

  // Zoom del lienzo: en móvil arranca un poco más grande para que los
  // cursos se lean; en desktop siempre es 1 (idéntico a antes).
  const [zoom, setZoom] = useState(() => {
    try { return window.matchMedia('(max-width: 760px)').matches ? 1.15 : 1 } catch { return 1 }
  })
  const zoomRef = useRef(zoom)

  // Hint «desliza» solo en pantallas chicas y solo la primera visita
  const [swipeHint, setSwipeHint] = useState(() => {
    try {
      return !localStorage.getItem('malla-swipe-hint') && window.matchMedia('(max-width: 760px)').matches
    } catch { return false }
  })
  useEffect(() => {
    if (!swipeHint) return
    const t = setTimeout(() => {
      setSwipeHint(false)
      try { localStorage.setItem('malla-swipe-hint', '1') } catch { /* sin almacenamiento */ }
    }, 5000)
    return () => clearTimeout(t)
  }, [swipeHint])

  // Plan del próximo ciclo: se guarda solo en este dispositivo (localStorage)
  const planKey = `malla-plan-${carrera}-${user?.id || 'guest'}`
  const [plan, setPlan] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(planKey) || '[]')) } catch { return new Set() }
  })
  useEffect(() => {
    try { setPlan(new Set(JSON.parse(localStorage.getItem(planKey) || '[]'))) } catch { setPlan(new Set()) }
  }, [planKey])
  useEffect(() => {
    try { localStorage.setItem(planKey, JSON.stringify([...plan])) } catch { /* almacenamiento lleno o bloqueado */ }
  }, [plan, planKey])

  // Reclamar logros: el servidor valida las condiciones y devuelve SOLO
  // los nuevos. Corre al entrar y al abrir/cerrar el arcade (los puntajes
  // pueden desbloquear logros); reclamar dos veces es inofensivo.
  useEffect(() => {
    if (!user) return
    let t
    supabase.rpc('reclamar_logros').then(({ data, error }) => {
      if (error) { console.error('[logros:reclamar]', error); return }
      if (data && data.length) {
        setLogroToast(data)
        t = setTimeout(() => setLogroToast(null), 8000)
      }
    })
    return () => clearTimeout(t)
  }, [user, arcadeOpen])

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
    if (m === 'done' || m === 'ficha' || m === 'noreq' || m === 'plan') setSelected(null)
  }

  const onNodeClick = (ev, id) => {
    ev.stopPropagation()
    if (mode === 'done') toggleDone(id)
    else if (mode === 'plan') togglePlan(id)
    else if (mode === 'noreq') return // vista de solo lectura: resalta lo disponible
    else select(id)
  }

  const onScrollerClick = () => {
    if (dragRef.current?.suppressClick) { dragRef.current.suppressClick = false; return }
    if (mode === 'done') return
    setSelected(null)
    setLastAction(null)
  }

  // Cambiar el zoom manteniendo fijo el punto (cx, cy) de la pantalla
  // (el centro del pellizco, o el centro visible con los botones ±)
  const applyZoom = (nz, cx, cy) => {
    const s = scrollerRef.current
    const oz = zoomRef.current
    nz = Math.min(1.8, Math.max(0.6, nz))
    if (!s || nz === oz) return
    const rect = s.getBoundingClientRect()
    const px = (cx ?? rect.left + rect.width / 2) - rect.left
    const py = (cy ?? rect.top + rect.height / 2) - rect.top
    const sl = (s.scrollLeft + px) * (nz / oz) - px
    const st = (s.scrollTop + py) * (nz / oz) - py
    zoomRef.current = nz
    setZoom(nz)
    requestAnimationFrame(() => { s.scrollLeft = sl; s.scrollTop = st })
  }

  // Pellizco con dos dedos (solo móvil; un dedo sigue desplazando normal)
  useEffect(() => {
    const s = scrollerRef.current
    if (!s || !isMobile) return
    let d0 = 0, z0 = 1
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onStart = e => {
      if (e.touches.length === 2) { d0 = dist(e.touches); z0 = zoomRef.current }
    }
    const onMove = e => {
      if (e.touches.length === 2 && d0 > 0) {
        e.preventDefault() // que el pellizco no haga zoom a toda la página
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
        applyZoom(z0 * dist(e.touches) / d0, cx, cy)
      }
    }
    const onEnd = () => { d0 = 0 }
    s.addEventListener('touchstart', onStart, { passive: true })
    s.addEventListener('touchmove', onMove, { passive: false })
    s.addEventListener('touchend', onEnd)
    return () => {
      s.removeEventListener('touchstart', onStart)
      s.removeEventListener('touchmove', onMove)
      s.removeEventListener('touchend', onEnd)
    }
  }, [isMobile]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Curso disponible: aún no llevado y con todos sus requisitos cumplidos
  // (cursos previos marcados y, si pide rc, créditos aprobados suficientes).
  // Sin nada marcado equivale a «cursos sin requisitos».
  const disponible = c => !done.has(c.id)
    && c.r.every(req => done.has(req))
    && (!c.rc || creditosLlevados(done) >= c.rc)

  // ---------- Planificador del próximo ciclo ----------
  // Si un curso planificado se marca como llevado, sale solo del plan
  useEffect(() => {
    setPlan(p => {
      const n = [...p].filter(id => byId[id] && !done.has(id))
      return n.length === p.size ? p : new Set(n)
    })
  }, [done, byId])

  const togglePlan = id => {
    const c = byId[id]
    if (plan.has(id)) {
      const n = new Set(plan)
      n.delete(id)
      setPlan(n)
      setLastAction(null)
    } else if (done.has(id)) {
      setLastAction({ planInfo: `${c.n} ya está marcado como llevado: no necesita entrar al plan.` })
    } else if (!disponible(c)) {
      setLastAction({
        planInfo: c.rc && c.r.every(r => done.has(r))
          ? `${c.n} pide ${c.rc} créditos aprobados y llevas ${creditosLlevados(done)}: aún no puedes planificarlo.`
          : `${c.n} todavía tiene requisitos pendientes: no podrías llevarlo el próximo ciclo.`
      })
    } else {
      setPlan(new Set(plan).add(id))
      setLastAction(null)
    }
  }

  // Estadísticas anónimas agregadas (query 28) para señalar cursos exigentes.
  // Si la RPC no existe o eres visitante, el medidor funciona sin esta señal.
  useEffect(() => {
    if (mode !== 'plan' || courseStats !== null || isGuest) return
    supabase.rpc('stats_cursos', { cids: M.cursos.map(c => c.id) }).then(({ data, error }) => {
      if (error) { console.error('[stats:cursos]', error); setCourseStats({}); return }
      const m = {}
      ;(data || []).forEach(r => { m[r.course_id] = r })
      setCourseStats(m)
    })
  }, [mode, courseStats, isGuest, M])

  const esExigente = id => {
    const s = courseStats?.[id]
    return !!s && s.registros >= 5 && s.aprobados_primera / s.registros < 0.5
  }

  // ---------- Buscador ----------
  const matches = useMemo(() => {
    const q = norm(busca.trim())
    if (q.length < 2) return []
    return M.cursos.filter(c => norm(c.n).includes(q))
  }, [busca, M])
  const matchSet = useMemo(() => new Set(matches.map(c => c.id)), [matches])

  useEffect(() => { setMatchIdx(0) }, [busca])
  useEffect(() => {
    const c = matches[matchIdx]
    if (!c || !scrollerRef.current) return
    scrollerRef.current.scrollTo({
      left: Math.max(0, c.x - 140),
      top: Math.max(0, c.y - 160),
      behavior: 'smooth'
    })
  }, [matches, matchIdx])

  const nodeClass = c => {
    if (mode === 'ficha') {
      const st = fichaStatus(c)
      return 'node ficha' + (st ? ' st-' + st : '') + (c.id === selected ? ' ring' : '')
    }
    if (mode === 'noreq') {
      if (done.has(c.id)) return 'node free free-done' // ya llevado
      if (disponible(c)) return 'node free free-todo' // puedes llevarlo ya
      return 'node faded' // aún le faltan requisitos
    }
    if (mode === 'plan') {
      if (plan.has(c.id)) return 'node plan-sel' + (esExigente(c.id) ? ' plan-warn' : '')
      if (done.has(c.id)) return 'node free free-done'
      if (disponible(c)) return 'node free free-todo'
      return 'node faded'
    }
    if (mode === 'done' || !selected) {
      return 'node' + (done.has(c.id) ? ' done' : '')
    }
    if (c.id === selected) return 'node sel'
    if (chain.has(c.id)) return 'node ' + (done.has(c.id) ? 'done' : mode === 'open' ? 'open' : 'req')
    return 'node dim' + (done.has(c.id) ? ' done' : '')
  }

  const edgeClass = e => {
    if (mode === 'noreq' || mode === 'plan') return 'e dim'
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
  if (lastAction?.planInfo) {
    status = <>{lastAction.planInfo}</>
  } else if (mode === 'plan') {
    const sel = M.cursos.filter(c => plan.has(c.id))
    const cred = sel.reduce((a, c) => a + c.cr, 0)
    const unionDone = new Set([...done, ...plan])
    // qué se desbloquearía DESPUÉS de aprobar el plan (nuevo respecto a hoy)
    const desbloquea = M.cursos.filter(c =>
      !done.has(c.id) && !plan.has(c.id) && c.r.length > 0 &&
      c.r.every(r => unionDone.has(r)) && !c.r.every(r => done.has(r))
    ).length
    const temidos = sel.filter(c => esExigente(c.id))
    status = sel.length === 0 ? (
      <>Arma tu <b>próximo ciclo</b>: toca los cursos disponibles para sumarlos al plan (se guarda en este dispositivo). {pill}</>
    ) : (
      <>
        Tu plan:&nbsp;
        <span className="pill v">{sel.length} {sel.length === 1 ? 'curso' : 'cursos'} · {cred} créd</span>
        {cred > 22 && <>&nbsp;<span className="pill r">⚠ carga alta (más de 22 créd)</span></>}
        {desbloquea > 0 && <>&nbsp;· al aprobarlo desbloquearías <b>{desbloquea}</b> {desbloquea === 1 ? 'curso' : 'cursos'} más</>}
        {temidos.length > 0 && (
          <>&nbsp;· <span className="pill r">⚠ {temidos.length} {temidos.length === 1 ? 'curso exigente' : 'cursos exigentes'}</span>
          &nbsp;(menos de la mitad lo aprueba a la primera)</>
        )}
        <button className="plan-view" onClick={ev => { ev.stopPropagation(); setPlanModalOpen(true) }}>Ver detalles</button>
        <button className="plan-clear" onClick={ev => { ev.stopPropagation(); setPlan(new Set()) }}>Vaciar plan</button>
      </>
    )
  } else if (lastAction?.blocked) {
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
  } else if (mode === 'noreq') {
    const disp = M.cursos.filter(disponible)
    const credDisp = disp.reduce((a, c) => a + c.cr, 0)
    status = (
      <>
        Cursos que <b>puedes llevar ahora mismo</b> (requisitos ya cumplidos con tus llevados), en blanco;
        los llevados en teal y los bloqueados atenuados.&nbsp;
        <span className="pill g">{disp.length} {disp.length === 1 ? 'disponible' : 'disponibles'} · {credDisp} créd</span> {pill}
      </>
    )
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
              : 'Si encuentras errores en la malla curricular, manda un correo a solopcional16@gmail.com con el asunto «Error en la malla» y describe el problema. Gracias por tu ayuda.'}
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
          <button className="panel-btn" onClick={() => setCalendarOpen(true)}>
            📅 Calendario
          </button>
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
          <button className={mode === 'noreq' ? 'on' : ''} onClick={ev => { ev.stopPropagation(); changeMode('noreq') }}>Qué puedo llevar</button>
          <button className={mode === 'plan' ? 'on' : ''} onClick={ev => { ev.stopPropagation(); changeMode('plan') }}>Planificar ciclo</button>
          {!isGuest && (
            <button className={mode === 'ficha' ? 'on' : ''} onClick={ev => { ev.stopPropagation(); changeMode('ficha') }}>Ficha del curso</button>
          )}
        </div>
        <div className="buscar-box" onClick={ev => ev.stopPropagation()}>
          <input
            type="text"
            placeholder="🔍 Buscar curso…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && matches.length > 1) setMatchIdx(i => (i + 1) % matches.length)
              if (e.key === 'Escape') setBusca('')
            }}
          />
          {busca.trim().length >= 2 && (
            <span className="buscar-count mono">
              {matches.length === 0 ? '0' : `${matchIdx + 1}/${matches.length}`}
            </span>
          )}
          {busca && (
            <button className="buscar-clear" onClick={() => setBusca('')} aria-label="Limpiar búsqueda">×</button>
          )}
        </div>
        {/* El arcade no está optimizado para táctil: en móvil no se ofrece */}
        {!isMobile && (
          <button className="arcade-btn" onClick={ev => { ev.stopPropagation(); setArcadeOpen(true) }}>
            🕹 ARCADE
          </button>
        )}
        <div className="legend">
          {mode === 'ficha' ? (
            <>
              {Object.entries(STATUS_META).map(([k, m]) => (
                <span key={k}><span className="sw" style={{ background: m.soft, border: `1.5px solid ${m.color}` }} />{m.label}</span>
              ))}
              <span><span className="sw" style={{ background: '#fff', border: '1.5px solid #C7CDC7' }} />Pendiente</span>
            </>
          ) : mode === 'noreq' ? (
            <>
              <span><span className="sw" style={{ background: '#fff', border: '1.5px solid #059e9f' }} />Disponible ahora</span>
              <span><span className="sw" style={{ background: '#e3f4f4', border: '1.5px solid #059e9f' }} />Llevado</span>
              <span><span className="sw" style={{ background: '#EDEFEC', border: '1.5px solid #C7CDC7', opacity: 0.5 }} />Le faltan requisitos</span>
            </>
          ) : mode === 'plan' ? (
            <>
              <span><span className="sw" style={{ background: '#efe8fb', border: '1.5px solid #7b5cc6' }} />En tu plan</span>
              <span><span className="sw" style={{ background: '#fff', border: '1.5px solid #059e9f' }} />Puedes planificarlo</span>
              <span><span className="sw" style={{ background: '#e3f4f4', border: '1.5px solid #059e9f' }} />Llevado</span>
              <span><span className="sw" style={{ background: '#EDEFEC', border: '1.5px solid #C7CDC7', opacity: 0.5 }} />Le faltan requisitos</span>
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

      <div className="frame">
        <div className="scroller" ref={scrollerRef} onClick={onScrollerClick} onMouseDown={onMouseDown}>
          {/* El wrapper reserva el tamaño escalado para que el scroll alcance;
              con zoom = 1 (desktop) es idéntico a no existir */}
          <div className="canvas-zoom" style={{ width: M.W * zoom, height: M.H * zoom }}>
          <div className="canvas" style={{ width: M.W, height: M.H, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
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
                className={nodeClass(c) + (matchSet.has(c.id) ? ' hit' : '')}
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
        {isMobile && (
          <div className="zoom-ctrl">
            <button onClick={() => applyZoom(zoomRef.current - 0.15)} aria-label="Alejar">−</button>
            <button onClick={() => applyZoom(zoomRef.current + 0.15)} aria-label="Acercar">+</button>
          </div>
        )}
      </div>

      <footer className="malla-foot mono">
        {M.foot}
      </footer>

      {!isGuest && (
        <SidePanel user={user} open={panelOpen} onClose={() => setPanelOpen(false)} done={done} cursos={M.cursos} ciclos={M.ciclos} statuses={statuses} uni={M.uni} nombreCarrera={M.nombre} />
      )}

      {!isGuest && logroToast && !arcadeOpen && (
        <div className="logro-toast" onClick={() => setLogroToast(null)} role="status">
          {logroToast.map(k => LOGROS[k] && (
            <div key={k} className="logro-toast-row">
              <span className="logro-toast-icon">{LOGROS[k].icon}</span>
              <span><b>¡Logro desbloqueado!</b> {LOGROS[k].name}</span>
            </div>
          ))}
          <span className="logro-toast-hint">Míralos en «Mi panel» → Logros</span>
        </div>
      )}

      {arcadeOpen && (
        <Suspense fallback={<div className="arcade-loading mono">CARGANDO ARCADE…</div>}>
          <Arcade user={user} onClose={() => setArcadeOpen(false)} />
        </Suspense>
      )}

      {swipeHint && <div className="swipe-hint">👉 Desliza para moverte por la malla</div>}

      {calendarOpen && (
        <Suspense fallback={<div className="arcade-loading mono">CARGANDO CALENDARIO…</div>}>
          <AcademicCalendar user={user} uni={M.uni} onClose={() => setCalendarOpen(false)} />
        </Suspense>
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

      {planModalOpen && (
        <div className="plan-modal-backdrop" onClick={() => setPlanModalOpen(false)}>
          <div className="plan-modal" onClick={e => e.stopPropagation()}>
            <header className="plan-modal-head">
              <h3>Tu plan de ciclo</h3>
              <button className="plan-modal-close" onClick={() => setPlanModalOpen(false)} aria-label="Cerrar">×</button>
            </header>
            <div className="plan-modal-body">
              {M.cursos.filter(c => plan.has(c.id)).sort((a, b) => a.c - b.c).map(c => (
                <div key={c.id} className="plan-item">
                  <span className="plan-item-cycle">Ciclo {c.c}</span>
                  <div className="plan-item-info">
                    <span className="plan-item-name">{c.n}</span>
                    {esExigente(c.id) && <span className="pill r micro">Exigente</span>}
                  </div>
                  <span className="plan-item-cred">{c.cr} créd</span>
                  <button className="plan-item-remove" onClick={() => togglePlan(c.id)} title="Quitar del plan">×</button>
                </div>
              ))}
              {plan.size === 0 && (
                <div className="plan-modal-empty">Tu plan está vacío.</div>
              )}
            </div>
            {plan.size > 0 && (
              <footer className="plan-modal-foot">
                <span>Total:</span>
                <b>{M.cursos.filter(c => plan.has(c.id)).reduce((a, c) => a + c.cr, 0)} créditos</b>
              </footer>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
