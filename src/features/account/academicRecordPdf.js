import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { academicRecordModel, academicDate as date, academicNumber as number } from './academicRecordReport.js'
import { REPORT_REGULAR_FONT, REPORT_BOLD_FONT } from './reportFonts.js'

const INK = [17, 17, 19], MUTED = [81, 81, 89], ACCENT = [110, 33, 111]
const eventTypes = { clase: 'Clase', examen: 'Examen', entrega: 'Entrega', estudio: 'Estudio', personal: 'Personal' }
const text = value => String(value ?? 'Sin registrar').normalize('NFC')
const courseName = (model, id) => id ? `${model.courses.get(id)?.n || 'Curso sin catálogo disponible'} (${id})` : 'Sin curso asociado'

export function createAcademicRecordPdf(record, catalog = null) {
  const model = academicRecordModel(record, catalog), { profile, rows } = model
  const setup = record.student_setup?.[0], preferences = setup?.preferences || {}
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true })
  doc.addFileToVFS('LyraReport-Regular.ttf', REPORT_REGULAR_FONT)
  doc.addFont('LyraReport-Regular.ttf', 'LyraReport', 'normal')
  doc.addFileToVFS('LyraReport-Bold.ttf', REPORT_BOLD_FONT)
  doc.addFont('LyraReport-Bold.ttf', 'LyraReport', 'bold')
  doc.setFont('LyraReport', 'normal')
  doc.setLanguage('es-PE')
  doc.setProperties({ title: 'Registro académico - Lyra', author: 'Lyra', creator: 'Lyra', subject: 'Informe académico personal' })
  const margin = 16, width = 178, bottom = 275
  let y = 33
  const ensure = height => { if (y + height > bottom) { doc.addPage(); y = 28 } }
  function paragraph(value, size = 9, color = MUTED) {
    doc.setFont('LyraReport', 'normal'); doc.setFontSize(size); doc.setTextColor(...color)
    const leading = size * 0.45
    for (const line of doc.splitTextToSize(text(value), width)) {
      ensure(leading); doc.text(line, margin, y); y += leading
    }
    y += 3
  }
  function heading(value, size = 13) {
    ensure(24); y += 4
    doc.setFont('LyraReport', 'bold'); doc.setFontSize(size); doc.setTextColor(...INK)
    doc.text(value, margin, y); y += 7
  }
  function table(title, headers, body, widths, empty) {
    if (title) heading(title, 11)
    if (!body.length) { paragraph(empty); return }
    autoTable(doc, {
      startY: y, head: headers.length ? [headers] : undefined, body,
      theme: 'plain', margin: { top: 27, bottom: 22, left: margin, right: margin },
      tableWidth: width, showHead: 'everyPage', rowPageBreak: 'avoid',
      styles: { font: 'LyraReport', fontSize: 8.5, textColor: INK, cellPadding: 2.3, overflow: 'linebreak', valign: 'top', lineColor: [220, 220, 225], lineWidth: { bottom: 0.15 } },
      headStyles: { fontStyle: 'bold', fillColor: [245, 245, 247], textColor: MUTED },
      columnStyles: Object.fromEntries(widths.map((cellWidth, index) => [index, { cellWidth }])),
      didParseCell(data) {
        if (headers[3] === 'Estado' && data.section === 'body' && data.column.index === 3) {
          const label = data.cell.raw
          if (['Aprobado', 'Convalidado'].includes(label)) data.cell.styles.textColor = [35, 99, 62]
          else if (label === 'Matriculado') data.cell.styles.textColor = [34, 77, 152]
          else if (label === 'Desaprobado') data.cell.styles.textColor = [161, 39, 53]
        }
      }
    })
    y = doc.lastAutoTable.finalY + 5
  }
  function fields(entries) {
    table(null, [], entries.map(([label, value]) => [
      { content: label, styles: { textColor: MUTED } }, text(value || 'Sin registrar')
    ]), [43, 135])
  }

  doc.setFont('LyraReport', 'bold'); doc.setFontSize(25); doc.setTextColor(...INK)
  doc.text('Registro académico', margin, y); y += 9
  paragraph('Tu avance, notas y organización académica registrados en Lyra.', 10)
  heading('Datos del estudiante')
  fields([
    ['Nombre', profile.full_name || profile.alias], ['Código de estudiante', profile.student_code],
    ['Carrera', model.catalog?.nombre || profile.carrera],
    ['Universidad', model.catalog?.uni || (profile.institution_id === 'esan' ? 'Universidad ESAN' : null)],
    ['Correo', profile.email], ['Ciclo actual', preferences.semester ? `Ciclo ${preferences.semester}` : null]
  ])
  heading('Resumen académico')
  table(null, ['Cursos llevados', 'Créditos completados', 'Cursos matriculados', 'Ponderado general'], [[
    String(model.completedCount), number(model.completedCredits, Number.isInteger(model.completedCredits) ? 0 : 1),
    String(model.enrolledCount), number(model.weighted, 2)
  ]], [44.5, 44.5, 44.5, 44.5])
  paragraph('Los cursos llevados y sus créditos se toman de tu avance guardado. El ponderado usa las notas de cursos llevados o desaprobados, según sus créditos. Excluye cursos sin nota o sin créditos. Un guion indica que no hay datos suficientes para calcular el valor.', 8)
  heading('Cursos y calificaciones')
  paragraph(model.catalog
    ? `Malla: ${model.catalog.nombre}. Versión: ${model.catalog.version}. El ciclo corresponde a la ubicación del curso en la malla.`
    : 'No está disponible el catálogo de esta carrera o de su versión. Se conservan los identificadores originales, sin asignar nombres ni créditos de otra malla.', 8)
  if (model.catalog && rows.some(row => !model.courses.has(row.id))) {
    paragraph('Algunos cursos no aparecen en esta versión de la malla. Se muestran con su identificador original, sin créditos estimados.', 8)
  }
  table('Registro por curso', ['Ciclo', 'Curso', 'Créditos', 'Estado', 'Nota / 20', 'En mi plan'], rows.map(row => [
    row.cycle === 0 ? 'Pre-formación' : Number.isFinite(row.cycle) ? `Ciclo ${row.cycle}` : '-',
    `${row.name}\n${row.id}`, number(row.credits, Number.isInteger(row.credits) ? 0 : 1), row.label,
    row.grade === null ? 'Sin nota' : number(row.grade, 2), row.planned ? 'Sí' : '-'
  ]), [29, 56, 21, 32, 22, 18], 'Aún no hay cursos con avance, notas o planificación registrados.')
  paragraph('«Sin nota» no equivale a cero. «En mi plan» indica cursos guardados en la planificación. La matrícula se indica en Estado.', 8)
  const details = rows.filter(row => row.times_taken || row.passed_at || row.personal_note)
  if (details.length) table('Historial y comentarios', ['Curso', 'Veces llevado', 'Aprobación', 'Comentario personal'], details.map(row => [
    `${row.name}\n${row.id}`, text(row.times_taken), date(row.passed_at), text(row.personal_note || 'Sin comentario')
  ]), [55, 24, 32, 67])
  heading('Agenda y tareas')
  const events = [...(record.calendar_events || [])].sort((a, b) => String(a.date || a.start_date || '').localeCompare(String(b.date || b.start_date || '')) || String(a.start_time || '').localeCompare(String(b.start_time || '')))
  table('Eventos del calendario', ['Evento', 'Fechas y horario', 'Lugar y curso', 'Repetición'], events.map(event => [
    `${event.title}\n${eventTypes[event.event_type] || event.event_type || 'Personal'}${event.description ? `\n${event.description}` : ''}`,
    `${date(event.date || event.start_date)}${event.end_date && event.end_date !== (event.date || event.start_date) ? ` - ${date(event.end_date)}` : ''}\n${event.start_time ? `${event.start_time.slice(0, 5)} - ${event.end_time?.slice(0, 5) || 'Sin fin'}` : 'Sin hora registrada'}`,
    `${event.location || 'Sin lugar registrado'}\n${courseName(model, event.course_id)}`,
    event.repeat_rule === 'weekly' ? `Semanal${event.repeat_until ? `\nHasta ${date(event.repeat_until)}` : ''}` : event.repeat_rule && event.repeat_rule !== 'none' ? event.repeat_rule : 'Sin repetición'
  ]), [50, 43, 51, 34], 'No hay eventos guardados.')
  const tasks = [...(record.calendar_tasks || [])].sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
  table('Tareas guardadas', ['Tarea', 'Fecha de entrega', 'Estado'], tasks.map(task => [
    text(task.title), date(task.due_date), task.completed ? 'Completada' : 'Pendiente'
  ]), [98, 44, 36], 'No hay tareas guardadas.')
  heading('Preferencias académicas')
  fields([
    ['Créditos objetivo por semestre', preferences.credits == null ? null : number(Number(preferences.credits), Number.isInteger(Number(preferences.credits)) ? 0 : 1)],
    ['Mención', preferences.mention],
    ['Configuración inicial', setup ? setup.completed_at ? `Completada el ${date(setup.completed_at)}` : 'Pendiente de completar' : null]
  ])
  paragraph('Informe personal generado por Lyra a partir de tu información guardada. No constituye un certificado oficial de la universidad.', 8)

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFont('LyraReport', 'bold'); doc.setFontSize(13); doc.setTextColor(...ACCENT)
    doc.text('Lyra', margin, 15)
    doc.setFont('LyraReport', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text(`Exportado el ${date(record.exportedAt, true)} - hora de Lima`, 194, 15, { align: 'right' })
    doc.setDrawColor(220, 220, 225); doc.setLineWidth(0.2); doc.line(margin, 20, 194, 20)
    doc.line(margin, 281, 194, 281)
    doc.text('Registro académico personal', margin, 287)
    doc.text(`Página ${page} de ${pages}`, 194, 287, { align: 'right' })
  }
  return doc
}
