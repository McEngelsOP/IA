import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import DinoGame from './DinoGame'
import AstroDefensa from './AstroDefensa'
import Galaxia from './Galaxia'
import '../styles/Arcade.css'
// Los tres juegos viajan DENTRO del chunk del arcade (que ya es lazy desde
// la malla): un solo punto de carga diferida — el lazy anidado por juego
// dejaba la tarjeta vacía cuando el sub-chunk fallaba en redes lentas.

// Figuritas que flotan en el fondo (posición/tiempos vía CSS)
const DECO = ['👾', '🎮', '🕹️', '⭐', '🚀', '💾', '👻', '🍄']

// Catálogo de juegos: la portada los lista en vertical; al elegir uno,
// la vista se centra solo en ese juego con su ranking y estadísticas.
const GAMES = {
  dino: {
    name: 'DINO RUN+', icon: '🦖',
    rankNote: 'Puntúa cualquier modo, salvo Zen.',
    desc: 'Corre, salta y agáchate entre cactus, rocas y pájaros. 5 modos: Clásico, Fácil, Difícil, Caótico y Zen, con power-ups y eventos.'
  },
  astro: {
    name: 'ASTRO-DEFENSA', icon: '🚀',
    rankNote: 'Todos los modos puntúan.',
    desc: 'Rota, acelera y dispara: destruye asteroides y OVNIs sin ser impactado. Hiper-salto de emergencia y power-ups en Fácil y Caótico.'
  },
  galaxia: {
    name: 'ESCUADRÓN GALÁCTICO', icon: '🛸',
    rankNote: 'Todos los modos puntúan.',
    desc: 'Shooter vertical: esquiva el tiro cruzado y derriba drones, cazas y acorazados por oleadas. Enjambres, meteoritos y jefes en Caótico.'
  }
}

