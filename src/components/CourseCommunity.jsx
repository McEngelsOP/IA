import { useEffect, useRef, useState } from 'react'
const TAGS = [['estricto-bueno', 'Estricto para bien'], ['estricto-mal', 'Estricto para mal'], ['relajo', 'Pasar de modo chill'], ['fija', 'Esta es fija'], ['aprender', 'Para aprender'], ['balance', 'Exige y acompaña'], ['didactico', 'Explica con ejemplos'], ['evaluaciones-claras', 'Evaluaciones claras'], ['pasa', 'Pasa por pasar']]
function Star({ filled }) { return <svg width="24" height="24" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 2 3 6.5 7 .9-5.1 5 1.3 7-6.2-3.4-6.2 3.4 1.3-7-5.1-5 7-.9Z"/></svg> }
export default function CourseCommunity({ course, client, user, onBusy }) {
  const [rating, setRating] = useState(null), [stats, setStats] = useState({ avg_rating: 0, total_votes: 0 }), [professors, setProfessors] = useState([])
  const [name, setName] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0)
  const lock = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true
    if (!client || !user) { setLoading(false); return }
    setLoading(true); setError('')
    Promise.all([client.rpc('get_course_difficulty_stats', { cid: course.id }), client.from('professors').select('id,name,professor_tags(tag,student_id)').eq('course_id', course.id).order('name').limit(100)]).then(([s, p]) => {
      if (!current) return
      if (s.error || p.error) throw new Error('read')
      setStats(s.data || { avg_rating: 0, total_votes: 0 }); setRating(s.data?.user_rating || null); setProfessors(p.data || [])
    }).catch(() => { if (current) setError('No se pudieron cargar las valoraciones y profesores. Reintenta.') }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [client, user?.id, course.id, retry])
  async function mutate(work, success) {
    if (lock.current) return
    if (!user || !client) { setError('Inicia sesión para añadir profesores y compartir tu valoración.'); return }
    lock.current = true; setBusy(true); onBusy(true); setError(''); setNotice('')
    try {
      const verified = await client.auth.getUser()
      if (verified.error || verified.data.user?.id !== user.id) throw new Error('NO_AUTH')
      const r = await work(); if (r.error) throw r.error
      if (alive.current) { setNotice(success); setRetry(v => v + 1) }
      return true
    } catch (e) { if (alive.current) setError(e.code === '23505' ? 'Ese profesor ya figura en este curso.' : e.message?.includes('TAG_LIMIT') ? 'Elige hasta tres etiquetas por profesor; desmarca una para cambiarla.' : 'No se pudo guardar. Tu valoración anterior se conserva; reintenta.') }
    finally { lock.current = false; onBusy(false); if (alive.current) setBusy(false) }
  }
  async function addProfessor(e) { e.preventDefault(); if (name.trim().length < 2) return; if (await mutate(() => client.from('professors').insert({ course_id: course.id, name: name.trim().toLocaleUpperCase('es'), created_by: user.id }), 'Profesor añadido. Ya está disponible para la comunidad.')) { if (alive.current) setName('') } }
  function vote(value) { mutate(() => client.from('course_difficulty_votes').upsert({ course_id: course.id, student_id: user.id, rating: value, updated_at: new Date().toISOString() }, { onConflict: 'course_id,student_id' }), 'Dificultad guardada.') }
  function toggleTag(professor, tag, checked) {
    mutate(() => checked ? client.from('professor_tags').delete().match({ professor_id: professor.id, student_id: user.id, tag }) : client.from('professor_tags').insert({ professor_id: professor.id, student_id: user.id, tag }), 'Etiquetas actualizadas.')
  }
  return <div className="oc-community"><h4>Dificultad del curso</h4><p>Más estrellas significan mayor dificultad. Cada estudiante registra su propia valoración.</p>
    {!user && <p>Inicia sesión para consultar las valoraciones de la comunidad y guardar la tuya.</p>}
    <fieldset className="oc-stars" disabled={busy || loading || !user}><legend>Tu valoración de dificultad</legend>{[1, 2, 3, 4, 5].map(value => <label key={value} className={value <= rating ? 'selected' : ''}><input type="radio" name={`difficulty-${course.id}`} value={value} checked={rating === value} onChange={() => vote(value)}/><Star filled={value <= rating}/><span className="oc-sr">{value} de 5 estrellas</span></label>)}</fieldset>
    {stats.total_votes > 0 ? <p>Promedio de la comunidad: <strong>{stats.avg_rating} / 5</strong> · {stats.total_votes} {stats.total_votes === 1 ? 'valoración' : 'valoraciones'}.</p> : <p>Aún no hay valoraciones para este curso.</p>}
    <h4>Profesores del curso</h4><form className="oc-professor-form" onSubmit={addProfessor}><label>Añadir profesor<input required minLength={2} maxLength={80} value={name} disabled={busy || !user} placeholder="Nombre y apellido" onChange={e => setName(e.target.value)}/></label><button type="submit" className="oc-primary" disabled={busy || !user}>Añadir profesor</button></form>
    {loading ? <p role="status">Cargando profesores y valoraciones…</p> : <>{!professors.length && <p>Todavía no hay profesores registrados. Puedes añadir el primero.</p>}<ul className="oc-professors">{professors.map(p => {
      const mine = new Set((p.professor_tags || []).filter(t => t.student_id === user?.id).map(t => t.tag)), counts = (p.professor_tags || []).reduce((a, t) => ({ ...a, [t.tag]: (a[t.tag] || 0) + 1 }), {})
      return <li key={p.id}><h5>{p.name}</h5><fieldset className="oc-professor-tags" disabled={busy || !user}><legend>¿Qué tipo de profesor es? Marca hasta tres opciones.</legend>{TAGS.map(([tag, label]) => <label key={tag}><input type="checkbox" checked={mine.has(tag)} disabled={!mine.has(tag) && mine.size >= 3} onChange={() => toggleTag(p, tag, mine.has(tag))}/><span>{label}</span><small>{counts[tag] || 0}</small></label>)}</fieldset></li>
    })}</ul></>}
    {error && <div className="oc-feedback error" role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => setRetry(n => n + 1)}>Reintentar carga</button></div>}<p role="status" aria-live="polite">{notice}</p>
  </div>
}
