import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { CURSOS, CICLOS } from '../data/cursos'
import '../styles/SidePanel.css'

const PASS = 10.5 // nota mínima aprobatoria de referencia

const byId = {}
CURSOS.forEach(c => (byId[c.id] = c))

const fmt = v => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''))

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

// ---------- Panel lateral ----------
export default function SidePanel({ user, open, onClose, done }) {
  const [tab, setTab] = useState('graficos') // 'graficos' | 'ponderado' | 'tools'
  const [ciclo, setCiclo] = useState(1)
  const [grades, setGrades] = useState({})       // { course_id: number }
  const [drafts, setDrafts] = useState({})       // texto del input mientras se edita
  const [savedFlash, setSavedFlash] = useState({}) // { course_id: true } → muestra ✓ tras guardar
  const [gradesLoaded, setGradesLoaded] = useState(false)
  const [tools, setTools] = useState(null)
  const [toolName, setToolName] = useState('')
  const [toolUrl, setToolUrl] = useState('')
  const [msg, setMsg] = useState(null)

  // Cargar notas la primera vez que se abre el panel
  useEffect(() => {
    if (!open || gradesLoaded) return
    supabase
      .from('grades')
      .select('course_id, grade')
      .eq('student_id', user.id)
      .then(({ data, error }) => {
        if (error) { console.error('[grades:load]', error); return }
        const g = {}
        ;(data || []).forEach(r => (g[r.course_id] = Number(r.grade)))
        setGrades(g)
        setGradesLoaded(true)
      })
  }, [open, gradesLoaded, user.id])

  // Cargar herramientas al entrar a esa pestaña
  const loadTools = useCallback(async () => {
    const { data, error } = await supabase
      .from('tools')
      .select('id, name, url, created_by')
      .order('created_at', { ascending: true })
    if (error) { console.error('[tools:load]', error); setMsg('No se pudieron cargar las herramientas.'); return }
    setTools(data || [])
  }, [])

  useEffect(() => {
    if (open && tab === 'tools' && tools === null) loadTools()
  }, [open, tab, tools, loadTools])

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
    if (error) { console.error('[tools:add]', error); setMsg('No se pudo agregar la herramienta.'); return }
    setToolName(''); setToolUrl(''); setMsg(null)
    loadTools()
  }

  const removeTool = async id => {
    const { error } = await supabase.from('tools').delete().eq('id', id)
    if (error) { console.error('[tools:delete]', error); setMsg('No se pudo eliminar.'); return }
    loadTools()
  }

  // ---------- Derivados ----------
  const cicloCourses = useMemo(
    () => CURSOS.filter(c => c.c === Number(ciclo) && done.has(c.id)),
    [ciclo, done]
  )

  const cicloItems = useMemo(
    () => CURSOS.filter(c => c.c === Number(ciclo) && grades[c.id] !== undefined)
      .map(c => ({ id: c.id, name: c.n, grade: grades[c.id] })),
    [ciclo, grades]
  )

  const generalItems = useMemo(
    () => CURSOS.filter(c => grades[c.id] !== undefined)
      .map(c => ({ id: c.id, name: c.n, grade: grades[c.id] })),
    [grades]
  )

  const pondOf = items => {
    let cr = 0, sum = 0
    items.forEach(c => { if (c.cr > 0 && grades[c.id] !== undefined) { cr += c.cr; sum += grades[c.id] * c.cr } })
    return cr > 0 ? { value: sum / cr, cr } : null
  }

  const general = useMemo(() => pondOf(CURSOS), [grades])

  const porCiclo = useMemo(() => {
    const out = []
    Object.keys(CICLOS).forEach(num => {
      if (Number(num) === 0) return
      const p = pondOf(CURSOS.filter(c => c.c === Number(num)))
      if (p) out.push({ label: `C${num}`, num: Number(num), value: p.value, cr: p.cr })
    })
    return out
  }, [grades])

  const aprobados = generalItems.filter(i => i.grade >= PASS).length
  const desaprobados = generalItems.length - aprobados

  return (
    <>
      <div className={'sp-backdrop' + (open ? ' show' : '')} onClick={onClose} />
      <aside className={'sp' + (open ? ' open' : '')} aria-hidden={!open}>
        <header className="sp-head">
          <div>
            <div className="sp-eyebrow mono">Mi panel</div>
            <h2>Notas y herramientas</h2>
          </div>
          <button className="sp-close" onClick={onClose} aria-label="Cerrar panel">×</button>
        </header>

        <nav className="sp-tabs">
          <button className={tab === 'graficos' ? 'on' : ''} onClick={() => setTab('graficos')}>Gráficos</button>
          <button className={tab === 'ponderado' ? 'on' : ''} onClick={() => setTab('ponderado')}>Ponderado</button>
          <button className={tab === 'tools' ? 'on' : ''} onClick={() => setTab('tools')}>Herramientas</button>
        </nav>

        {msg && <div className="sp-msg">{msg}</div>}

        <div className="sp-body">
          {tab === 'graficos' && (
            <>
              <div className="sp-hint">
                Registra el promedio final (0–20) de tus cursos marcados como llevados.
              </div>

              <div className="sp-chips">
                {Object.keys(CICLOS).map(num => (
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
                  No tienes cursos marcados como llevados en {CICLOS[ciclo].t}. Márcalos en la malla
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
                  <h3>{CICLOS[ciclo].t} · notas</h3>
                  <BarChartNotas items={cicloItems} />
                </section>
              )}

              {generalItems.length > 0 && (
                <section className="sp-section">
                  <h3>General · {generalItems.length} {generalItems.length === 1 ? 'curso' : 'cursos'} con nota</h3>
                  {Object.keys(CICLOS).map(num => {
                    const items = CURSOS
                      .filter(c => c.c === Number(num) && grades[c.id] !== undefined)
                      .map(c => ({ id: c.id, name: c.n, grade: grades[c.id] }))
                    if (items.length === 0) return null
                    return (
                      <div key={num} className="sp-subblock">
                        <h4 className="sp-subhead mono">{CICLOS[num].t}</h4>
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
                        <span>{CICLOS[p.num].t}</span>
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

          {tab === 'tools' && (
            <>
              <div className="sp-hint">
                Sitios de ayuda compartidos entre todos los alumnos. Se abren en una pestaña nueva.
              </div>

              {tools === null ? (
                <div className="sp-empty">Cargando…</div>
              ) : tools.length === 0 ? (
                <div className="sp-empty">Todavía no hay herramientas. Agrega la primera abajo.</div>
              ) : (
                <div className="tool-list">
                  {tools.map(t => (
                    <div key={t.id} className="tool-row">
                      <a href={t.url} target="_blank" rel="noopener noreferrer">
                        <span className="tool-name">{t.name}</span>
                        <span className="tool-host mono">{new URL(t.url).hostname} ↗</span>
                      </a>
                      {t.created_by === user.id && (
                        <button className="tool-del" onClick={() => removeTool(t.id)} aria-label={`Eliminar ${t.name}`}>×</button>
                      )}
                    </div>
                  ))}
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
        </div>
      </aside>
    </>
  )
}
