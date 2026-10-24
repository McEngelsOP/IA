export const academicNumber = (value, digits = 0) => Number.isFinite(value) ? value.toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '-'
export const academicDate = (value, withTime = false) => {
  if (!value) return 'Sin registrar'
  // A date without a time is a calendar day, not midnight UTC.
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-05:00` : value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('es-PE', {
    timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  })
}
const statuses = { aprobado: 'Aprobado', convalidado: 'Convalidado', matriculado: 'Matriculado', desaprobado: 'Desaprobado' }

export function academicRecordModel(record, catalog) {
  const profile = record.profiles?.[0] || {}
  // Never attach another career or a newer curriculum to a historical record.
  const matched = catalog?.key === profile.carrera && (!profile.curriculum_version || catalog.version === profile.curriculum_version) ? catalog : null
  const courses = new Map((matched?.cursos || []).map(course => [course.id, course]))
  const done = new Set((record.progress || []).flatMap(row => row.done || []))
  const plan = new Set((record.progress || []).flatMap(row => row.plan || []))
  const grades = new Map((record.grades || []).map(row => [row.course_id, row.grade]))
  const states = new Map((record.course_status || []).map(row => [row.course_id, row]))
  const ids = new Set([...done, ...plan, ...grades.keys(), ...states.keys()])
  const rows = [...ids].map(id => {
    const course = courses.get(id), state = states.get(id) || {}, rawGrade = grades.get(id)
    const grade = rawGrade !== null && rawGrade !== undefined && rawGrade !== '' && Number.isFinite(Number(rawGrade)) && Number(rawGrade) >= 0 && Number(rawGrade) <= 20 ? Number(rawGrade) : null
    return { id, name: course?.n || 'Curso sin catálogo disponible', cycle: course?.c, credits: course?.cr,
      completed: done.has(id), planned: plan.has(id), grade, ...state,
      label: statuses[state.status] || (done.has(id) ? 'Llevado' : 'Sin estado registrado') }
  }).sort((a, b) => (a.cycle ?? Infinity) - (b.cycle ?? Infinity) || a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id, 'es'))
  const completed = rows.filter(row => row.completed)
  const graded = rows.filter(row => row.grade !== null && (row.completed || row.status === 'desaprobado'))
  const weighted = graded.filter(row => row.credits > 0)
  const gradedCredits = weighted.reduce((sum, row) => sum + row.credits, 0)
  const knownCredits = completed.every(row => Number.isFinite(row.credits))
  return { profile, catalog: matched, courses, rows,
    completedCount: completed.length,
    completedCredits: knownCredits ? completed.reduce((sum, row) => sum + row.credits, 0) : null,
    enrolledCount: rows.filter(row => row.status === 'matriculado' && !row.completed).length,
    weighted: gradedCredits && graded.every(row => Number.isFinite(row.credits)) ? weighted.reduce((sum, row) => sum + row.grade * row.credits, 0) / gradedCredits : null }
}