// Pantalla interna ARCADE: juegos + ranking global.
// El ranking firma con el alias (nombre secreto), nunca expone la cuenta.
// El visitante puede jugar, pero su puntaje no entra al ranking.
export default function Arcade({ user, onClose }) {
  const [activeGame, setActiveGame] = useState(null) // null = portada con la lista
  const [ranking, setRanking] = useState(null)       // null = cargando
  const [bests, setBests] = useState({})             // mejor propio por juego
  const [alias, setAlias] = useState(undefined)
  const [aliasDraft, setAliasDraft] = useState('')
  const [savingAlias, setSavingAlias] = useState(false)
  const [needAlias, setNeedAlias] = useState(false)
  const [pendingScore, setPendingScore] = useState(null)
  const [guestBest, setGuestBest] = useState({}) // visitante: por juego, solo esta sesión
  const [msg, setMsg] = useState(null)

  // Mis mejores puntajes (se muestran en las tarjetas de la portada)
  useEffect(() => {
    if (!user) return
    Object.keys(GAMES).forEach(k => {
      supabase.rpc('my_game_score', { g: k }).then(({ data, error }) => {
        if (error) console.error('[arcade:best]', error)
        else if (data != null) setBests(b => ({ ...b, [k]: data }))
      })
    })
    supabase.from('profiles').select('alias').eq('id', user.id).maybeSingle()
      .then(({ data }) => setAlias(data?.alias ?? null))
  }, [user])

  const loadRanking = useCallback(async game => {
    if (!user || !game) return
    const { data, error } = await supabase
      .from('game_scores')
      .select('alias, score, updated_at') // columnas explícitas: student_id no es legible
      .eq('game', game)
      .order('score', { ascending: false })
      .limit(10)
    if (error) { console.error('[arcade:ranking]', error); return }
    setRanking(data || [])
  }, [user])

  const openGame = k => {
    setActiveGame(k)
    setRanking(null)
    setMsg(null)
    setNeedAlias(false)
    loadRanking(k)
  }

  const backToList = () => {
    setActiveGame(null)
    setMsg(null)
    setNeedAlias(false)
  }

  // Enviar puntaje al terminar la partida (solo guarda si supera el mejor).
  // ranked = false en los modos alternativos: no tocan el ranking global.
  const submitScore = useCallback(async (sc, ranked) => {
    if (!sc || !ranked || !activeGame) return
    if (!user) {
      setGuestBest(b => ({ ...b, [activeGame]: Math.max(b[activeGame] || 0, sc) }))
      return
    }
    const { data, error } = await supabase.rpc('submit_game_score', { g: activeGame, s: sc })
    if (error) {
      const m = error.message || ''
      if (m.includes('ALIAS_REQUIRED')) {
        setPendingScore(p => Math.max(p || 0, sc))
        setNeedAlias(true)
        return
      }
      console.error('[arcade:submit]', error)
      // mensajes específicos: culpar a la conexión escondía la causa real
      if (m.includes('BAD_GAME')) setMsg('Este juego aún no está habilitado en la base de datos (falta correr la query del arcade).')
      else if (m.includes('NO_AUTH')) setMsg('Tu sesión expiró: cierra sesión y vuelve a entrar para guardar puntajes.')
      else setMsg(`No se pudo guardar tu puntaje${m ? ` (${m})` : '. Revisa tu conexión.'}`)
      return
    }
    setMsg(null)
    setBests(b => ({ ...b, [activeGame]: data }))
    loadRanking(activeGame)
  }, [user, activeGame, loadRanking])

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
    if (activeGame) loadRanking(activeGame)
    if (pendingScore) { submitScore(pendingScore, true); setPendingScore(null) }
  }

  const medal = i => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`)

  const G = activeGame ? GAMES[activeGame] : null

  return (
    <div className="arcade">
      {/* figuritas flotantes del fondo */}
      <div className="arcade-bg" aria-hidden="true">
        {DECO.map((d, i) => <span key={i} className={`deco deco-${i}`}>{d}</span>)}
        <span className="deco-shape sq1" /><span className="deco-shape sq2" />
        <span className="deco-shape tri1" /><span className="deco-shape dot1" />
      </div>

      <header className="arcade-head">
        <button className="arcade-back mono" onClick={activeGame ? backToList : onClose}>
          {activeGame ? '← TODOS LOS JUEGOS' : '← VOLVER A LA MALLA'}
        </button>
        <h1 className="mono arcade-title">
          <span className="blink">▮</span> ARCADE <span className="arcade-title-deco">🕹️</span>
        </h1>
        <p className="arcade-sub">
          {activeGame
            ? <>{G.icon} {G.name} — {G.rankNote}</>
            : 'Tómate un descanso entre ciclo y ciclo. Elige un juego y compite con tu nombre secreto.'}
        </p>
        {user && alias && !activeGame && (
          <div className="arcade-user-info mono">
            JUEGAS COMO: <span className="arcade-user-alias">{alias}</span>
            <button className="arcade-change-alias-btn" onClick={() => { setAliasDraft(alias); setNeedAlias(true); }}>
              (CAMBIAR)
            </button>
          </div>
        )}
      </header>

      {!activeGame ? (
        /* ---------- Portada: lista vertical de juegos ---------- */
        <div className="game-list">
          {user && needAlias && (
            <form className="arcade-alias cover-alias" onSubmit={saveAlias}>
              <p>
                Elige tu nuevo <b>nombre secreto</b> para el ranking y comentarios:
              </p>
              <div className="arcade-alias-row">
                <input
                  type="text" maxLength="24" placeholder="Tu nombre secreto…"
                  value={aliasDraft} onChange={e => setAliasDraft(e.target.value)}
                />
                <button type="submit" disabled={savingAlias || aliasDraft.trim().length < 3 || aliasDraft.trim() === alias}>
                  {savingAlias ? 'Guardando…' : 'Guardar'}
                </button>
                <button type="button" className="arcade-alias-cancel" onClick={() => setNeedAlias(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {Object.entries(GAMES).map(([k, gm]) => (
            <button key={k} className="game-card" onClick={() => openGame(k)}>
              <span className="gc-icon">{gm.icon}</span>
              <span className="gc-info">
                <span className="gc-name mono">{gm.name}</span>
                <span className="gc-desc">{gm.desc}</span>
              </span>
              <span className="gc-side mono">
                {user
                  ? <span className="gc-best">TU MEJOR: {bests[k] ?? '—'}</span>
                  : guestBest[k]
                    ? <span className="gc-best">SESIÓN: {guestBest[k]}</span>
                    : null}
                <span className="gc-play">JUGAR ▸</span>
              </span>
            </button>
          ))}
          <p className="game-list-note mono">
            LOS RANKINGS Y TUS ESTADÍSTICAS SE MUESTRAN AL ENTRAR A CADA JUEGO
          </p>
        </div>
      ) : (
        /* ---------- Vista centrada en el juego elegido ---------- */
        <div className="arcade-grid">
          <section className="arcade-game">
            <div className="ag-head mono">
              <span className="ag-name">{G.icon} {G.name}</span>
              <span className="ag-best">
                {user
                  ? <>TU MEJOR: {bests[activeGame] ?? '—'}</>
                  : <>MEJOR (esta sesión): {guestBest[activeGame] || '—'}</>}
              </span>
            </div>
            {activeGame === 'dino' ? (
              <DinoGame onGameOver={submitScore} />
            ) : activeGame === 'astro' ? (
              <AstroDefensa onGameOver={submitScore} />
            ) : (
              <Galaxia onGameOver={submitScore} />
            )}
            {msg && <div className="arcade-msg">{msg}</div>}

            {needAlias && user && (
              <form className="arcade-alias" onSubmit={saveAlias}>
                <p>
                  {alias 
                    ? <>Elige tu nuevo <b>nombre secreto</b> para firmar tus reseñas y puntajes en el ranking:</>
                    : <>Para entrar al ranking necesitas tu <b>nombre secreto</b> (el mismo que firma tus reseñas):</>
                  }
                </p>
                <div className="arcade-alias-row">
                  <input
                    type="text" maxLength="24" placeholder="Tu nombre secreto…"
                    value={aliasDraft} onChange={e => setAliasDraft(e.target.value)}
                  />
                  <button type="submit" disabled={savingAlias || aliasDraft.trim().length < 3 || aliasDraft.trim() === alias}>
                    {savingAlias ? 'Guardando…' : 'Guardar y competir'}
                  </button>
                  {alias && (
                    <button type="button" className="arcade-alias-cancel" onClick={() => setNeedAlias(false)}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            )}
          </section>

          <aside className="arcade-rank">
            <h2 className="mono">🏆 RANKING GLOBAL</h2>
            <p className="rank-note">{G.name}: {G.rankNote}</p>
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
              <div className="rank-foot mono">
                <span>JUEGAS COMO: {alias}</span>
                <button type="button" className="arcade-edit-alias" onClick={() => { setAliasDraft(alias); setNeedAlias(true); }}>
                  (CAMBIAR)
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
