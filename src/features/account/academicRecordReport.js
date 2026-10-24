const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const number = (value, digits = 0) => Number.isFinite(value) ? value.toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—'
const date = (value, withTime = false) => {
  if (!value) return 'Sin registrar'
  // A date without a time is a calendar day, not midnight UTC.
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-05:00` : value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('es-PE', {
    timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  })
}
const statuses = { aprobado: 'Aprobado', convalidado: 'Convalidado', matriculado: 'Matriculado', desaprobado: 'Desaprobado' }
const eventTypes = { clase: 'Clase', examen: 'Examen', entrega: 'Entrega', estudio: 'Estudio', personal: 'Personal' }

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

function table(title, headers, rows, empty, kind = '') {
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${escape(title)}"><table class="${escape(kind)}"><caption>${escape(title)}</caption><thead><tr>${headers.map(header => `<th scope="col">${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="muted">${escape(empty)}</td></tr>`}</tbody></table></div>`
}
const field = (label, value) => `<div><dt>${escape(label)}</dt><dd>${escape(value || 'Sin registrar')}</dd></div>`
const courseName = (model, id) => id ? `${model.courses.get(id)?.n || 'Curso sin catálogo disponible'} (${id})` : 'Sin curso asociado'

export function renderAcademicRecord(record, catalog = null) {
  const model = academicRecordModel(record, catalog), { profile, rows } = model
  const setup = record.student_setup?.[0], preferences = setup?.preferences || {}
  const courseRows = rows.map(row => [
    row.cycle === 0 ? 'Pre-formación' : Number.isFinite(row.cycle) ? `Ciclo ${row.cycle}` : '—',
    `<strong>${escape(row.name)}</strong><small>${escape(row.id)}</small>`,
    number(row.credits, Number.isInteger(row.credits) ? 0 : 1),
    `<span class="state ${Object.hasOwn(statuses, row.status) ? row.status : ''}">${escape(row.label)}</span>`,
    row.grade === null ? 'Sin nota' : `<strong class="numeric">${number(row.grade, 2)}</strong>`,
    row.planned ? 'Sí' : '—'
  ])
  const details = rows.filter(row => row.times_taken || row.passed_at || row.personal_note).map(row => [
    `${escape(row.name)}<small>${escape(row.id)}</small>`, escape(row.times_taken ?? 'Sin registrar'), escape(date(row.passed_at)), escape(row.personal_note || 'Sin comentario')
  ])
  const events = [...(record.calendar_events || [])].sort((a, b) => String(a.date || a.start_date || '').localeCompare(String(b.date || b.start_date || '')) || String(a.start_time || '').localeCompare(String(b.start_time || '')))
  const tasks = [...(record.calendar_tasks || [])].sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
  const serialized = JSON.stringify(record, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><title>Registro académico · ${escape(profile.full_name || profile.alias || 'Lyra')}</title>
<style>
:root{color-scheme:light;--ink:#111113;--muted:#515159;--line:#dcdce1;--paper:#fff;--page:#f5f5f5;--accent:#6e216f}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif}
::selection{background:#f1d5f1;color:var(--ink)}.sheet{max-width:1080px;margin:32px auto;padding:48px;background:var(--paper)}
.brand{font-size:20px;font-weight:750;color:var(--accent)}.masthead{display:flex;justify-content:space-between;gap:20px;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:20px}.masthead p{margin:0}
h1{font-size:clamp(28px,4vw,38px);line-height:1.15;letter-spacing:-.025em;margin:32px 0 12px}h2{font-size:23px;line-height:1.25;margin:0 0 14px}p{max-width:72ch;margin:12px 0}.muted,small,dt{color:var(--muted)}small{display:block;font-size:13px;margin-top:3px;overflow-wrap:anywhere}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}.actions button{font:inherit;font-weight:600;border:1px solid var(--ink);border-radius:10px;background:var(--paper);color:var(--ink);padding:10px 16px;cursor:pointer}.actions button:first-child{background:var(--ink);color:var(--paper)}.actions button:hover{background:#ebebee;color:var(--ink)}:focus-visible{outline:3px solid var(--accent);outline-offset:4px}
section{margin-top:36px}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 32px;margin:0}dt{font-size:14px}dd{margin:2px 0 0;font-weight:600;overflow-wrap:anywhere}.summary{grid-template-columns:repeat(4,minmax(0,1fr));padding:18px 0;border-block:1px solid var(--line)}.summary dd{font-size:23px;font-variant-numeric:tabular-nums}
.table-wrap{overflow-x:auto;scrollbar-color:#8b8b95 var(--page)}table{width:100%;border-collapse:collapse;font-size:14px;text-align:left}caption{text-align:left;font-size:16px;font-weight:650;padding:18px 0 10px}th{background:var(--page);font-weight:650;white-space:nowrap}th,td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}td{overflow-wrap:anywhere;min-width:75px}td:nth-child(2){min-width:170px}td strong{font-weight:600}.numeric{font-variant-numeric:tabular-nums;white-space:nowrap}.state{font-weight:600}.aprobado,.convalidado{color:#23633e}.matriculado{color:#224d98}.desaprobado{color:#a12735}
.note{font-size:14px;color:var(--muted)}footer{border-top:1px solid var(--line);margin-top:40px;padding-top:18px;font-size:13px;color:var(--muted)}.preserve{white-space:pre-wrap}
@media(max-width:700px){.sheet{margin:0;padding:24px 18px}.masthead{display:block}.masthead p{margin-top:6px;font-size:14px}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}dl{grid-template-columns:1fr}.actions button{flex:1 1 220px}}
@page{size:A4;margin:15mm}
@media print{body{background:#fff;font-size:10pt}.sheet{max-width:none;margin:0;padding:0}.actions,.screen-only{display:none!important}.masthead{display:flex}h1{font-size:26pt;margin-top:22px}h2{font-size:16pt;break-after:avoid}section{margin-top:24px}dl{grid-template-columns:repeat(2,minmax(0,1fr))}.summary{grid-template-columns:repeat(4,minmax(0,1fr))}.summary dd{font-size:16pt}.table-wrap{overflow:visible}table{font-size:9pt;table-layout:fixed}th{white-space:normal}th,td{min-width:0!important;padding:7px 5px}thead{display:table-header-group}tr{break-inside:avoid}caption{break-after:avoid}small,.note,footer,dt{font-size:8.5pt}.state{color:inherit}}
@media print{.course-table th:nth-child(1){width:14%}.course-table th:nth-child(2){width:30%}.course-table th:nth-child(3){width:10%}.course-table th:nth-child(4){width:18%}.course-table th:nth-child(5){width:14%}.course-table th:nth-child(6){width:14%}}
</style></head><body><main class="sheet">
<header><div class="masthead"><span class="brand">Lyra</span><p class="muted">Exportado el ${escape(date(record.exportedAt, true))} · hora de Lima</p></div>
<h1>Registro académico</h1><p class="muted">Tu avance, notas y organización académica registrados en Lyra.</p>
<div class="actions"><button id="print" type="button">Imprimir / Guardar como PDF</button><button id="backup" type="button">Descargar respaldo de datos (JSON)</button></div>
<p class="note screen-only">Este archivo se puede consultar sin conexión. Para obtener un PDF, pulsa «Imprimir / Guardar como PDF» y elige «Guardar como PDF» en el destino de impresión.</p>
<noscript><p>Para guardar como PDF, utiliza la opción Imprimir del navegador.</p></noscript></header>
<section aria-labelledby="student"><h2 id="student">Datos del estudiante</h2><dl>
${field('Nombre', profile.full_name || profile.alias)}${field('Código de estudiante', profile.student_code)}${field('Carrera', model.catalog?.nombre || profile.carrera)}${field('Universidad', model.catalog?.uni || (profile.institution_id === 'esan' ? 'Universidad ESAN' : null))}${field('Correo', profile.email)}${field('Ciclo actual', preferences.semester ? `Ciclo ${preferences.semester}` : null)}
</dl></section>
<section aria-labelledby="overview"><h2 id="overview">Resumen académico</h2><dl class="summary">
${field('Cursos llevados', String(model.completedCount))}${field('Créditos completados', number(model.completedCredits, Number.isInteger(model.completedCredits) ? 0 : 1))}${field('Cursos matriculados', String(model.enrolledCount))}${field('Ponderado general', number(model.weighted, 2))}
</dl><p class="note">Los cursos llevados y sus créditos se toman de tu avance guardado. El ponderado usa las notas de cursos llevados o desaprobados, según sus créditos; excluye cursos sin nota o sin créditos. «—» indica que no hay datos suficientes para calcular el valor.</p></section>
<section aria-labelledby="courses"><h2 id="courses">Cursos y calificaciones</h2>
${!model.catalog ? '<p class="note">No está disponible el catálogo de esta carrera o de su versión. Se conservan los identificadores originales; no se asignan nombres ni créditos de otra malla.</p>' : `<p class="note">Malla de referencia: ${escape(model.catalog.nombre)} · versión ${escape(model.catalog.version)}. Se muestran los cursos con información guardada. El ciclo corresponde a su ubicación en la malla.</p>`}
${rows.some(row => !model.courses.has(row.id)) && model.catalog ? '<p class="note">Algunos cursos no aparecen en esta versión de la malla. Se muestran con su identificador original y sin créditos estimados.</p>' : ''}
${table('Registro por curso', ['Ciclo', 'Curso', 'Créditos', 'Estado', 'Nota / 20', 'En mi plan'], courseRows, 'Aún no hay cursos con avance, notas o planificación registrados.', 'course-table')}
<p class="note">«Sin nota» no equivale a cero. «En mi plan» identifica cursos guardados en la planificación; la matrícula se indica en la columna Estado.</p>
${details.length ? table('Detalle del historial y comentarios', ['Curso', 'Veces llevado', 'Fecha de aprobación', 'Comentario personal'], details, '') : ''}
</section>
<section aria-labelledby="agenda"><h2 id="agenda">Agenda y tareas</h2>
${table('Eventos del calendario', ['Evento', 'Fechas y horario', 'Lugar y curso', 'Repetición'], events.map(event => [
  `<strong>${escape(event.title)}</strong><small>${escape(eventTypes[event.event_type] || event.event_type || 'Personal')}</small>${event.description ? `<p class="preserve">${escape(event.description)}</p>` : ''}`,
  `${escape(date(event.date || event.start_date))}${event.end_date && event.end_date !== (event.date || event.start_date) ? ` — ${escape(date(event.end_date))}` : ''}<small>${event.start_time ? `${escape(event.start_time.slice(0, 5))} — ${escape(event.end_time?.slice(0, 5) || 'Sin fin')}` : 'Sin hora registrada'}</small>`,
  `${escape(event.location || 'Sin lugar registrado')}<small>${escape(courseName(model, event.course_id))}</small>`,
  event.repeat_rule === 'weekly' ? `Semanal${event.repeat_until ? `<small>Hasta ${escape(date(event.repeat_until))}</small>` : ''}` : escape(event.repeat_rule && event.repeat_rule !== 'none' ? event.repeat_rule : 'Sin repetición')
]), 'No hay eventos guardados.')}
${table('Tareas guardadas', ['Tarea', 'Fecha de entrega', 'Estado'], tasks.map(task => [escape(task.title), escape(date(task.due_date)), task.completed ? 'Completada' : 'Pendiente']), 'No hay tareas guardadas.')}
</section>
<section aria-labelledby="preferences"><h2 id="preferences">Preferencias académicas</h2><dl>${field('Créditos objetivo por semestre', preferences.credits == null ? null : number(Number(preferences.credits), Number.isInteger(Number(preferences.credits)) ? 0 : 1))}${field('Mención', preferences.mention)}${field('Configuración inicial', setup ? setup.completed_at ? `Completada el ${date(setup.completed_at)}` : 'Pendiente de completar' : null)}</dl></section>
<footer><p>Informe personal generado por Lyra a partir de tu información guardada. No constituye un certificado oficial de la universidad.</p><p class="screen-only">El respaldo JSON incluido conserva todos los campos originales de esta exportación, incluidos los borradores y las preferencias.</p></footer>
</main><script type="application/json" id="academic-record-data">${serialized}</script>
<script>
document.getElementById('print').addEventListener('click', function () { window.print() });
document.getElementById('backup').addEventListener('click', function () {
  var data = document.getElementById('academic-record-data').textContent;
  var url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }));
  var link = document.createElement('a'); link.href = url; link.download = 'lyra-registro-academico-respaldo.json';
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url) }, 1000);
});
</script></body></html>`
}
