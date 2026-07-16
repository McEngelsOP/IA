import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import DinoGame from './DinoGame'
import '../styles/Arcade.css'

// Figuritas que flotan en el fondo (posición/tiempos vía CSS)
const DECO = ['👾', '🎮', '🕹️', '⭐', '🚀', '💾', '👻', '🍄']

// Pantalla interna ARCADE: juegos + ranking global.
// El ranking firma con el alias (nombre secreto), nunca expone la cuenta.
// El visitante puede jugar, pero su puntaje no entra al ranking.
export default function Arcade({ user, onClose }) {
  const [ranking, setRanking] = useState(null) // null = cargando
  const [best, setBest] = useState(null)
  const [alias, setAlias] = useState(undefined)
  const [aliasDraft, setAliasDraft] = useState('')
  const [savingAlias, setSavingAlias] = useState(false)
  const [needAlias, setNeedAlias] = useState(false)
  const [pendingScore, setPendingScore] = useState(null)
  const [guestBest, setGuestBest] = useState(0) // visitante: solo esta sesión
  const [msg, setMsg] = useState(null)

  const loadRanking = useCallback(async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('game_scores')
      .select('alias, score, updated_at') // columnas explícitas: student_id no es legible
      .eq('game', 'dino')
      .order('score', { ascending: false })
      .limit(10)
    if (error) { console.error('[arcade:ranking]', error); return }
    setRanking(data || [])
  }, [user])

  useEffect(() => {
    if (!user) return
    loadRanking()
    supabase.rpc('my_game_score', { g: 'dino' }).then(({ data, error }) => {
      if (error) console.error('[arcade:best]', error)
      else if (data != null) setBest(data)
    })
    supabase.from('profiles').select('alias').eq('id', user.id).maybeSingle()
      .then(({ data }) => setAlias(data?.alias ?? null))
  }, [user, loadRanking])

  // Enviar puntaje al terminar la partida (solo guarda si supera el mejor).
  // ranked = false en los modos alternativos: no tocan el ranking global.
  const submitScore = useCallback(async (sc, ranked) => {
    if (!sc || !ranked) return
    if (!user) { setGuestBest(b => Math.max(b, sc)); return }
    const { data, error } = await supabase.rpc('submit_game_score', { g: 'dino', s: sc })
    if (error) {
      if ((error.message || '').includes('ALIAS_REQUIRED')) {
        setPendingScore(p => Math.max(p || 0, sc))
        setNeedAlias(true)
      } else {
        console.error('[arcade:submit]', error)
        setMsg('No se pudo guardar tu puntaje. Revisa tu conexión.')
      }
      return
    }
    setMsg(null)
    setBest(data)
    loadRanking()
  }, [user, loadRanking])

  // Elegir el nombre secreto (una sola vez, igual que en las reseñas)
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
    setNeedAlias(false)
    setMsg(null)
    if (pendingScore) { submitScore(pendingScore); setPendingScore(null) }
  }

  const medal = i => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`)

  return (
    <div className="arcade">
      {/* figuritas flotantes del fondo */}
      <div className="arcade-bg" aria-hidden="true">
        {DECO.map((d, i) => <span key={i} className={`deco deco-${i}`}>{d}</span>)}
        <span className="deco-shape sq1" /><span className="deco-shape sq2" />
        <span className="deco-shape tri1" /><span className="deco-shape dot1" />
      </div>

      <header className="arcade-head">
        <button className="arcade-back mono" onClick={onClose}>← VOLVER A LA MALLA</button>
        <h1 className="mono arcade-title">
          <span className="blink">▮</span> ARCADE <span className="arcade-title-deco">🕹️</span>
        </h1>
        <p className="arcade-sub">Tómate un descanso entre ciclo y ciclo. Compite con tu nombre secreto.</p>
      </header>

      <div className="arcade-grid">
        <section className="arcade-game">
          <div className="ag-head mono">
            <span className="ag-name">🦖 DINO RUNNER</span>
            <span className="ag-best">
              {user
                ? <>TU MEJOR (CLÁSICO): {best ?? '—'}</>
                : <>MEJOR (esta sesión): {guestBest || '—'}</>}
            </span>
          </div>
          <DinoGame onGameOver={submitScore} />
          {msg && <div className="arcade-msg">{msg}</div>}

          {needAlias && user && (
            <form className="arcade-alias" onSubmit={saveAlias}>
              <p>
                Para entrar al ranking necesitas tu <b>nombre secreto</b> (el mismo que firma
                tus reseñas; se elige una sola vez y no se puede cambiar).
              </p>
              <div className="arcade-alias-row">
                <input
                  type="text" maxLength="24" placeholder="Tu nombre secreto…"
                  value={aliasDraft} onChange={e => setAliasDraft(e.target.value)}
                />
                <button type="submit" disabled={savingAlias || aliasDraft.trim().length < 3}>
                  {savingAlias ? 'Guardando…' : 'Guardar y competir'}
                </button>
              </div>
            </form>
          )}
        </section>

        <aside className="arcade-rank">
          <h2 className="mono">🏆 RANKING GLOBAL</h2>
          <p className="rank-note">Solo puntúa el modo <b>Clásico</b> del Dino Runner.</p>
          {!user ? (
            <p className="rank-empty">
              Estás en modo visitante: puedes jugar, pero para aparecer en el ranking
              necesitas una cuenta.
            </p>
          ) : ranking === null ? (
            <p className="rank-empty mono">CARGANDO…</p>
          ) : ranking.length === 0 ? (
            <p className="rank-empty">Aún no hay puntajes. ¡Sé la primera persona del ranking!</p>
          ) : (
            <ol className="rank-list">
              {ranking.map((r, i) => (
                <li key={r.alias} className={'rank-row' + (alias && r.alias === alias ? ' me' : '') + (i < 3 ? ' top' : '')}>
                  <span className="rank-pos mono">{medal(i)}</span>
                  <span className="rank-alias">{r.alias}</span>
                  <span className="rank-score mono">{r.score}</span>
                </li>
              ))}
            </ol>
          )}
          {user && alias && (
            <p className="rank-foot mono">JUEGAS COMO: {alias}</p>
          )}
        </aside>
      </div>
    </div>
  )
}
