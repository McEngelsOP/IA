import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DinoGame from './DinoGame'
import Galaxia from './Galaxia'
export function OfficialArcadeGame({ game, client, user }) {
  const [notice, setNotice] = useState(''), [best, setBest] = useState(null)
  const alive = useRef(true), saving = useRef(false)
  useEffect(() => {
    alive.current = true
    if (user && client) client.rpc('my_game_score', { g: game }).then(r => { if (alive.current && !r.error) setBest(r.data) }).catch(() => {})
    return () => { alive.current = false }
  }, [game, user?.id, client])
  async function saveScore(score, ranked) {
    if (!ranked || !score || saving.current) return
    if (!user || !client) { if (alive.current) { setBest(v => Math.max(v || 0, score)); setNotice('Tu mejor puntaje se conserva durante esta partida. Inicia sesión para guardarlo en tu cuenta.') }; return }
    saving.current = true
    try {
      const verified = await client.auth.getUser()
      if (verified.error || verified.data.user?.id !== user.id) throw new Error('NO_AUTH')
      const result = await client.rpc('submit_game_score', { g: game, s: Math.round(score) })
      if (result.error) throw result.error
      if (alive.current) { setBest(result.data); setNotice('Puntaje guardado en la temporada actual.') }
    } catch (e) { if (alive.current) setNotice(e.message?.includes('ALIAS_REQUIRED') ? 'Elige tu nombre secreto en tu perfil para guardar puntajes.' : 'No se pudo guardar el puntaje. Puedes volver a jugar.') }
    finally { saving.current = false }
  }
  return <div className="gm-react-game">{game === 'dino' ? <DinoGame onGameOver={saveScore}/> : <Galaxia onGameOver={saveScore}/>}<p className="gm-result" role="status">{best != null ? `Tu mejor puntaje: ${best}. ` : ''}{notice}</p></div>
}
export function mountOfficialArcadeGame(container, props) { const root = createRoot(container); root.render(<OfficialArcadeGame {...props}/>); return () => root.unmount() }
