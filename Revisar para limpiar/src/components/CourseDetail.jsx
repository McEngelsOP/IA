import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import ProfessorPanel from './ProfessorPanel'
import ConfirmDialog from './ConfirmDialog'
import '../styles/CourseDetail.css'

// Estados académicos de la ficha (null = pendiente, sin fila en la base)
export const STATUS_META = {
  aprobado: { label: 'Aprobado', color: '#1b7a46', soft: '#e4f1e8' },
  convalidado: { label: 'Convalidado', color: '#2f6fb5', soft: '#e3edf8' },
  matriculado: { label: 'Matriculado', color: '#d07c2c', soft: '#fdf0e0' },
  desaprobado: { label: 'Desaprobado', color: '#c0392b', soft: '#fbe5e5' }
}

const MAX_WORDS = 50
const countWords = text => {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

// Ficha del curso: registro académico privado (estado, nota, veces llevado,
// fecha, comentario personal) + reseñas anónimas compartidas entre carreras.
// El estado se guarda vía onSaveStatus (el padre sincroniza «llevados»);
// la nota reusa la tabla grades; las reseñas siguen el patrón de tool_comments.
export default function CourseDetail({ user, course, ciclos, byId, statusRow, isDone, onSaveStatus, onClose }) {
  const open = !!course
  const [msg, setMsg] = useState(null)
  const [saving, setSaving] = useState(false)

  // Nota (tabla grades)
  const [grade, setGrade] = useState(undefined) // undefined = cargando
  const [gradeDraft, setGradeDraft] = useState(null)
  const [gradeSaved, setGradeSaved] = useState(false)

  // Campos del registro académico
  const [timesDraft, setTimesDraft] = useState(null)
  const [noteDraft, setNoteDraft] = useState(null)

  // Reseñas anónimas
  const [comments, setComments] = useState(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [sending, setSending] = useState(false)

  // Nombre secreto (mismo flujo que en las herramientas)
  const [alias, setAlias] = useState(undefined)
  const [aliasDraft, setAliasDraft] = useState('')
  const [savingAlias, setSavingAlias] = useState(false)

  const [confirmData, setConfirmData] = useState(null) // panel de confirmación de borrado

  // Estado efectivo: la fila guardada o, si el curso ya está marcado como
  // llevado sin fila propia, «aprobado» implícito (marcar llevados = aprobar)
  const effectiveStatus = statusRow?.status ?? (isDone ? 'aprobado' : null)

  const loadComments = async courseId => {
    // Columnas explícitas: author_id no es legible (anonimato por columna)
    const { data, error } = await supabase
      .from('course_comments')
      .select('id, alias, body, created_at')
      .eq('course_id', courseId)
      .order('created_at', { ascending: true })
    if (error) { console.error('[course_comments:load]', error); return }
    setComments(data || [])
  }

  // Dificultad del curso
  const [difficultyStats, setDifficultyStats] = useState({ avg_rating: 0, total_votes: 0, user_rating: null })
  const [savingDifficulty, setSavingDifficulty] = useState(false)

  const loadDifficulty = async courseId => {
    const { data, error } = await supabase.rpc('get_course_difficulty_stats', { cid: courseId })
    if (error) {
      const { data: votes } = await supabase
        .from('course_difficulty_votes')
        .select('rating, student_id')
        .eq('course_id', courseId)
      if (votes) {
        const userVote = votes.find(v => v.student_id === user.id)?.rating || null
        const total = votes.length
        const avg = total > 0 ? (votes.reduce((a, b) => a + b.rating, 0) / total).toFixed(1) : 0
        setDifficultyStats({ avg_rating: Number(avg), total_votes: total, user_rating: userVote })
      }
      return
    }
    setDifficultyStats(data || { avg_rating: 0, total_votes: 0, user_rating: null })
  }

  const saveDifficulty = async rating => {
    if (savingDifficulty) return
    setSavingDifficulty(true)
    const { error } = await supabase
      .from('course_difficulty_votes')
      .upsert({ course_id: course.id, student_id: user.id, rating, updated_at: new Date().toISOString() })
    setSavingDifficulty(false)
    if (error) {
      console.error('[difficulty:save]', error)
      setMsg('No se pudo guardar la calificación de dificultad.')
      return
    }
    loadDifficulty(course.id)
  }

  // Al abrir la ficha de un curso: recargar su nota, reseñas y dificultad
  useEffect(() => {
    if (!course) return
    setMsg(null)
    setGrade(undefined)
    setGradeDraft(null)
    setTimesDraft(null)
    setNoteDraft(null)
    setComments(null)
    setCommentDraft('')
    setDifficultyStats({ avg_rating: 0, total_votes: 0, user_rating: null })
    let cancelled = false
    supabase
      .from('grades')
      .select('grade')
      .match({ student_id: user.id, course_id: course.id })
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { console.error('[grades:load]', error); return }
        setGrade(data ? Number(data.grade) : null)
      })
    loadComments(course.id)
    loadDifficulty(course.id)
    return () => { cancelled = true }
  }, [course?.id, user.id])

  // El alias propio se carga una sola vez
  useEffect(() => {
    if (!open || alias !== undefined) return
    supabase
      .from('profiles')
      .select('alias')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) { console.error('[alias:load]', error); return }
        setAlias(data?.alias ?? null)
      })
  }, [open, alias, user.id])

  if (!course) {
    return <div className={'cd-backdrop'} />
  }

  const prereqs = course.r.map(id => byId[id]?.n).filter(Boolean)

  // ---------- Estado y registro ----------
  const composeRow = extra => ({
    status: effectiveStatus,
    times_taken: statusRow?.times_taken ?? 1,
    passed_at: statusRow?.passed_at ?? null,
    personal_note: statusRow?.personal_note ?? null,
    ...extra
  })

  const setStatus = async status => {
    // Se compara contra el estado efectivo: «Pendiente» también debe
    // funcionar sobre el aprobado implícito (curso llevado sin fila propia)
    if (saving || status === effectiveStatus) return
    setSaving(true)
    setMsg(null)
    const res = status === null
      ? await onSaveStatus(course.id, null)
      : await onSaveStatus(course.id, composeRow({ status }))
    setSaving(false)
    if (res?.error) setMsg(res.error)
  }

  const saveField = async extra => {
    if (!effectiveStatus) return
    setSaving(true)
    setMsg(null)
    const res = await onSaveStatus(course.id, composeRow(extra))
    setSaving(false)
    if (res?.error) setMsg(res.error)
  }

  // Veces llevado: de 1 a 3; el valor se ajusta solo al rango, sin mensajes
  // de error, y solo se guarda si de verdad cambió.
  const saveTimes = raw => {
    setTimesDraft(null)
    if (raw === '' || !effectiveStatus) return
    const val = Math.min(3, Math.max(1, Math.round(Number(raw)) || 1))
    if (val === (statusRow?.times_taken ?? 1)) return
    saveField({ times_taken: val })
  }

  const saveNote = raw => {
    setNoteDraft(null)
    const text = raw.trim()
    if (text === (statusRow?.personal_note ?? '')) return
    saveField({ personal_note: text || null })
  }

  // ---------- Nota (tabla grades, igual que en el panel lateral) ----------
  const saveGrade = async raw => {
    const text = String(raw).trim().replace(',', '.')
    setGradeDraft(null)
    if (text === '') {
      if (grade === null || grade === undefined) return
      setGrade(null)
      const { error } = await supabase.from('grades').delete().match({ student_id: user.id, course_id: course.id })
      if (error) { console.error('[grades:delete]', error); setMsg('No se pudo borrar la nota.') }
      return
    }
    const val = Number(text)
    if (!Number.isFinite(val) || val < 0 || val > 20) { setMsg('La nota debe estar entre 0 y 20.'); return }
    setMsg(null)
    setGrade(val)
    const { error } = await supabase
      .from('grades')
      .upsert({ student_id: user.id, course_id: course.id, grade: val, updated_at: new Date().toISOString() })
    if (error) { console.error('[grades:save]', error); setMsg('No se pudo guardar la nota.'); return }
    setGradeSaved(true)
    setTimeout(() => setGradeSaved(false), 1800)
  }

  // ---------- Reseñas ----------
  const saveAlias = async e => {
    e.preventDefault()
    const a = aliasDraft.trim()
    if (a.length < 3 || a.length > 24) { setMsg('El nombre secreto debe tener entre 3 y 24 caracteres.'); return }
    setSavingAlias(true)
    const { error } = await supabase.from('profiles').update({ alias: a }).eq('id', user.id)
    setSavingAlias(false)
    if (error) {
      console.error('[alias:save]', error)
      setMsg(error.code === '23505' ? 'Ese nombre secreto ya está en uso. Prueba con otro.' : 'No se pudo guardar tu nombre secreto.')
      return
    }
    setAlias(a)
    setAliasDraft('')
    setMsg(null)
  }

  const words = countWords(commentDraft)

  const addComment = async e => {
    e.preventDefault()
    const body = commentDraft.trim()
    if (body.length < 2 || words > MAX_WORDS) return
    setSending(true)
    // El alias NO se envía: lo estampa el servidor desde el perfil
    const { error } = await supabase
      .from('course_comments')
      .insert({ course_id: course.id, author_id: user.id, body })
    setSending(false)
    if (error) {
      console.error('[course_comments:add]', error)
      setMsg(error.code === '42501' ? 'Llegaste al tope de 3 reseñas en este curso.' : 'No se pudo publicar la reseña.')
      return
    }
    setCommentDraft('')
    setMsg(null)
    loadComments(course.id)
  }

  const removeComment = c => setConfirmData({
    message: '¿Eliminar tu reseña?',
    detail: `Firmada como ${c.alias} · esto no se puede deshacer.`,
    onConfirm: async () => {
      const { error } = await supabase.from('course_comments').delete().eq('id', c.id)
      if (error) { console.error('[course_comments:delete]', error); setMsg('No se pudo eliminar la reseña.'); return }
      setMsg(null)
      loadComments(course.id)
    }
  })

  return (
    <>
      <div className={'cd-backdrop' + (open ? ' show' : '')} onClick={onClose} />
      <aside className={'cd' + (open ? ' open' : '')} aria-hidden={!open}>
        <header className="cd-head">
          <div>
            <div className="cd-eyebrow mono">{course.id.toUpperCase()} · CICLO {course.c}</div>
            <h2><span className="aa-title-bullet">■</span> {course.n}</h2>
          </div>
          <button className="cd-close" onClick={onClose} aria-label="Cerrar ficha">×</button>
        </header>

        {msg && <div className="cd-msg">{msg}</div>}

        <div className="cd-body">
          <div className="cd-facts">
            <div className="fact">
              <span className="fact-lbl">Créditos</span>
              <span className="fact-val mono">{course.cr}</span>
            </div>
            <div className="fact">
              <span className="fact-lbl">Ciclo recomendado</span>
              <span className="fact-val mono">{ciclos[course.c].t}</span>
            </div>
            <div className="fact">
              <span className="fact-lbl">Nota</span>
              <span className="fact-val mono">{grade === undefined ? '…' : grade === null ? '—' : grade}</span>
            </div>
          </div>

          <section className="cd-section">
            <h3>Prerrequisitos</h3>
            {prereqs.length === 0 && !course.rc ? (
              <p className="cd-plain">Ninguno: se puede llevar desde el inicio.</p>
            ) : (
              <ul className="cd-prereqs">
                {prereqs.map(n => <li key={n}>{n}</li>)}
                {course.rc && <li className="cd-rc"><b>{course.rc} créditos aprobados</b></li>}
              </ul>
            )}
          </section>

          <section className="cd-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Dificultad del curso</h3>
              <span className="mono" style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f59e0b' }}>
                {difficultyStats.avg_rating > 0 ? `⭐ ${difficultyStats.avg_rating} / 5` : 'Sin votos'}
                <span style={{ fontSize: '0.75rem', opacity: 0.7, marginLeft: 4 }}>({difficultyStats.total_votes})</span>
              </span>
            </div>
            <p className="cd-note-txt" style={{ marginBottom: 8 }}>
              ¿Qué tan difícil te pareció este curso? Tu voto ayuda a la comunidad.
            </p>
            <div className="cd-difficulty-selector" style={{ display: 'flex', gap: 4 }}>
              {[
                { r: 1, label: '1 · Muy fácil', color: '#10b981' },
                { r: 2, label: '2 · Fácil', color: '#3b82f6' },
                { r: 3, label: '3 · Medio', color: '#f59e0b' },
                { r: 4, label: '4 · Difícil', color: '#f97316' },
                { r: 5, label: '5 · Pesadilla', color: '#ef4444' }
              ].map(item => {
                const active = difficultyStats.user_rating === item.r
                return (
                  <button
                    key={item.r}
                    type="button"
                    disabled={savingDifficulty}
                    onClick={() => saveDifficulty(item.r)}
                    style={{
                      flex: 1,
                      padding: '6px 4px',
                      borderRadius: 6,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      border: `1px solid ${active ? item.color : '#e5e7eb'}`,
                      background: active ? item.color : '#ffffff',
                      color: active ? '#ffffff' : '#4b5563',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    title={item.label}
                  >
                    {item.r}★
                  </button>
                )
              })}
            </div>
          </section>

          <section className="cd-section">
            <h3>Estado</h3>
            <div className="cd-states">
              <button
                className={'st-chip' + (effectiveStatus === null ? ' on' : '')}
                style={effectiveStatus === null ? { background: '#fff', borderColor: '#8b94a0', color: '#15202e' } : undefined}
                disabled={saving}
                onClick={() => setStatus(null)}
              >⬜ Pendiente</button>
              {Object.entries(STATUS_META).map(([key, m]) => {
                const on = effectiveStatus === key
                return (
                  <button
                    key={key}
                    className={'st-chip' + (on ? ' on' : '')}
                    style={on ? { background: m.soft, borderColor: m.color, color: m.color } : undefined}
                    disabled={saving}
                    onClick={() => setStatus(key)}
                  >{m.label}</button>
                )
              })}
            </div>
            <p className="cd-note-txt">
              «Aprobado» y «Convalidado» marcan el curso como llevado (con sus requisitos);
              los demás estados lo quitan de tus llevados.
            </p>
          </section>

          <section className="cd-section">
            <h3>Mi registro</h3>
            {!effectiveStatus && (
              <p className="cd-note-txt">
                Elige primero un <b>estado</b> arriba (aprobado, desaprobado…) y se
                habilitarán las veces llevado, la fecha y los comentarios.
              </p>
            )}
            <div className="cd-reg">
              <label className="cd-field">
                <span>Nota (0–20)</span>
                <span className="cd-inline">
                  {gradeSaved && <em className="cd-saved">✓</em>}
                  <input
                    className="mono" type="number" min="0" max="20" step="0.5" placeholder="—"
                    value={gradeDraft !== null ? gradeDraft : grade ?? ''}
                    onChange={e => setGradeDraft(e.target.value)}
                    onBlur={e => saveGrade(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                  />
                </span>
              </label>
              <label className="cd-field">
                <span>Veces llevado</span>
                <input
                  className="mono" type="number" min="1" max="3" step="1"
                  disabled={!effectiveStatus}
                  value={timesDraft !== null ? timesDraft : statusRow?.times_taken ?? (effectiveStatus ? 1 : '')}
                  onChange={e => setTimesDraft(e.target.value)}
                  onBlur={e => saveTimes(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                />
              </label>
              {(effectiveStatus === 'aprobado' || effectiveStatus === 'convalidado') && (
                <label className="cd-field">
                  <span>Fecha de aprobación</span>
                  <input
                    className="mono" type="date"
                    value={statusRow?.passed_at ?? ''}
                    onChange={e => saveField({ passed_at: e.target.value || null })}
                  />
                </label>
              )}
              <label className="cd-field cd-field-block">
                <span>Comentarios personales (solo tú los ves)</span>
                <textarea
                  rows="3" maxLength="500" placeholder={effectiveStatus ? 'Apuntes sobre este curso…' : 'Elige primero un estado.'}
                  disabled={!effectiveStatus}
                  value={noteDraft !== null ? noteDraft : statusRow?.personal_note ?? ''}
                  onChange={e => setNoteDraft(e.target.value)}
                  onBlur={e => saveNote(e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="cd-section">
            <h3>Profesores</h3>
            <p className="cd-note-txt">
              Dales un corazón a los que recomiendas y etiqueta cómo enseñan —
              se comparte con las carreras que llevan este curso.
            </p>
            <ProfessorPanel user={user} course={course} embedded />
          </section>

          <section className="cd-section">
            <h3>Reseñas anónimas · {comments?.length ?? '…'}</h3>
            <p className="cd-note-txt">
              Visibles para todas las carreras. Se firman con tu <b>nombre secreto</b> —
              nadie sabe quién eres. Máximo {MAX_WORDS} palabras.
            </p>

            {comments === null ? (
              <div className="cd-plain">Cargando…</div>
            ) : comments.length === 0 ? (
              <div className="cd-empty">Nadie ha reseñado este curso todavía. Sé el primero:</div>
            ) : (
              <div className="cd-comments">
                {comments.map(c => (
                  <div key={c.id} className="tc-row">
                    <span className="tc-alias mono">{c.alias}</span>
                    <p className="tc-body">{c.body}</p>
                    {alias && c.alias === alias && (
                      <button className="tc-del" onClick={() => removeComment(c)} title="Eliminar mi reseña">×</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {alias === null ? (
              <form className="tc-alias-form" onSubmit={saveAlias}>
                <p className="tc-note">
                  Para reseñar, elige tu <b>nombre secreto</b>: firmará tus reseñas y comentarios
                  sin revelar quién eres, y <b>no se puede cambiar</b> después.
                </p>
                <div className="tc-line">
                  <input
                    type="text" maxLength="24" placeholder="3 a 24 caracteres"
                    value={aliasDraft} onChange={e => setAliasDraft(e.target.value)}
                  />
                  <button type="submit" disabled={savingAlias || aliasDraft.trim().length < 3}>
                    {savingAlias ? 'Guardando…' : 'Usar este nombre'}
                  </button>
                </div>
              </form>
            ) : alias ? (
              <form className="cd-review-form" onSubmit={addComment}>
                <textarea
                  rows="3" maxLength="400" placeholder={`Reseñar como ${alias}…`}
                  value={commentDraft} onChange={e => setCommentDraft(e.target.value)}
                />
                <div className="cd-review-foot">
                  <span className={'cd-words mono' + (words > MAX_WORDS ? ' over' : '')}>
                    {words}/{MAX_WORDS} palabras
                  </span>
                  <button type="submit" disabled={sending || commentDraft.trim().length < 2 || words > MAX_WORDS}>
                    {sending ? '…' : 'Publicar reseña'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="cd-plain mono">CARGANDO…</div>
            )}
          </section>
        </div>
      </aside>

      <ConfirmDialog data={confirmData} onClose={() => setConfirmData(null)} />
    </>
  )
}
