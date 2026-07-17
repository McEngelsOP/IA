import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import ConfirmDialog from './ConfirmDialog'
import { LOGROS } from '../lib/logros'
import '../styles/SidePanel.css'

const PASS = 10.5 // nota mínima aprobatoria de referencia

const fmt = v => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''))
const fdate = iso =>
  new Date(iso).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' })

// ---------- Gráficos (SVG a mano, una sola serie) ----------

// Barra horizontal con extremo de dato redondeado (4px) y base recta
const barPath = (x0, y, w, t) => {
  if (w <= 4) return `M ${x0} ${y} h ${Math.max(w, 1.5)} v ${t} h ${-Math.max(w, 1.5)} Z`
  const xe = x0 + w
  return `M ${x0} ${y} H ${xe - 4} Q ${xe} ${y} ${xe} ${y + 4} V ${y + t - 4} Q ${xe} ${y + t} ${xe - 4} ${y + t} H ${x0} Z`
}

function BarChartNotas({ items }) {
  const W = 336, LABEL_W = 118, X0 = LABEL_W + 8, X1 = W - 34
  const ROW = 26, TOP = 16, T = 14
  const H = TOP + items.length * ROW + 14
  const x = g => X0 + (g / 20) * (X1 - X0)

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Notas por curso">
      {[5, 10, 15, 20].map(v => (
        <line key={v} x1={x(v)} y1={TOP - 6} x2={x(v)} y2={H - 12} className="grid" />
      ))}
      {/* línea de referencia: nota aprobatoria */}
      <line x1={x(PASS)} y1={TOP - 10} x2={x(PASS)} y2={H - 12} className="ref" />
      <text x={x(PASS)} y={TOP - 13} className="ref-lbl" textAnchor="middle">{PASS}</text>
      {[0, 5, 10, 15, 20].map(v => (
        <text key={v} x={x(v)} y={H - 2} className="tick" textAnchor="middle">{v}</text>
      ))}
      {items.map((it, i) => {
        const y = TOP + i * ROW
        const ok = it.grade >= PASS
        return (
          <g key={it.id}>
            <title>{`${it.name}: ${fmt(it.grade)} / 20`}</title>
            <text x={LABEL_W} y={y + T / 2 + 3.5} className="bar-lbl" textAnchor="end">
              {it.name.length > 19 ? it.name.slice(0, 18) + '…' : it.name}
            </text>
            <path d={barPath(X0, y, x(it.grade) - X0, T)} className={ok ? 'bar ok' : 'bar bad'} />
            <text x={x(it.grade) + 5} y={y + T / 2 + 3.5} className="bar-val">{fmt(it.grade)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function LineChartPonderado({ points }) {
  const W = 336, H = 168, ML = 26, MR = 34, MT = 16, MB = 22
  const y = v => MT + (1 - v / 20) * (H - MT - MB)
  const x = i =>
    points.length === 1 ? ML + (W - ML - MR) / 2 : ML + (i * (W - ML - MR)) / (points.length - 1)
  const d = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.value)}`).join(' ')
  const last = points[points.length - 1]

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución del ponderado por ciclo">
      {[0, 5, 10, 15, 20].map(v => (
        <g key={v}>
          <line x1={ML} y1={y(v)} x2={W - MR} y2={y(v)} className="grid" />
          <text x={ML - 5} y={y(v) + 3} className="tick" textAnchor="end">{v}</text>
        </g>
      ))}
      <line x1={ML} y1={y(PASS)} x2={W - MR} y2={y(PASS)} className="ref" />
      <path d={d} className="trend" />
      {points.map((p, i) => (
        <g key={p.label}>
          <title>{`${p.label}: ${p.value.toFixed(2)}`}</title>
          <circle cx={x(i)} cy={y(p.value)} r="4" className="dot" />
          <text x={x(i)} y={H - 6} className="tick" textAnchor="middle">{p.label}</text>
        </g>
      ))}
      <text x={x(points.length - 1)} y={y(last.value) - 9} className="end-lbl" textAnchor="middle">
        {last.value.toFixed(2)}
      </text>
    </svg>
  )
}

// Histograma de distribución de notas (0–20, redondeadas al entero)
function HistNotas({ values }) {
  const counts = Array.from({ length: 21 }, () => 0)
  values.forEach(v => counts[Math.min(20, Math.max(0, Math.round(v)))]++)
  const max = Math.max(...counts, 1)
  const W = 336, H = 150, ML = 8, MR = 8, MT = 18, MB = 20
  const bw = (W - ML - MR) / 21
  const y0 = H - MB
  const hOf = c => (c / max) * (y0 - MT)

  // Columna con tope redondeado (2.5px) y base recta, como las barras del panel
  const colPath = (x, h, w) => {
    if (h <= 3) return `M ${x} ${y0} h ${w} v ${-Math.max(h, 1.5)} h ${-w} Z`
    const yt = y0 - h
    return `M ${x} ${y0} V ${yt + 2.5} Q ${x} ${yt} ${x + 2.5} ${yt} H ${x + w - 2.5} Q ${x + w} ${yt} ${x + w} ${yt + 2.5} V ${y0} Z`
  }

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Distribución de notas">
      <line x1={ML} y1={y0} x2={W - MR} y2={y0} className="ref" />
      {counts.map((c, g) => {
        if (c === 0) return null
        const x = ML + g * bw + 1
        return (
          <g key={g}>
            <title>{`Nota ${g}: ${c} ${c === 1 ? 'curso' : 'cursos'}`}</title>
            <path d={colPath(x, hOf(c), bw - 2)} className={g >= PASS ? 'bar ok' : 'bar bad'} />
            <text x={x + (bw - 2) / 2} y={y0 - hOf(c) - 4} className="hist-count" textAnchor="middle">{c}</text>
          </g>
        )
      })}
      {[0, 5, 10, 15, 20].map(g => (
        <text key={g} x={ML + g * bw + bw / 2} y={H - 6} className="tick" textAnchor="middle">{g}</text>
      ))}
    </svg>
  )
}

// ---------- Panel lateral ----------
// cursos/ciclos: la malla de la carrera del alumno (viene de MallaCurricular)
// statuses: estados de la ficha del curso — los desaprobados cuentan en el ponderado
export default function SidePanel({ user, open, onClose, done, cursos, ciclos, statuses = {} }) {
  const [tab, setTab] = useState('graficos') // 'graficos' | 'ponderado' | 'stats' | 'tools' | 'logros' | 'historia'
  const [logrosMap, setLogrosMap] = useState(null) // { clave: earned_at } · null = sin cargar
  const [ciclo, setCiclo] = useState(1)
  const [grades, setGrades] = useState({})       // { course_id: number }
  const [drafts, setDrafts] = useState({})       // texto del input mientras se edita
  const [savedFlash, setSavedFlash] = useState({}) // { course_id: true } → muestra ✓ tras guardar
  const [tools, setTools] = useState(null)
  const [toolName, setToolName] = useState('')
  const [toolUrl, setToolUrl] = useState('')
  const [msg, setMsg] = useState(null)
  // Nombre secreto para comentar: undefined = cargando · null = aún sin elegir
  const [alias, setAlias] = useState(undefined)
  const [aliasDraft, setAliasDraft] = useState('')
  const [savingAlias, setSavingAlias] = useState(false)
  const [openComments, setOpenComments] = useState(null) // id de la herramienta expandida
  const [commentDraft, setCommentDraft] = useState('')
  const [sendingComment, setSendingComment] = useState(false)
  const [confirmData, setConfirmData] = useState(null) // panel de confirmación de borrado

  // Cargar notas cada vez que se abre el panel (la ficha del curso
  // también las edita, así que no se cachean entre aperturas)
  useEffect(() => {
    if (!open) return
    supabase
      .from('grades')
      .select('course_id, grade')
      .eq('student_id', user.id)
      .then(({ data, error }) => {
        if (error) { console.error('[grades:load]', error); return }
        const g = {}
        ;(data || []).forEach(r => (g[r.course_id] = Number(r.grade)))
        setGrades(g)
      })
  }, [open, user.id])

  // Cargar herramientas al entrar a esa pestaña.
  // OJO: tool_comments se pide con columnas explícitas — author_id no es
  // legible desde el cliente (anonimato por permiso de columna).
  const loadTools = useCallback(async () => {
    const { data, error } = await supabase
      .from('tools')
      .select('id, name, url, created_by, tool_likes ( student_id ), tool_comments ( id, alias, body, created_at )')
      .order('created_at', { ascending: true })
    if (error) { console.error('[tools:load]', error); setMsg('No se pudieron cargar las herramientas.'); return }
    // Más likes primero; a igualdad, se conserva el orden de creación
    setTools((data || []).sort((a, b) => b.tool_likes.length - a.tool_likes.length))
  }, [])

  useEffect(() => {
    if (open && tab === 'tools' && tools === null) loadTools()
  }, [open, tab, tools, loadTools])

  // Logros del alumno (RLS: solo los propios). Se otorgan vía la RPC
  // reclamar_logros desde MallaCurricular; aquí solo se leen.
  useEffect(() => {
    if (!open || (tab !== 'logros' && tab !== 'historia') || logrosMap !== null) return
    supabase
      .from('logros')
      .select('logro, earned_at')
      .then(({ data, error }) => {
        if (error) { console.error('[logros:load]', error); setLogrosMap({}); return }
        const m = {}
        ;(data || []).forEach(r => { m[r.logro] = r.earned_at })
        setLogrosMap(m)
      })
  }, [open, tab, logrosMap])

  // El alias propio se lee del perfil (los demás nunca ven tu alias junto a tu identidad)
  useEffect(() => {
    if (!open || tab !== 'tools' || alias !== undefined) return
    supabase
      .from('profiles')
      .select('alias')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) { console.error('[alias:load]', error); return }
        setAlias(data?.alias ?? null)
      })
  }, [open, tab, alias, user.id])

  // Muestra un ✓ junto al campo durante un momento tras guardar con éxito
  const flashSaved = courseId => {
    setSavedFlash(s => ({ ...s, [courseId]: true }))
    setTimeout(() => {
      setSavedFlash(s => { const n = { ...s }; delete n[courseId]; return n })
    }, 1800)
  }

  const saveGrade = async (courseId, raw) => {
    const text = String(raw).trim().replace(',', '.')
    setDrafts(d => { const n = { ...d }; delete n[courseId]; return n })

    if (text === '') {
      if (grades[courseId] === undefined) return
      setGrades(g => { const n = { ...g }; delete n[courseId]; return n })
      const { error } = await supabase.from('grades').delete().match({ student_id: user.id, course_id: courseId })
      if (error) { console.error('[grades:delete]', error); setMsg('No se pudo borrar la nota.'); return }
      flashSaved(courseId)
      return
    }

    const val = Number(text)
    if (!Number.isFinite(val) || val < 0 || val > 20) { setMsg('La nota debe estar entre 0 y 20.'); return }
    setMsg(null)
    setGrades(g => ({ ...g, [courseId]: val }))
    const { error } = await supabase
      .from('grades')
      .upsert({ student_id: user.id, course_id: courseId, grade: val, updated_at: new Date().toISOString() })
    if (error) { console.error('[grades:save]', error); setMsg('No se pudo guardar la nota.'); return }
    flashSaved(courseId)
  }

  const addTool = async e => {
    e.preventDefault()
    const name = toolName.trim()
    let url = toolUrl.trim()
    if (name.length < 2 || !url) return
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    try { new URL(url) } catch { setMsg('Ese link no parece válido.'); return }
    const { error } = await supabase.from('tools').insert({ name, url, created_by: user.id })
    if (error) {
      console.error('[tools:add]', error)
      setMsg(error.code === '42501' ? 'Llegaste al tope de 20 herramientas por alumno.' : 'No se pudo agregar la herramienta.')
      return
    }
    setToolName(''); setToolUrl(''); setMsg(null)
    loadTools()
  }

  // Borrar pide confirmación: eliminar una herramienta se lleva también
  // sus likes y comentarios (de todos), no solo lo tuyo
  const removeTool = t => setConfirmData({
    message: `¿Eliminar la herramienta «${t.name}»?`,
    detail: 'Se borrará para todos los alumnos, junto con sus likes y comentarios. Esto no se puede deshacer.',
    onConfirm: async () => {
      const { error } = await supabase.from('tools').delete().eq('id', t.id)
      if (error) { console.error('[tools:delete]', error); setMsg('No se pudo eliminar.'); return }
      loadTools()
    }
  })

  // Like con actualización optimista (mismo patrón que los votos de profesores).
  // La lista no se reordena al instante para que las filas no salten.
  const toggleLike = async t => {
    const mine = t.tool_likes.some(l => l.student_id === user.id)
    const prev = tools
    setTools(tools.map(row => {
      if (row.id !== t.id) return row
      return {
        ...row,
        tool_likes: mine
          ? row.tool_likes.filter(l => l.student_id !== user.id)
          : [...row.tool_likes, { student_id: user.id }]
      }
    }))
    let error
    if (mine) {
      ;({ error } = await supabase.from('tool_likes').delete().match({ tool_id: t.id, student_id: user.id }))
    } else {
      ;({ error } = await supabase.from('tool_likes').insert({ tool_id: t.id, student_id: user.id }))
    }
    if (error) {
      console.error('[tools:like]', error)
      setMsg('No se pudo registrar tu like.')
      setTools(prev)
      return
    }
    setMsg(null)
  }

  // Nombre secreto: se elige una sola vez (un trigger en la base impide cambiarlo)
  const saveAlias = async e => {
    e.preventDefault()
    const a = aliasDraft.trim()
    if (a.length < 3 || a.length > 24) {
      setMsg('El nombre secreto debe tener entre 3 y 24 caracteres.')
      return
    }
    setSavingAlias(true)
    const { error } = await supabase.from('profiles').update({ alias: a }).eq('id', user.id)
    setSavingAlias(false)
    if (error) {
      console.error('[alias:save]', error)
      setMsg(error.code === '23505' ? 'Ese nombre secreto ya está en uso. Prueba con otro.' : 'No se pudo guardar tu nombre secreto.')
      return
    }
    setAlias(a)
    setAliasDraft('')
    setMsg(null)
  }

  const addComment = async e => {
    e.preventDefault()
    const body = commentDraft.trim()
    if (body.length < 2 || !openComments) return
    setSendingComment(true)
    // El alias NO se envía: lo estampa el servidor desde el perfil
    const { error } = await supabase
      .from('tool_comments')
      .insert({ tool_id: openComments, author_id: user.id, body })
    setSendingComment(false)
    if (error) {
      console.error('[comments:add]', error)
      setMsg(error.code === '42501' ? 'Llegaste al tope de 5 comentarios en esta herramienta.' : 'No se pudo publicar el comentario.')
      return
    }
    setCommentDraft('')
    setMsg(null)
    loadTools()
  }

  const removeComment = c => setConfirmData({
    message: '¿Eliminar tu comentario?',
    detail: `Firmado como ${c.alias} · esto no se puede deshacer.`,
    onConfirm: async () => {
      const { error } = await supabase.from('tool_comments').delete().eq('id', c.id)
      if (error) { console.error('[comments:delete]', error); setMsg('No se pudo eliminar el comentario.'); return }
      setMsg(null)
      loadTools()
    }
  })

  // ---------- Derivados ----------
  // Un curso cuenta para promedios y estadísticas solo si tiene nota Y sigue
  // llevado (aprobado/convalidado) o está desaprobado en la ficha. Las notas
  // de cursos que dejaron de estar llevados (retiros) quedan fuera: siguen
  // guardadas, pero no arrastran el ponderado (reaparecen si se vuelve a
  // marcar el curso).
  const cuenta = c =>
    grades[c.id] !== undefined &&
    (done.has(c.id) || statuses[c.id]?.status === 'desaprobado')

  const cicloCourses = useMemo(
    () => cursos.filter(c => c.c === Number(ciclo) && done.has(c.id)),
    [cursos, ciclo, done]
  )

  const cicloItems = useMemo(
    () => cursos.filter(c => c.c === Number(ciclo) && cuenta(c))
      .map(c => ({ id: c.id, name: c.n, grade: grades[c.id] })),
    [cursos, ciclo, grades, done, statuses]
  )

  const generalItems = useMemo(
    () => cursos.filter(cuenta)
      .map(c => ({ id: c.id, name: c.n, grade: grades[c.id] })),
    [cursos, grades, done, statuses]
  )

  const pondOf = items => {
    let cr = 0, sum = 0
    items.forEach(c => { if (c.cr > 0 && cuenta(c)) { cr += c.cr; sum += grades[c.id] * c.cr } })
    return cr > 0 ? { value: sum / cr, cr } : null
  }

  const general = useMemo(() => pondOf(cursos), [cursos, grades, done, statuses])

  const porCiclo = useMemo(() => {
    const out = []
    Object.keys(ciclos).forEach(num => {
      if (Number(num) === 0) return
      const p = pondOf(cursos.filter(c => c.c === Number(num)))
      if (p) out.push({ label: `C${num}`, num: Number(num), value: p.value, cr: p.cr })
    })
    return out
  }, [cursos, ciclos, grades, done, statuses])

  const aprobados = generalItems.filter(i => i.grade >= PASS).length
  const desaprobados = generalItems.length - aprobados

  // ---------- Historia académica (línea de tiempo privada) ----------
  // Se arma en el cliente con lo ya registrado: cursos llevados por ciclo,
  // hitos de avance en créditos y ponderado por ciclo si hay notas.
  const historia = useMemo(() => {
    const items = []
    const total = cursos.reduce((s, c) => s + c.cr, 0)
    const hitos = [25, 50, 75, 100]
    let acum = 0
    let hi = 0
    Object.keys(ciclos).map(Number).sort((a, b) => a - b).forEach(num => {
      const llevados = cursos.filter(c => c.c === num && done.has(c.id))
      if (llevados.length === 0) return
      const cr = llevados.reduce((s, c) => s + c.cr, 0)
      acum += cr
      const p = porCiclo.find(x => x.num === num)
      items.push({
        icon: '📚',
        t: `${ciclos[num].t}: ${llevados.length} ${llevados.length === 1 ? 'curso llevado' : 'cursos llevados'}`,
        s: `${fmt(cr)} créditos${p ? ` · ponderado ${p.value.toFixed(2)}` : ''}`
      })
      const pct = total > 0 ? (acum / total) * 100 : 0
      while (hi < hitos.length && pct >= hitos[hi]) {
        items.push({
          icon: hitos[hi] === 100 ? '🏁' : '⭐',
          t: `${hitos[hi]} % de la carrera completado`,
          s: `${fmt(acum)} de ${fmt(total)} créditos`
        })
        hi++
      }
    })
    return items
  }, [cursos, ciclos, done, porCiclo])

  // ---------- Estadísticas ----------
  const stats = useMemo(() => {
    if (generalItems.length === 0) return null
    const simple = generalItems.reduce((s, i) => s + i.grade, 0) / generalItems.length
    const mejor = generalItems.reduce((a, b) => (b.grade > a.grade ? b : a))
    const peor = generalItems.reduce((a, b) => (b.grade < a.grade ? b : a))
    const credLlevados = cursos.reduce((s, c) => s + (done.has(c.id) ? c.cr : 0), 0)
    const credAprobados = cursos.reduce(
      (s, c) => s + (cuenta(c) && grades[c.id] >= PASS ? c.cr : 0), 0)
    const mejorCiclo = porCiclo.length ? porCiclo.reduce((a, b) => (b.value > a.value ? b : a)) : null
    const peorCiclo = porCiclo.length ? porCiclo.reduce((a, b) => (b.value < a.value ? b : a)) : null
    return { simple, mejor, peor, credLlevados, credAprobados, mejorCiclo, peorCiclo }
  }, [generalItems, cursos, grades, done, statuses, porCiclo])

  return (
    <>
      <div className={'sp-backdrop' + (open ? ' show' : '')} onClick={onClose} />
      <aside className={'sp' + (open ? ' open' : '')} aria-hidden={!open}>
        <header className="sp-head">
          <div>
            <div className="sp-eyebrow mono">PANEL</div>
            <h2>Mi panel</h2>
          </div>
          <button className="sp-close" onClick={onClose} aria-label="Cerrar panel">×</button>
        </header>

        <nav className="sp-tabs">
          <button className={tab === 'graficos' ? 'on' : ''} onClick={() => setTab('graficos')}>Gráficos</button>
          <button className={tab === 'ponderado' ? 'on' : ''} onClick={() => setTab('ponderado')}>Ponderado</button>
          <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>Estadísticas</button>
          <button className={tab === 'tools' ? 'on' : ''} onClick={() => setTab('tools')}>Herramientas</button>
          <button className={tab === 'logros' ? 'on' : ''} onClick={() => setTab('logros')}>Logros</button>
          <button className={tab === 'historia' ? 'on' : ''} onClick={() => setTab('historia')}>Historia</button>
        </nav>

        {msg && <div className="sp-msg">{msg}</div>}

        <div className="sp-body">
          {tab === 'graficos' && (
            <>
              <div className="sp-hint">
                Registra el promedio final (0–20) de tus cursos marcados como llevados.
              </div>

              <div className="sp-chips">
                {Object.keys(ciclos).map(num => (
                  <button
                    key={num}
                    className={'chip mono' + (Number(ciclo) === Number(num) ? ' on' : '')}
                    onClick={() => setCiclo(Number(num))}
                  >
                    {Number(num) === 0 ? 'PRE' : `C${num}`}
                  </button>
                ))}
              </div>

              {cicloCourses.length === 0 ? (
                <div className="sp-empty">
                  No tienes cursos marcados como llevados en {ciclos[ciclo].t}. Márcalos en la malla
                  («Marcar llevados») y aparecerán aquí.
                </div>
              ) : (
                <div className="grade-list">
                  {cicloCourses.map(c => (
                    <label key={c.id} className="grade-row">
                      <span className="grade-name">{c.n}</span>
                      {savedFlash[c.id] && <span className="grade-saved">✓ guardada</span>}
                      <input
                        className="mono"
                        type="number" min="0" max="20" step="0.5" placeholder="—"
                        value={drafts[c.id] !== undefined ? drafts[c.id] : grades[c.id] ?? ''}
                        onChange={e => setDrafts(d => ({ ...d, [c.id]: e.target.value }))}
                        onBlur={e => saveGrade(c.id, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                      />
                    </label>
                  ))}
                </div>
              )}

              {cicloItems.length > 0 && (
                <section className="sp-section">
                  <h3>{ciclos[ciclo].t} · notas</h3>
                  <BarChartNotas items={cicloItems} />
                </section>
              )}

              {generalItems.length > 0 && (
                <section className="sp-section">
                  <h3>General · {generalItems.length} {generalItems.length === 1 ? 'curso' : 'cursos'} con nota</h3>
                  {Object.keys(ciclos).map(num => {
                    const items = cursos
                      .filter(c => c.c === Number(num) && cuenta(c))
                      .map(c => ({ id: c.id, name: c.n, grade: grades[c.id] }))
                    if (items.length === 0) return null
                    return (
                      <div key={num} className="sp-subblock">
                        <h4 className="sp-subhead mono">{ciclos[num].t}</h4>
                        <BarChartNotas items={items} />
                      </div>
                    )
                  })}
                </section>
              )}
            </>
          )}

          {tab === 'ponderado' && (
            general ? (
              <>
                <div className="sp-hero">
                  <div className="sp-hero-num">{general.value.toFixed(2)}</div>
                  <div className="sp-hero-sub">
                    Ponderado general · {general.cr} créditos con nota
                  </div>
                </div>

                <div className="sp-stats">
                  <div className="stat">
                    <span className="stat-lbl">Aprobados</span>
                    <span className="stat-val mono">{aprobados}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-lbl">Desaprobados</span>
                    <span className="stat-val mono">{desaprobados}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-lbl">Ciclos con nota</span>
                    <span className="stat-val mono">{porCiclo.length}</span>
                  </div>
                </div>

                {porCiclo.length > 0 && (
                  <section className="sp-section">
                    <h3>Evolución del ponderado por ciclo</h3>
                    <LineChartPonderado points={porCiclo} />
                  </section>
                )}

                <section className="sp-section">
                  <h3>Detalle por ciclo</h3>
                  <div className="pond-list">
                    {porCiclo.map(p => (
                      <div key={p.label} className="pond-row">
                        <span>{ciclos[p.num].t}</span>
                        <span className="pond-cr mono">{p.cr} créd</span>
                        <span className="pond-val mono">{p.value.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <div className="sp-empty">
                Aún no hay notas registradas. Ingresa tus promedios en la pestaña «Gráficos»
                y aquí verás tu ponderado general.
              </div>
            )
          )}

          {tab === 'stats' && (
            !stats ? (
              <div className="sp-empty">
                Aún no hay notas registradas. Ingresa tus promedios en la pestaña «Gráficos»
                y aquí verás tus estadísticas académicas.
              </div>
            ) : (
              <>
                {general && (
                  <div className="sp-hero">
                    <div className="sp-hero-num">{general.value.toFixed(2)}</div>
                    <div className="sp-hero-sub">
                      Ponderado general · promedio simple {stats.simple.toFixed(2)}
                    </div>
                  </div>
                )}

                <div className="sp-stats">
                  <div className="stat">
                    <span className="stat-lbl">Mejor nota</span>
                    <span className="stat-val mono">{fmt(stats.mejor.grade)}</span>
                    <span className="stat-sub">{stats.mejor.name}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-lbl">Peor nota</span>
                    <span className="stat-val mono">{fmt(stats.peor.grade)}</span>
                    <span className="stat-sub">{stats.peor.name}</span>
                  </div>
                </div>

                <div className="sp-stats">
                  <div className="stat">
                    <span className="stat-lbl">Aprobados</span>
                    <span className="stat-val mono">{aprobados}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-lbl">Desaprobados</span>
                    <span className="stat-val mono">{desaprobados}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-lbl">Con nota</span>
                    <span className="stat-val mono">{generalItems.length}</span>
                  </div>
                </div>

                <div className="sp-stats">
                  <div className="stat">
                    <span className="stat-lbl">Créditos llevados</span>
                    <span className="stat-val mono">{fmt(stats.credLlevados)}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-lbl">Créditos aprobados (con nota)</span>
                    <span className="stat-val mono">{fmt(stats.credAprobados)}</span>
                  </div>
                </div>

                {stats.mejorCiclo && (
                  <div className="sp-stats">
                    <div className="stat">
                      <span className="stat-lbl">Mejor ciclo</span>
                      <span className="stat-val mono">{stats.mejorCiclo.value.toFixed(2)}</span>
                      <span className="stat-sub">{ciclos[stats.mejorCiclo.num].t}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-lbl">Ciclo más difícil</span>
                      <span className="stat-val mono">{stats.peorCiclo.value.toFixed(2)}</span>
                      <span className="stat-sub">{ciclos[stats.peorCiclo.num].t}</span>
                    </div>
                  </div>
                )}

                <section className="sp-section">
                  <h3>Distribución de notas</h3>
                  <HistNotas values={generalItems.map(i => i.grade)} />
                  <div className="sp-hint" style={{ marginTop: 6 }}>
                    Cada columna cuenta cuántos cursos tienen esa nota (redondeada).
                    Verde = aprobado (≥ {PASS}), ámbar = desaprobado.
                  </div>
                </section>
              </>
            )
          )}

          {tab === 'tools' && (
            <>
              <div className="sp-hint">
                Sitios de ayuda compartidos entre todos los alumnos. Dales like y coméntalos —
                los comentarios se firman con tu <b>nombre secreto</b>, nadie sabe quién eres.
              </div>

              {tools === null ? (
                <div className="sp-empty">Cargando…</div>
              ) : tools.length === 0 ? (
                <div className="sp-empty">Todavía no hay herramientas. Agrega la primera abajo.</div>
              ) : (
                <div className="tool-list">
                  {tools.map(t => {
                    const liked = t.tool_likes.some(l => l.student_id === user.id)
                    const expanded = openComments === t.id
                    const comments = [...t.tool_comments].sort((a, b) => a.created_at.localeCompare(b.created_at))
                    return (
                      <div key={t.id} className="tool-row">
                        <div className="tool-main">
                          <a href={t.url} target="_blank" rel="noopener noreferrer">
                            <span className="tool-name">{t.name}</span>
                            <span className="tool-host mono">{new URL(t.url).hostname} ↗</span>
                          </a>
                          <button
                            className={'tool-like' + (liked ? ' on' : '')}
                            onClick={() => toggleLike(t)}
                            title={liked ? 'Quitar mi like' : 'Me sirve esta herramienta'}
                          >
                            ♥ <b className="mono">{t.tool_likes.length}</b>
                          </button>
                          <button
                            className={'tool-cmt' + (expanded ? ' on' : '')}
                            onClick={() => { setOpenComments(expanded ? null : t.id); setCommentDraft('') }}
                            title={expanded ? 'Ocultar comentarios' : 'Ver comentarios'}
                          >
                            💬 <b className="mono">{t.tool_comments.length}</b>
                          </button>
                          {t.created_by === user.id && (
                            <button className="tool-del" onClick={() => removeTool(t)} aria-label={`Eliminar ${t.name}`}>×</button>
                          )}
                        </div>

                        {expanded && (
                          <div className="tc-box">
                            {comments.length === 0 ? (
                              <div className="tc-empty">Nadie ha comentado esta herramienta todavía. Sé el primero:</div>
                            ) : (
                              comments.map(c => (
                                <div key={c.id} className="tc-row">
                                  <span className="tc-alias mono">{c.alias}</span>
                                  <p className="tc-body">{c.body}</p>
                                  {alias && c.alias === alias && (
                                    <button className="tc-del" onClick={() => removeComment(c)} title="Eliminar mi comentario">×</button>
                                  )}
                                </div>
                              ))
                            )}

                            {alias === null ? (
                              <form className="tc-alias-form" onSubmit={saveAlias}>
                                <p className="tc-note">
                                  Para comentar, elige tu <b>nombre secreto</b>: firmará tus comentarios
                                  sin revelar quién eres, y <b>no se puede cambiar</b> después.
                                </p>
                                <div className="tc-line">
                                  <input
                                    type="text" maxLength="24" placeholder="3 a 24 caracteres"
                                    value={aliasDraft} onChange={e => setAliasDraft(e.target.value)}
                                  />
                                  <button type="submit" disabled={savingAlias || aliasDraft.trim().length < 3}>
                                    {savingAlias ? 'Guardando…' : 'Usar este nombre'}
                                  </button>
                                </div>
                              </form>
                            ) : alias ? (
                              <form className="tc-line" onSubmit={addComment}>
                                <input
                                  type="text" maxLength="300" placeholder={`Comentar como ${alias}…`}
                                  value={commentDraft} onChange={e => setCommentDraft(e.target.value)}
                                />
                                <button type="submit" disabled={sendingComment || commentDraft.trim().length < 2}>
                                  {sendingComment ? '…' : 'Publicar'}
                                </button>
                              </form>
                            ) : (
                              <div className="tc-empty mono">CARGANDO…</div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <form className="tool-form" onSubmit={addTool}>
                <input
                  type="text" placeholder="Nombre (ej. Wolfram Alpha)" maxLength="60"
                  value={toolName} onChange={e => setToolName(e.target.value)}
                />
                <input
                  type="text" placeholder="Link (ej. wolframalpha.com)"
                  value={toolUrl} onChange={e => setToolUrl(e.target.value)}
                />
                <button type="submit" disabled={toolName.trim().length < 2 || !toolUrl.trim()}>
                  Agregar herramienta
                </button>
              </form>
            </>
          )}

          {tab === 'logros' && (
            logrosMap === null ? (
              <div className="sp-empty">Cargando…</div>
            ) : (
              <>
                <div className="sp-hint">
                  Se desbloquean con tu participación: avance de malla, reseñas, profesores,
                  herramientas y arcade. Son privados — solo tú los ves. Las notas no influyen.
                </div>
                <div className="sp-hero">
                  <div className="sp-hero-num">
                    {Object.keys(logrosMap).length}<span className="lg-total"> / {Object.keys(LOGROS).length}</span>
                  </div>
                  <div className="sp-hero-sub">logros desbloqueados</div>
                </div>
                <div className="lg-grid">
                  {Object.entries(LOGROS).map(([k, m]) => {
                    const won = logrosMap[k]
                    return (
                      <div key={k} className={'lg-card' + (won ? ' won' : '')}>
                        <span className="lg-icon">{m.icon}</span>
                        <span className="lg-name">{m.name}</span>
                        <span className="lg-desc">{won ? `Desbloqueado · ${fdate(won)}` : m.desc}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )
          )}

          {tab === 'historia' && (
            <>
              <div className="sp-hint">
                Tu línea de tiempo universitaria, armada con lo que registras en la malla.
                Privada — solo tú la ves.
              </div>
              <div className="tl">
                <div className="tl-item">
                  <span className="tl-icon">🎉</span>
                  <div className="tl-txt">
                    <div className="tl-t">Te uniste a la malla interactiva</div>
                    <div className="tl-s">{fdate(user.created_at)}</div>
                  </div>
                </div>
                {historia.map((it, i) => (
                  <div key={i} className="tl-item">
                    <span className="tl-icon">{it.icon}</span>
                    <div className="tl-txt">
                      <div className="tl-t">{it.t}</div>
                      <div className="tl-s">{it.s}</div>
                    </div>
                  </div>
                ))}
              </div>
              {historia.length === 0 && (
                <div className="sp-empty">
                  Marca cursos como llevados en la malla y tu historia se irá escribiendo aquí:
                  ciclos, créditos y hitos de avance.
                </div>
              )}
              {logrosMap && Object.keys(logrosMap).length > 0 && (
                <section className="sp-section">
                  <h3>Logros conseguidos</h3>
                  <div className="tl">
                    {Object.entries(logrosMap)
                      .sort((a, b) => a[1].localeCompare(b[1]))
                      .map(([k, d]) => LOGROS[k] && (
                        <div key={k} className="tl-item">
                          <span className="tl-icon">{LOGROS[k].icon}</span>
                          <div className="tl-txt">
                            <div className="tl-t">{LOGROS[k].name}</div>
                            <div className="tl-s">{fdate(d)}</div>
                          </div>
                        </div>
                      ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </aside>

      <ConfirmDialog data={confirmData} onClose={() => setConfirmData(null)} />
    </>
  )
}
