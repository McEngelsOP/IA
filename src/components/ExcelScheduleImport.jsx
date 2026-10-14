import { useEffect, useRef, useState } from 'react'
import { MAX_EXCEL_BYTES, WEEKDAYS, compactSheet, parseSchedule, validateSemester, validateClass, classEvent, eventSignature, conflictingClasses } from '../lib/scheduleImport.mjs'

export default function ExcelScheduleImport({ client, user, events, disabled, onBusy, onSaved }) {
  const [open, setOpen] = useState(false), [sheets, setSheets] = useState([]), [sheet, setSheet] = useState('')
  const [rows, setRows] = useState(null), [start, setStart] = useState(''), [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const file = useRef(null), input = useRef(null), alive = useRef(true), lock = useRef(false), request = useRef(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false; file.current = null; request.current?.abort() } }, [])
  const update = (index, key, value) => setRows(old => old.map((r, i) => i === index ? { ...r, [key]: value } : r))
  function clear() { file.current = null; if (input.current) input.current.value = ''; setSheets([]); setSheet(''); setRows(null); setStart(''); setEnd(''); setError('') }
  function begin() { lock.current = true; setBusy(true); onBusy(true); setError(''); setMessage('') }
  function finish() { lock.current = false; onBusy(false); if (alive.current) setBusy(false) }
  async function choose(e) {
    const selected = e.target.files?.[0]; clear(); if (!selected) return
    if (!/\.xlsx$/i.test(selected.name) || !selected.size || selected.size > MAX_EXCEL_BYTES) { setError('Solo Excel .xlsx, hasta 2 MB. No se admiten CSV, PDF, imágenes ni archivos con macros.'); return }
    begin()
    try {
      const signature = new Uint8Array(await selected.slice(0, 4).arrayBuffer())
      if (signature[0] !== 80 || signature[1] !== 75 || signature[2] !== 3 || signature[3] !== 4) throw new Error('El archivo no es un Excel .xlsx válido.')
      const { readSheetNames } = await import('read-excel-file')
      const names = await readSheetNames(selected)
      if (!names.length || names.length > 20) throw new Error('Usa un Excel de horario con un máximo de 20 hojas.')
      if (alive.current) { file.current = selected; setSheets(names); setSheet(names[0]) }
    } catch (e) { if (alive.current) setError(e.message || 'No se pudo leer el Excel. Revisa el archivo.') }
    finally { finish() }
  }
  async function analyze(e) {
    e.preventDefault(); if (lock.current || !file.current) return
    begin(); request.current = new AbortController()
    const timeout = setTimeout(() => request.current?.abort(), 55000)
    try {
      const { default: readExcel } = await import('read-excel-file')
      const text = compactSheet(await readExcel(file.current, { sheet }))
      if (!alive.current) return
      const result = await client.functions.invoke('excel-schedule', { body: { text }, signal: request.current.signal })
      if (result.error) {
        let message = 'No pudimos interpretar el horario. Reintenta o utiliza Crear evento.'
        try { message = (await result.error.context.json()).message || message } catch {}
        throw new Error(message)
      }
      const data = parseSchedule(JSON.stringify(result.data))
      if (!data.classes.length) throw new Error('No se encontraron clases con día y horas claros. Revisa la hoja seleccionada.')
      if (alive.current) {
        setRows(data.classes.map(r => ({ ...r, id: crypto.randomUUID(), selected: true }))); setStart(data.semester_start); setEnd(data.semester_end)
        file.current = null; if (input.current) input.current.value = ''; setSheets([])
      }
    } catch (e) { if (alive.current) setError(e.name === 'AbortError' ? 'La IA tardó demasiado. Reintenta.' : e.message) }
    finally { clearTimeout(timeout); finish() }
  }
  async function save(e) {
    e.preventDefault(); if (lock.current) return
    const chosen = rows.filter(r => r.selected)
    const issue = validateSemester(start, end) || (!chosen.length ? 'Selecciona al menos una clase.' : chosen.map(validateClass).find(Boolean))
    if (issue) { setError(issue); return }
    let payload
    try {
      const seen = new Set(events.map(eventSignature))
      payload = chosen.map(r => ({ ...classEvent(r, start, end), id: r.id, student_id: user.id })).filter(r => { const key = eventSignature(r); if (seen.has(key)) return false; seen.add(key); return true })
    } catch (e) { setError(e.message); return }
    if (!payload.length) { clear(); setMessage('Estas clases ya estaban en tu calendario. No se añadieron duplicados.'); return }
    begin()
    try {
      const auth = await client.auth.getUser()
      if (auth.error || auth.data.user?.id !== user.id) throw new Error('session')
      // IDs estables: una respuesta perdida se puede reintentar sin duplicar la importación.
      const result = await client.from('calendar_events').upsert(payload, { onConflict: 'id' }).select('id,student_id,title,date,start_date,end_date,event_type,start_time,end_time,location,repeat_rule,repeat_until,color')
      if (result.error || result.data?.length !== payload.length) throw new Error('save')
      if (alive.current) { onSaved(result.data); clear(); setMessage(`${result.data.length} clases guardadas hasta el ${end}. El archivo y la vista previa se descartaron.`) }
    } catch { if (alive.current) setError('No se pudo guardar. Reintenta: las propuestas siguen disponibles mientras mantengas este calendario abierto.') }
    finally { finish() }
  }
  const selected = rows?.filter(r => r.selected) || []
  return <section className="blk sc-text-tasks sc-excel" aria-label="Importar horario de Excel">
    <button type="button" className="h-btn" disabled={busy || disabled} aria-expanded={open} onClick={() => { if (open) clear(); setOpen(!open) }}>Importar horario de Excel</button>
    {open && <>
      <h2 className="bt">Tu horario para todo el semestre</h2>
      <p>Selecciona un Excel .xlsx y revisa las clases antes de añadirlas. Solo se guardarán las clases confirmadas, con repetición semanal.</p>
      {!rows && <form onSubmit={analyze}><fieldset disabled={busy || disabled}>
        <label>Excel del horario<input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={choose}/></label>
        <small>Hasta 2 MB. Usa una hoja solo con tu horario: curso, día, hora de inicio y fin, y aula opcional. El archivo no se sube ni se conserva; las celdas de la hoja elegida se envían al proveedor de IA disponible.</small>
        {sheets.length > 0 && <label>Hoja a interpretar<select value={sheet} onChange={e => setSheet(e.target.value)}>{sheets.map(s => <option key={s}>{s}</option>)}</select></label>}
        <button className="mk" type="submit" disabled={!sheets.length}>{busy ? 'Interpretando…' : 'Interpretar con IA'}</button>
      </fieldset></form>}
      {rows && <form onSubmit={save}><fieldset disabled={busy || disabled}>
        <h3>Revisa las clases y el semestre</h3><p>Confirma las fechas del semestre. Si no aparecen en el Excel, complétalas aquí. Hora de Lima.</p>
        <div className="sc-proposals"><label>Inicio del semestre<input type="date" required value={start} onChange={e => setStart(e.target.value)}/></label><label>Fin del semestre<input type="date" required min={start} value={end} onChange={e => setEnd(e.target.value)}/></label></div>
        <div className="sc-proposals">{rows.map((r, i) => <div className="sc-task-proposal" key={r.id}>
          <label className="sc-check"><input type="checkbox" checked={r.selected} onChange={e => update(i, 'selected', e.target.checked)}/>Incluir clase {i + 1}</label>
          <label>Curso<input required={r.selected} maxLength={160} value={r.title} onChange={e => update(i, 'title', e.target.value)}/></label>
          <label>Día<select value={r.weekday} onChange={e => update(i, 'weekday', Number(e.target.value))}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
          <div className="sc-time"><label>Inicio<input type="time" required={r.selected} value={r.start_time} onChange={e => update(i, 'start_time', e.target.value)}/></label><label>Fin<input type="time" required={r.selected} value={r.end_time} onChange={e => update(i, 'end_time', e.target.value)}/></label></div>
          <label>Aula o lugar<input maxLength={160} value={r.location} onChange={e => update(i, 'location', e.target.value)}/></label>
        </div>)}</div>
        {conflictingClasses(selected) && <p role="status">Hay clases que se superponen. Revisa sus horas antes de confirmar.</p>}
        <p>{selected.length} clases seleccionadas · Se repetirán cada semana hasta el fin del semestre, incluidos feriados. Puedes editar o eliminar cada serie desde el calendario.</p>
        <div className="sc-actions"><button className="mk" type="submit">{busy ? 'Guardando…' : 'Añadir al calendario'}</button><button className="h-btn" type="button" onClick={clear}>Descartar</button></div>
      </fieldset></form>}
    </>}
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{message}</p>
  </section>
}
