import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import ConfirmDialog from './ConfirmDialog'
import '../styles/ProfessorPanel.css'

// Etiquetas: cada alumno puede marcar hasta 3 por profesor (tope por RLS);
// cada una suma a su conteo. Las claves deben coincidir con el CHECK de
// professor_tags.
const TAGS = {
  'estricto-bueno': 'Estricto pero bueno',
  'estricto-mal': 'Estricto para mal',
  pasa: 'Pasa por pasar',
  aprender: 'Para aprender',
  relajo: 'Relajo',
  balance: 'Balance'
}

// embedded: versión sin tarjeta para incrustar en la ficha del curso
export default function ProfessorPanel({ user, course, embedded }) {
  const [profs, setProfs] = useState(null)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [tagPicker, setTagPicker] = useState(null) // id del profesor con el selector abierto
  const [confirmData, setConfirmData] = useState(null) // panel de confirmación de borrado

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('professors')
      .select('id, name, created_by, professor_votes ( student_id, vote ), professor_tags ( student_id, tag )')
      .eq('course_id', course.id)
    if (error) { console.error('[professors:load]', error); setMsg('No se pudo cargar la lista de profesores.'); return }
    setProfs(data || [])
  }, [course.id])

  useEffect(() => {
    setProfs(null)
    setMsg(null)
    setName('')
    setTagPicker(null)
    load()
  }, [load])

  const add = async e => {
    e.preventDefault()
    const n = name.trim().toUpperCase()
    if (n.length < 2) return
    setSaving(true)
    const { error } = await supabase
      .from('professors')
      .insert({ course_id: course.id, name: n, created_by: user.id })
    setSaving(false)
    if (error) {
      console.error('[professors:add]', error)
      setMsg(error.code === '23505' ? 'Ese profesor ya está en la lista de este curso.' : 'No se pudo agregar al profesor.')
      return
    }
    setName(''); setMsg(null)
    load()
  }

  const vote = async (p, v) => {
    const mine = p.professor_votes.find(x => x.student_id === user.id)
    const removing = mine && mine.vote === v // tocar tu mismo voto lo quita

    // Actualización optimista: el contador cambia al instante y solo
    // se revierte si el guardado en Supabase falla
    const prev = profs
    setProfs(profs.map(row => {
      if (row.id !== p.id) return row
      const rest = row.professor_votes.filter(x => x.student_id !== user.id)
      return { ...row, professor_votes: removing ? rest : [...rest, { student_id: user.id, vote: v }] }
    }))

    let error
    if (removing) {
      ;({ error } = await supabase.from('professor_votes').delete().match({ professor_id: p.id, student_id: user.id }))
    } else {
      ;({ error } = await supabase.from('professor_votes').upsert({
        professor_id: p.id, student_id: user.id, vote: v, updated_at: new Date().toISOString()
      }))
    }
    if (error) {
      console.error('[professors:vote]', error)
      setMsg('No se pudo registrar tu voto.')
      setProfs(prev)
      return
    }
    setMsg(null)
  }

  // Cada etiqueta se prende/apaga por separado (actualización optimista);
  // el tope de 3 por profesor lo aplica la RLS y aquí solo se traduce el error
  const setTag = async (p, tag) => {
    const removing = p.professor_tags.some(t => t.student_id === user.id && t.tag === tag)
    const prev = profs
    setProfs(profs.map(row => {
      if (row.id !== p.id) return row
      return {
        ...row,
        professor_tags: removing
          ? row.professor_tags.filter(t => !(t.student_id === user.id && t.tag === tag))
          : [...row.professor_tags, { student_id: user.id, tag }]
      }
    }))
    let error
    if (removing) {
      ;({ error } = await supabase.from('professor_tags').delete().match({ professor_id: p.id, student_id: user.id, tag }))
    } else {
      ;({ error } = await supabase.from('professor_tags').insert({ professor_id: p.id, student_id: user.id, tag }))
    }
    if (error) {
      console.error('[professors:tag]', error)
      setMsg(error.code === '42501' ? 'Máximo 3 etiquetas por profesor.' : 'No se pudo guardar tu etiqueta.')
      setProfs(prev)
      return
    }
    setMsg(null)
  }

  const remove = p => setConfirmData({
    message: `¿Quitar a ${p.name} de este curso?`,
    detail: 'Se quita para todos los alumnos (solo es posible mientras nadie más haya votado). Esto no se puede deshacer.',
    onConfirm: async () => {
      // .select() devuelve las filas realmente borradas: si otro alumno votó
      // hace un instante, la política RLS ya no permite borrar y llega vacío
      const { data, error } = await supabase.from('professors').delete().eq('id', p.id).select()
      if (error) { console.error('[professors:delete]', error); setMsg('No se pudo eliminar.'); return }
      if (!data || data.length === 0) {
        setMsg('Ya no se puede quitar: otro alumno acaba de votar por este profesor.')
        load()
        return
      }
      setMsg(null)
      load()
    }
  })

  const ranked = (profs || [])
    .map(p => {
      const likes = p.professor_votes.filter(v => v.vote === 1).length
      const dislikes = p.professor_votes.filter(v => v.vote === -1).length
      const mine = p.professor_votes.find(v => v.student_id === user.id)?.vote ?? 0
      const tagCounts = {}
      p.professor_tags.forEach(t => (tagCounts[t.tag] = (tagCounts[t.tag] || 0) + 1))
      const myTags = new Set(p.professor_tags.filter(t => t.student_id === user.id).map(t => t.tag))
      // Con votos de otros alumnos, la entrada ya es de la comunidad:
      // el creador pierde el botón de quitar (la RLS lo bloquea igual)
      const removable = p.created_by === user.id &&
        !p.professor_votes.some(v => v.student_id !== user.id)
      return { ...p, likes, dislikes, score: likes - dislikes, mine, tagCounts, myTags, removable }
    })
    .sort((a, b) => b.score - a.score || b.likes - a.likes || a.name.localeCompare(b.name))

  const top = ranked.length > 0 && ranked[0].score > 0 ? ranked[0].id : null

  return (
    <div className={'prof-card' + (embedded ? ' embedded' : '')}>
      {!embedded && (
        <div className="prof-head">
          <span className="prof-title">Profesores · <strong>{course.n}</strong></span>
          <span className="prof-sub">Un corazón por persona · etiqueta cómo enseña</span>
        </div>
      )}

      {msg && <div className="prof-msg">{msg}</div>}

      {profs === null ? (
        <div className="prof-empty mono">CARGANDO…</div>
      ) : ranked.length === 0 ? (
        <div className="prof-empty">Nadie ha sugerido profesores para este curso todavía. Sé el primero:</div>
      ) : (
        <ul className="prof-list">
          {ranked.map(p => (
            <li key={p.id} className={'prof-row' + (p.id === top ? ' top' : '')}>
              {p.id === top && <span className="prof-badge">⭐ Más valorado</span>}
              <span className="prof-name">{p.name}</span>
              <span className="prof-votes">
                <button
                  className={'vote-btn like' + (p.mine === 1 ? ' on' : '')}
                  onClick={() => vote(p, 1)}
                  title={p.mine === 1 ? 'Quitar mi corazón' : 'Me gustó su curso'}
                >
                  ♥ <b className="mono">{p.likes}</b>
                </button>
                <button
                  className={'vote-btn dislike' + (p.mine === -1 ? ' on' : '')}
                  onClick={() => vote(p, -1)}
                  title={p.mine === -1 ? 'Quitar mi dislike' : 'No lo recomiendo'}
                >
                  👎 <b className="mono">{p.dislikes}</b>
                </button>
                {p.removable && (
                  <button className="prof-del" onClick={() => remove(p)} title="Quitar (posible mientras nadie más haya votado)">×</button>
                )}
              </span>

              <div className="prof-tags">
                {Object.entries(p.tagCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => (
                    <span key={k} className={'ptag' + (p.myTags.has(k) ? ' mine' : '')}>
                      {TAGS[k]} <b className="mono">×{n}</b>
                    </span>
                  ))}
                <button
                  className={'ptag-btn' + (tagPicker === p.id ? ' on' : '')}
                  onClick={() => setTagPicker(tagPicker === p.id ? null : p.id)}
                >
                  🏷 {p.myTags.size > 0 ? 'Mis etiquetas' : 'Etiquetar'}
                </button>
              </div>

              {tagPicker === p.id && (
                <div className="tag-picker">
                  {Object.entries(TAGS).map(([k, label]) => (
                    <button
                      key={k}
                      className={'ptag pick' + (p.myTags.has(k) ? ' mine' : '')}
                      onClick={() => setTag(p, k)}
                      title={p.myTags.has(k) ? 'Quitar esta etiqueta' : 'Marcar esta etiqueta (máx. 3)'}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="prof-form" onSubmit={add}>
        <input
          type="text"
          placeholder="Nombre del profesor"
          maxLength="80"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <button type="submit" disabled={saving || name.trim().length < 2}>
          {saving ? 'Agregando…' : 'Agregar'}
        </button>
      </form>

      <ConfirmDialog data={confirmData} onClose={() => setConfirmData(null)} />
    </div>
  )
}
