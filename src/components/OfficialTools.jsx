import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import StudyAdvisor from './StudyAdvisor'
import SemesterRoadmap from './SemesterRoadmap'
import '../styles/OfficialTools.css'
import '../styles/OfficialSurfaces.css'
import OfficialRoadmap from './OfficialRoadmap'
import OfficialIcon from './OfficialIcon'
import useMediaQuery from '../lib/useMediaQuery'
function OfficialTools({ tool, client, user, career, preferences = {}, done, plan, onClose, onPlan, onBusy }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), lock = useRef(false), currentPlan = useRef(plan)
  const [resources, setResources] = useState([]), [loading, setLoading] = useState(tool === 'Recursos'), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [attempt, setAttempt] = useState(0)
  const [sort, setSort] = useState('recent')
  const [savedPlan, setSavedPlan] = useState(plan)
  const desktop = useMediaQuery('(min-width: 861px)')
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
      currentPlan.current = ids; setSavedPlan(ids); onPlan(ids); setMessage('Primer ciclo de la proyección guardado en tu plan.')
    } catch { setMessage('No se pudo guardar. Tu plan anterior se conserva; reintenta.') }
    finally { lock.current = false; setBusy(false); onBusy(false) }
  }
  const close = () => { if (!lock.current) onClose() }
  const results = resources.filter(r => `${r.name} ${r.url}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')))
  if (sort === 'name') results.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const resourceList = <div className="rc-wrap"><h2 className="s-h">Recursos</h2><p className="s-sub">Sitios y herramientas que recomienda la comunidad.</p><section className="blk rc-form"><div className="rc-fh"><span className="rc-me"><OfficialIcon name="link" size={15}/></span><b>Comparte un recurso</b></div><p className="rc-notice" id="rc-unavailable">La publicación de recursos todavía no está habilitada. Puedes buscar y abrir los enlaces disponibles.</p><fieldset disabled aria-describedby="rc-unavailable"><div className="rc-fg"><input className="rc-in" placeholder="Nombre (ej. Notion)" aria-label="Nombre del recurso"/><input className="rc-in" placeholder="Enlace (ej. notion.so)" aria-label="Enlace del recurso"/></div><div className="rc-fr"><input className="rc-in" placeholder="¿Para qué sirve? (opcional)" aria-label="Comentario del recurso"/><button className="mk" type="button">Publicar</button></div></fieldset></section>
    <label className="s-srch rc-srch"><OfficialIcon name="search"/><input type="search" aria-label="Buscar recursos" placeholder="Buscar un recurso o enlace" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button aria-label="Borrar búsqueda" onClick={() => setQuery('')}><OfficialIcon name="close" size={15}/></button>}</label><div className="rc-sorts" role="group" aria-label="Ordenar recursos">{[['recent', 'Recientes'], ['name', 'Nombre A–Z']].map(([id, label]) => <button key={id} className={`r-chip${sort === id ? ' on' : ''}`} aria-pressed={sort === id} onClick={() => setSort(id)}>{label}</button>)}</div>
    {loading ? <p role="status">Cargando recursos…</p> : error ? <div role="alert"><p>{error}</p><button className="h-btn" onClick={() => setAttempt(n => n + 1)}>Reintentar</button></div> : <><p className="rc-meta" role="status">{results.length} {results.length === 1 ? 'recurso' : 'recursos'}{query ? ` para «${query}»` : ' disponibles'}</p><ol className="rc-list">{results.map((r, i) => <li className="rc-item" key={r.id}><span className="rc-rank">{i + 1}</span><span className="rc-logo" aria-hidden="true">{r.name.slice(0, 1).toUpperCase()}</span><div className="rc-content"><h3><a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}<OfficialIcon name="arrow" size={14}/></a></h3><span className="rc-domain">{new URL(r.url).hostname.replace(/^www\./, '')}</span></div><a className="rc-open" href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${r.name}`}><OfficialIcon name="link" size={17}/></a></li>)}</ol>{!results.length && <div className="rc-empty"><OfficialIcon name="search" size={26}/><h3>{resources.length ? 'No encontramos ese recurso' : 'Todavía no hay recursos compartidos'}</h3><p>{resources.length ? 'Prueba con otro nombre o borra la búsqueda.' : 'Los enlaces aparecerán aquí cuando estén disponibles.'}</p>{query && <button className="k-btn" onClick={() => setQuery('')}>Borrar búsqueda</button>}</div>}</>}
  </div>
  return <section className="official-tools">
    {tool === 'Asesor IA' ? <StudyAdvisor embedded={desktop ? 'web' : true} careerName={career.nombre} planCourses={career.cursos.filter(c => plan.includes(c.id)).map(c => ({ id: c.id, name: c.n, credits: c.cr, prerequisites: c.r.map(id => career.cursos.find(c => c.id === id)?.n).filter(Boolean) }))} onClose={close}/> : tool === 'Brújula IA' ? <><p className="b-status" role="status">{busy ? 'Guardando tu plan…' : message}</p>{desktop ? <OfficialRoadmap habitualCredits={preferences.credits} courses={career.cursos} completedIds={done} plan={savedPlan} onAddFirstSemester={savePlan} busy={busy}/> : <SemesterRoadmap embedded habitualCredits={preferences.credits} courses={career.cursos} completedIds={done} onAddFirstSemester={savePlan} onClose={close}/>}</> : desktop ? resourceList : <div className="s-wrap w"><h2 className="s-h">Recursos</h2><p className="s-sub">Enlaces compartidos por la comunidad.</p><label className="s-srch">Buscar<input aria-label="Buscar recursos" value={query} onChange={e => setQuery(e.target.value)}/></label>{loading ? <p role="status">Cargando recursos…</p> : error ? <><p role="alert">{error}</p><button className="h-btn" onClick={() => setAttempt(n => n + 1)}>Reintentar</button></> : <div className="s-grid">{resources.filter(r => r.name.toLowerCase().includes(query.toLowerCase())).map(r => <article className="blk s-card" key={r.id}><h3>{r.name}</h3><a className="h-btn" href={r.url} target="_blank" rel="noopener noreferrer">Abrir recurso</a></article>)}{!resources.length && <p>Todavía no hay recursos compartidos.</p>}{resources.length > 0 && !resources.some(r => r.name.toLowerCase().includes(query.toLowerCase())) && <p>Sin resultados para esta búsqueda.</p>}</div>}</div>}
  </section>
}
export function mountOfficialTools(container, props) { const root = createRoot(container); root.render(<OfficialTools {...props}/>); return () => root.unmount() }


