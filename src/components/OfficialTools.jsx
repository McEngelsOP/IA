import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import StudyAdvisor from './StudyAdvisor'
import SemesterRoadmap from './SemesterRoadmap'
import '../styles/OfficialTools.css'
function OfficialTools({ tool, client, user, career, done, plan, onClose, onPlan, onBusy }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), lock = useRef(false), currentPlan = useRef(plan)
  const [resources, setResources] = useState([]), [loading, setLoading] = useState(tool === 'Recursos'), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (tool !== 'Recursos') return
    let alive = true; setLoading(true); setError('')
    client.from('tools').select('id,name,url').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (!alive) return
      if (error) setError('No se pudieron cargar los recursos. Reintenta.')
      else setResources((data || []).filter(r => { try { return ['https:', 'http:'].includes(new URL(r.url).protocol) } catch { return false } }))
      setLoading(false)
    }).catch(() => { if (alive) { setError('No se pudieron cargar los recursos. Reintenta.'); setLoading(false) } })
    return () => { alive = false }
  }, [tool, attempt])
  async function savePlan(courses) {
    if (lock.current) return
    lock.current = true; setBusy(true); onBusy(true); setMessage('')
    try {
      const verified = await client.auth.getUser()
      if (verified.error || verified.data.user?.id !== user.id) throw new Error('session')
      const ids = [...new Set([...currentPlan.current, ...courses])]
      const { error } = await client.from('progress').upsert({ student_id: user.id, done, plan: ids, updated_at: new Date().toISOString() }, { onConflict: 'student_id' })
      if (error) throw error
      currentPlan.current = ids; onPlan(ids); setMessage('Primer ciclo de la proyección guardado en tu plan.')
    } catch { setMessage('No se pudo guardar. Tu plan anterior se conserva; reintenta.') }
    finally { lock.current = false; setBusy(false); onBusy(false) }
  }
  const close = () => { if (!lock.current) onClose() }
  return <section className="official-tools">
    {tool === 'Asesor IA' ? <StudyAdvisor embedded careerName={career.nombre} planCourses={career.cursos.filter(c => plan.includes(c.id)).map(c => ({ id: c.id, name: c.n, credits: c.cr, prerequisites: c.r.map(id => career.cursos.find(c => c.id === id)?.n).filter(Boolean) }))} onClose={close}/> : tool === 'Brújula IA' ? <><p role="status">{busy ? 'Guardando tu plan…' : message}</p><SemesterRoadmap embedded courses={career.cursos} completedIds={done} onAddFirstSemester={savePlan} onClose={close}/></> : <div className="s-wrap w"><h2 className="s-h">Recursos</h2><p className="s-sub">Enlaces compartidos por la comunidad.</p><label className="s-srch">Buscar<input aria-label="Buscar recursos" value={query} onChange={e => setQuery(e.target.value)}/></label>{loading ? <p role="status">Cargando recursos…</p> : error ? <><p role="alert">{error}</p><button className="h-btn" onClick={() => setAttempt(n => n + 1)}>Reintentar</button></> : <div className="s-grid">{resources.filter(r => r.name.toLowerCase().includes(query.toLowerCase())).map(r => <article className="blk s-card" key={r.id}><h3>{r.name}</h3><a className="h-btn" href={r.url} target="_blank" rel="noopener noreferrer">Abrir recurso</a></article>)}{!resources.length && <p>Todavía no hay recursos compartidos.</p>}{resources.length > 0 && !resources.some(r => r.name.toLowerCase().includes(query.toLowerCase())) && <p>Sin resultados para esta búsqueda.</p>}</div>}</div>}
  </section>
}
export function mountOfficialTools(container, props) { const root = createRoot(container); root.render(<OfficialTools {...props}/>); return () => root.unmount() }
