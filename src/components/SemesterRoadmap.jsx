import { useMemo, useState } from 'react'
import '../styles/SemesterRoadmap.css'

const LOADS = [
  { id: 'ligera', label: 'Ligera', credits: 16 },
  { id: 'equilibrada', label: 'Equilibrada', credits: 20 },
  { id: 'intensiva', label: 'Intensiva', credits: 24 }
]

export { projectSemesters } from '../lib/semesterProjection'
import { projectSemesters } from '../lib/semesterProjection'

export default function SemesterRoadmap({ courses, completedIds, onAddFirstSemester, onClose, embedded = false, habitualCredits }) {
  const loads = useMemo(() => Number.isFinite(habitualCredits) && habitualCredits >= 1 && habitualCredits <= 30 ? [{ id: 'habitual', label: 'Tu carga habitual', credits: habitualCredits }, ...LOADS] : LOADS, [habitualCredits])
  const [activeLoad, setActiveLoad] = useState(habitualCredits ? 'habitual' : 'equilibrada')
  const projections = useMemo(() => Object.fromEntries(
    loads.map(load => [load.id, { ...load, ...projectSemesters(courses, completedIds, load.credits) }])
  ), [courses, completedIds, loads])
  const selected = projections[activeLoad]
  const totalCreditsLeft = courses
    .filter(course => !completedIds.includes(course.id))
    .reduce((total, course) => total + course.cr, 0)

  return (
    <div className="roadmap-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="roadmap-modal" role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-labelledby="roadmap-title">
        <header className="roadmap-head">
          <div>
            <span className="roadmap-kicker">PLANIFICACIÓN · PROYECCIÓN</span>
            <h2 id="roadmap-title">Compara tu ruta de ciclos</h2>
          </div>
          <button className="roadmap-close" onClick={onClose} aria-label="Cerrar proyección">×</button>
        </header>

        <div className="roadmap-loads" role="tablist" aria-label="Carga máxima por ciclo">
          {loads.map(load => {
            const result = projections[load.id]
            return (
              <button
                key={load.id}
                className={activeLoad === load.id ? 'active' : ''}
                onClick={() => setActiveLoad(load.id)}
                role="tab"
                aria-selected={activeLoad === load.id}
              >
                <span>{load.label}</span>
                <b>≈ {load.credits} créd/ciclo</b>
                <small>{result.semesters.length} ciclos</small>
              </button>
            )
          })}
        </div>

        <div className="roadmap-content">
          <div className="roadmap-note">
            Proyección basada en prerrequisitos, créditos aprobados y tope aproximado de créditos. Los cursos con requisito de créditos se ubican en ciclos posteriores; no representa una matrícula oficial.
          </div>
          <div className="roadmap-list">
            {selected.semesters.slice(0, 12).map(semester => (
              <section className="roadmap-term" key={semester.number}>
                <header>
                  <b>Ciclo proyectado {semester.number}</b>
                  <span>{semester.credits} créd · {semester.courses.length} cursos</span>
                </header>
                <ul>
                  {semester.courses.map(course => (
                    <li key={course.id}>
                      <span>{course.n}</span>
                      <small>{course.cr} créd</small>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {selected.semesters.length === 0 && (
              <div className="roadmap-empty">Ya completaste los cursos de esta malla.</div>
            )}
            {selected.remaining > 0 && (
              <div className="roadmap-empty">
                {selected.remaining} cursos no se pudieron ubicar con los datos actuales de requisitos.
              </div>
            )}
            {selected.semesters.length > 12 && (
              <div className="roadmap-empty">Mostrando los primeros 12 ciclos de la proyección.</div>
            )}
          </div>
        </div>

        <footer className="roadmap-footer">
          <span>{totalCreditsLeft} créditos pendientes · {selected.semesters.length} ciclos estimados</span>
          {selected.semesters[0] && (
            <button onClick={() => onAddFirstSemester(selected.semesters[0].courses.map(course => course.id))}>
              Sumar primer ciclo al plan
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
