import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DinoGame from './DinoGame'
import Galaxia from './Galaxia'
import Geoduelo from './Geoduelo'
export function OfficialArcadeGame({ game, client, user, soundEnabled = true, onSoundChange, onExit, playerName }) {
  const [notice, setNotice] = useState(''), [best, setBest] = useState(null)
  const [pendingScore, setPendingScore] = useState(null)
  const alive = useRef(true), saving = useRef(false), waitingScore = useRef(0)
  useEffect(() => {
    alive.current = true
    if (user && client) client.rpc('my_game_score', { g: game }).then(r => { if (alive.current && !r.error) setBest(r.data) }).catch(() => {})
    return () => { alive.current = false }
  }, [game, user?.id, client])
  async function saveScore(score, ranked) {
    if (!ranked || !score) return
    if (game === 'geoduelo') waitingScore.current = Math.max(waitingScore.current, score)
    if (saving.current) return
    if (game === 'geoduelo') score = waitingScore.current
    if (game === 'geoduelo') setBest(v => Math.max(v || 0, score))
    if (!user || !client) { if (alive.current) { setBest(v => Math.max(v || 0, score)); setNotice('Tu mejor puntaje se conserva durante esta partida. Inicia sesión para guardarlo en tu cuenta.') }; return }
    saving.current = true
    try {
      const verified = await client.auth.getUser()
      if (verified.error || verified.data.user?.id !== user.id) throw new Error('NO_AUTH')
      const result = await client.rpc('submit_game_score', { g: game, s: Math.round(score) })
      if (result.error) throw result.error
      if (alive.current) {
        if (game === 'geoduelo' && waitingScore.current <= score) waitingScore.current = 0
        setBest(v => Math.max(v || 0, result.data || 0)); setPendingScore(waitingScore.current || null); setNotice('Puntaje guardado en la temporada actual.')
      }
    } catch (e) { if (alive.current) {
      if (game === 'geoduelo') setPendingScore(v => Math.max(v || 0, score))
      setNotice(e.message?.includes('ALIAS_REQUIRED') ? 'Elige tu nombre secreto en tu perfil para guardar puntajes.' : e.message?.includes('BAD_GAME') ? 'El ranking de Geoduelo aún no está habilitado. El resultado queda en esta sesión.' : 'No se pudo guardar el puntaje. Puedes volver a intentarlo.')
    } }
    finally {
      saving.current = false
      if (game === 'geoduelo' && waitingScore.current > score && alive.current) saveScore(waitingScore.current, true)
    }
  }
  return <div className={`gm-react-game${game === 'geoduelo' ? ' gm-geoduelo-game' : ''}`}>
    {game === 'geoduelo' ? <Geoduelo onGameOver={saveScore} soundEnabled={soundEnabled} onSoundChange={onSoundChange} onExit={onExit} playerName={playerName} account={!!user}/>
      : game === 'dino' ? <DinoGame onGameOver={saveScore}/> : <Galaxia onGameOver={saveScore}/>}
    {(best != null || notice || pendingScore) && <div className="gm-game-status"><p className="gm-result" role="status">{best != null ? `Tu mejor puntaje${game === 'geoduelo' ? ' · Jugador 1' : ''}: ${best}. ` : ''}{notice}</p>
      {pendingScore != null && <button className="gm-small-button" onClick={() => saveScore(pendingScore, true)}>Reintentar guardado</button>}</div>}
  </div>
}
export function mountOfficialArcadeGame(container, props) {
  const root = createRoot(container)
  root.render(<OfficialArcadeGame {...props}/>)
  const unmount = () => root.unmount()
  unmount.setSound = soundEnabled => { props = { ...props, soundEnabled }; root.render(<OfficialArcadeGame {...props}/>) }
  return unmount
}

