import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import StudyAdvisor from './StudyAdvisor'
import SemesterRoadmap from './SemesterRoadmap'
import '../styles/OfficialTools.css'
import '../styles/OfficialSurfaces.css'
import OfficialRoadmap from './OfficialRoadmap'
import ResourceDirectory from './ResourceDirectory'
import useMediaQuery from '../lib/useMediaQuery'
function OfficialTools({ tool, client, user, career, preferences = {}, done, plan, onClose, onPlan, onBusy }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), lock = useRef(false), currentPlan = useRef(plan)
  const [savedPlan, setSavedPlan] = useState(plan)
  const desktop = useMediaQuery('(min-width: 861px)')
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
  return <section className="official-tools">
    {tool === 'Asesor IA' ? <StudyAdvisor embedded={desktop ? 'web' : true} careerName={career.nombre} planCourses={career.cursos.filter(c => plan.includes(c.id)).map(c => ({ id: c.id, name: c.n, credits: c.cr, prerequisites: c.r.map(id => career.cursos.find(c => c.id === id)?.n).filter(Boolean) }))} onClose={close}/> : tool === 'Brújula IA' ? <><p className="b-status" role="status">{busy ? 'Guardando tu plan…' : message}</p>{desktop ? <OfficialRoadmap habitualCredits={preferences.credits} courses={career.cursos} completedIds={done} plan={savedPlan} onAddFirstSemester={savePlan} busy={busy}/> : <SemesterRoadmap embedded habitualCredits={preferences.credits} courses={career.cursos} completedIds={done} onAddFirstSemester={savePlan} onClose={close}/>}</> : <ResourceDirectory client={client} user={user} onBusy={onBusy}/>}
  </section>
}
export function mountOfficialTools(container, props) { const root = createRoot(container); root.render(<OfficialTools {...props}/>); return () => root.unmount() }



