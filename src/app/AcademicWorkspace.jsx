import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import StudyAdvisor from '../features/assistant/StudyAdvisor.jsx'
import './AcademicWorkspace.css'
import '../shared/styles/OfficialSurfaces.css'
import OfficialRoadmap from '../features/planning/OfficialRoadmap.jsx'
import ResourceDirectory from '../features/resources/ResourceDirectory.jsx'
import { buildMalla, validPlan, enrolledIds } from '../core/academic/curriculumGraph.js'
function AcademicWorkspace({ tool, client, user, career, preferences = {}, statuses = {}, done, plan, onClose, onPlan, onBusy }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), lock = useRef(false), currentPlan = useRef(plan)
  const [savedPlan, setSavedPlan] = useState(plan)
  async function savePlan(courses) {
    if (lock.current) return
    lock.current = true; setBusy(true); onBusy(true); setMessage('')
    try {
      const verified = await client.auth.getUser()
      if (verified.error || verified.data.user?.id !== user.id) throw new Error('session')
      let ids = [...validPlan(buildMalla(career), new Set([...currentPlan.current, ...courses]), new Set(done), statuses)]
      const { data, error } = await client.rpc('save_academic_plan', { p_plan: ids })
      if (error) throw error
      ids = data.plan
      currentPlan.current = ids; setSavedPlan(ids); onPlan(ids); setMessage('Primer ciclo de la proyección guardado en tu plan.'); return true
    } catch { setMessage('No se pudo guardar. Tu plan anterior se conserva; reintenta.'); return false }
    finally { lock.current = false; setBusy(false); onBusy(false) }
  }
  const close = () => { if (!lock.current) onClose() }
  return <section className="official-tools">
    {tool === 'Asesor IA' ? <StudyAdvisor key={user.id} userId={user.id} client={client} embedded="web" careerId={career.key} careerVersion={career.version} enrolledCourseIds={[...enrolledIds(statuses)]} currentSemester={preferences.semester} completedCredits={career.cursos.filter(c => done.includes(c.id)).reduce((sum,c) => sum+c.cr,0)} careerName={career.nombre} planCourses={career.cursos.filter(c => plan.includes(c.id) && !done.includes(c.id) && statuses[c.id]?.status !== 'matriculado').map(c => ({ id: c.id, name: c.n, credits: c.cr, prerequisites: c.r.map(id => ({id, name: career.cursos.find(c => c.id === id)?.n || id, completed: done.includes(id)})), requirementNote: c.requirementNote || '', requiredCompletedCredits: c.rc || 0 }))} onClose={close}/> : tool === 'Brújula IA' ? <><p className="b-status" role="status">{busy ? 'Guardando tu plan…' : message}</p><OfficialRoadmap inProgressIds={[...enrolledIds(statuses)]} currentSemester={preferences.semester} habitualCredits={preferences.credits} courses={career.cursos} completedIds={done} plan={savedPlan} onEditPlan={() => onClose('Mi carrera')} onAddFirstSemester={savePlan} busy={busy}/></> : <ResourceDirectory client={client} user={user} onBusy={onBusy}/>}
  </section>
}
export function mountAcademicWorkspace(container, props) { const root = createRoot(container); root.render(<AcademicWorkspace {...props}/>); return () => root.unmount() }

