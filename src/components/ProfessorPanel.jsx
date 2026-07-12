import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import '../styles/ProfessorPanel.css'

export default function ProfessorPanel({ user, course }) {
  const [profs, setProfs] = useState(null)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('professors')
      .select('id, name, created_by, professor_votes ( student_id, vote )')
      .eq('course_id', course.id)
    if (error) { console.error('[professors:load]', error); setMsg('No se pudo cargar la lista de profesores.'); return }
    setProfs(data || [])
  }, [course.id])

  useEffect(() => {
    setProfs(null)
    setMsg(null)
    setName('')
    load()
  }, [load])

  const add = async e => {
    e.preventDefault()
    const n = name.trim()
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
    let error
    if (mine && mine.vote === v) {
      // tocar tu mismo voto lo quita
      ;({ error } = await supabase.from('professor_votes').delete().match({ professor_id: p.id, student_id: user.id }))
    } else {
      ;({ error } = await supabase.from('professor_votes').upsert({
        professor_id: p.id, student_id: user.id, vote: v, updated_at: new Date().toISOString()
      }))
    }
    if (error) { console.error('[professors:vote]', error); setMsg('No se pudo registrar tu voto.'); return }
    setMsg(null)
    load()
  }

  const remove = async p => {
    if (!window.confirm(`¿Quitar a ${p.name} de este curso? Se pierden sus votos.`)) return
    const { error } = await supabase.from('professors').delete().eq('id', p.id)
    if (error) { console.error('[professors:delete]', error); setMsg('No se pudo eliminar.'); return }
    load()
  }

  const ranked = (profs || [])
    .map(p => {
      const likes = p.professor_votes.filter(v => v.vote === 1).length
      const dislikes = p.professor_votes.filter(v => v.vote === -1).length
      const mine = p.professor_votes.find(v => v.student_id === user.id)?.vote ?? 0
      return { ...p, likes, dislikes, score: likes - dislikes, mine }
    })
    .sort((a, b) => b.score - a.score || b.likes - a.likes || a.name.localeCompare(b.name))

  const top = ranked.length > 0 && ranked[0].score > 0 ? ranked[0].id : null

  return (
    <div className="prof-card">
      <div className="prof-head">
        <span className="prof-title">Profesores · <strong>{course.n}</strong></span>
        <span className="prof-sub">Recomendados por los alumnos · un voto por persona</span>
      </div>

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
                  title={p.mine === 1 ? 'Quitar mi like' : 'Me gustó su curso'}
                >
                  👍 <b className="mono">{p.likes}</b>
                </button>
                <button
                  className={'vote-btn dislike' + (p.mine === -1 ? ' on' : '')}
                  onClick={() => vote(p, -1)}
                  title={p.mine === -1 ? 'Quitar mi dislike' : 'No lo recomiendo'}
                >
                  👎 <b className="mono">{p.dislikes}</b>
                </button>
                {p.created_by === user.id && (
                  <button className="prof-del" onClick={() => remove(p)} title="Quitar (solo quien lo agregó)">×</button>
                )}
              </span>
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
    </div>
  )
}
