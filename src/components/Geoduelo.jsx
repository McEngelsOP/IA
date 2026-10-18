import { useEffect, useRef, useState } from 'react'
import GeodueloOnline from './GeodueloOnline'
import useGeodueloFullscreen from './useGeodueloFullscreen'

const TYPE = 'esan:geoduelo'
const VALID_PHASES = new Set(['ready', 'playing', 'steal', 'result', 'paused', 'final'])

export default function Geoduelo({ onGameOver, soundEnabled, onSoundChange, onExit, playerName, account, client, user }) {
  const [mode, setMode] = useState('offline')
  const frame = useRef(null), root = useRef(null)
  const { fullscreen, toggle } = useGeodueloFullscreen(root)
  const callbacks = useRef({ onGameOver, onSoundChange, onExit, soundEnabled, playerName, account })
  callbacks.current = { onGameOver, onSoundChange, onExit, soundEnabled, playerName, account }
  const [session, setSession] = useState(() => crypto.randomUUID())
  const [status, setStatus] = useState('loading')
  const send = (action, detail = {}) => frame.current?.contentWindow?.postMessage({ type: TYPE, version: 1, session, action, ...detail }, location.origin)

  useEffect(() => {
    if (mode !== 'offline') return
    const matches = new Set()
    let timer = setTimeout(() => setStatus('error'), 30000)
    const init = () => send('init', { sound: callbacks.current.soundEnabled, playerName: callbacks.current.playerName, account: callbacks.current.account })
    function message(event) {
      const m = event.data
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin || !m || m.type !== TYPE || m.version !== 1 || m.session !== session) return
      if (m.action === 'ready') { clearTimeout(timer); setStatus('ready'); init() }
      else if (m.action === 'phase' && VALID_PHASES.has(m.phase)) { clearTimeout(timer); setStatus('ready') }
      else if (m.action === 'sound' && typeof m.sound === 'boolean') callbacks.current.onSoundChange?.(m.sound)
      else if (m.action === 'exit') callbacks.current.onExit?.()
      else if (m.action === 'complete' && typeof m.matchId === 'string' && m.matchId.length <= 64 && !matches.has(m.matchId)
        && Array.isArray(m.scores) && m.scores.length === 2 && m.scores.every(s => Number.isInteger(s) && s >= 0 && s <= 100000)
        && Number.isInteger(m.rounds) && m.rounds >= 1 && m.rounds <= 15) {
        matches.add(m.matchId)
        // Seat 1 belongs to the signed-in account; never submit the guest's or winner's score.
        callbacks.current.onGameOver?.(m.scores[0], true)
      }
    }
    const hidden = () => { if (document.hidden) send('pause') }
    const blur = () => { if (!document.hasFocus()) send('pause') }
    window.addEventListener('message', message)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('message', message)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [session, mode])

  useEffect(() => { send('sound', { sound: soundEnabled }) }, [soundEnabled, session])

  return <div ref={root} className={`gm-geoduelo-frame geo-with-mode${fullscreen ? ' geo-immersive' : ''}`}>
    <link rel="stylesheet" href="./juegos/geoduelo/fonts.css"/>
    <div className="geo-mode-bar" role="group" aria-label="Modo de Geoduelo">
      <button aria-pressed={mode === 'offline'} onClick={() => setMode('offline')}>Offline</button>
      <button aria-pressed={mode === 'online'} onClick={() => setMode('online')}>Online</button>
      <span className="geo-mode-hint">{mode === 'offline' ? 'Dos jugadores · una máquina' : 'Dos cuentas · dos máquinas'}</span>
      <button className="geo-fullscreen-button" onClick={toggle} aria-pressed={fullscreen} aria-label={fullscreen ? 'Salir de pantalla completa' : 'Entrar en pantalla completa'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={fullscreen ? 'M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'}/></svg><span>{fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}</span>
      </button>
    </div>
    {mode === 'online' ? <GeodueloOnline client={client} user={user}/> : <>

    <iframe key={session} ref={frame} title="Geoduelo: duelo local de geografía para dos jugadores"
      src={`./juegos/geoduelo/index.html#session=${session}`} allow="autoplay" referrerPolicy="same-origin"
      onLoad={() => send('init', { sound: soundEnabled, playerName, account })}/>
    {status === 'error' && <div className="gm-geoduelo-error" role="alert">
      <p>No se pudo preparar Geoduelo. Comprueba tu conexión y vuelve a intentarlo.</p>
      <button className="gm-small-button" onClick={() => { setStatus('loading'); setSession(crypto.randomUUID()) }}>Reintentar</button>
    </div>}
    </>}
  </div>
}
