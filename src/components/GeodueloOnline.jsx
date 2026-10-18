import { useEffect, useRef, useState } from 'react'
import './geoduelo-online.css'

const configuredURL = import.meta.env.VITE_GEODUELO_ONLINE_URL?.replace(/\/+$/, '') || ''
export default function GeodueloOnline({ client, user }) {
  const [state, setState] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [code, setCode] = useState(''), [connection, setConnection] = useState('idle'), [now, setNow] = useState(Date.now())
  const [choice, setChoice] = useState(null), [copied, setCopied] = useState(false)
  const ownsConnection = useRef(true)
  const socket = useRef(null), room = useRef(null), alive = useRef(true), token = useRef(null), generation = useRef(0), offset = useRef(0)
  const reconnect = useRef(null), retryCount = useRef(0), busyRef = useRef(false), stateRef = useRef(null)
  stateRef.current = state
  const storageKey = `geoduelo-online:${user?.id}`
  function remember(id) { try { if (id) sessionStorage.setItem(storageKey, id); else sessionStorage.removeItem(storageKey) } catch {} }
  async function request(action, extra = {}) {
    const { data, error: authError } = await client.auth.getSession()
    if (authError || !data.session?.access_token) throw new Error('Tu sesión venció. Vuelve a iniciar sesión.')
    token.current = data.session.access_token
    const response = await fetch(`${configuredURL}/session`, { method: 'POST', headers: { Authorization: `Bearer ${token.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }), signal: AbortSignal.timeout(15000) })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'No se pudo conectar. Inténtalo nuevamente.')
    return body
  }
  function connect(data) {
    const revision = ++generation.current
    clearTimeout(reconnect.current)
    socket.current?.close()
    ownsConnection.current = true
    room.current = data.room; remember(data.room); setConnection('connecting')
    const url = new URL(`${configuredURL}/ws/${data.room}`); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', data.ticket)
    const ws = new WebSocket(url); socket.current = ws
    ws.onopen = () => { if (alive.current && revision === generation.current) { setConnection('connected'); setError(''); retryCount.current = 0 } }
    ws.onmessage = event => {
      if (!alive.current || revision !== generation.current) return
      try {
        const s = JSON.parse(event.data)
        if (s.room !== room.current || !Array.isArray(s.scores)) return
        offset.current = s.serverTime - Date.now()
        setState(s); setNow(Date.now() + offset.current); setChoice(s.ownChoice)
        if (s.phase === 'expired') { remember(null); setError('La sala venció. Vuelve a buscar o crea una nueva.') }
      } catch { setError('No se pudo leer la partida. Vuelve a conectar.') }
    }
    ws.onclose = event => {
      if (!alive.current || revision !== generation.current) return
      setConnection('disconnected')
      if (event.code === 4001) { ownsConnection.current = false; setError('La partida se abrió en otra pestaña. Continúa allí o vuelve a conectar aquí.'); return }
      if (['finished','expired'].includes(stateRef.current?.phase)) return
      if (retryCount.current++ < 4) {
        reconnect.current = setTimeout(() => resume(revision), Math.min(8000, 1000 * 2 ** retryCount.current))
      } else setError('Se perdió la conexión. Puedes volver a conectar para continuar.')
    }
    ws.onerror = () => {} // onclose owns recovery; never start two reconnect loops.
  }
  async function resume(revision = generation.current) {
    if (!room.current || !alive.current) return
    try { const data = await request('resume', { room: room.current }); if (alive.current && revision === generation.current) connect(data) }
    catch (e) { if (alive.current && revision === generation.current) { setConnection('disconnected'); setError(e.message) } }
  }
  async function begin(action) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    const revision = generation.current
    try {
      const data = await request(action, { code })
      if (alive.current && revision === generation.current) connect(data)
      else if (!alive.current && token.current) {
        fetch(`${configuredURL}/session`, { method: 'POST', headers: { Authorization: `Bearer ${token.current}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'leave' }), keepalive: true }).catch(() => {})
      }
    }
    catch (e) { if (alive.current) setError(e.message) }
    finally { busyRef.current = false; if (alive.current) setBusy(false) }
  }
  async function leave() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); clearTimeout(reconnect.current)
    ++generation.current; socket.current?.close(); setConnection('disconnected')
    try {
      await request('leave'); room.current = null; remember(null); setState(null); setChoice(null); setConnection('idle')
    } catch (e) { setError(`${e.message} Vuelve a intentar salir para cerrar la sala.`) }
    finally { busyRef.current = false; if (alive.current) setBusy(false) }
  }
  function send(action, extra = {}) {
    if (socket.current?.readyState !== WebSocket.OPEN) { setError('Reconecta antes de responder.'); return }
    socket.current.send(JSON.stringify({ action, ...extra }))
  }
  useEffect(() => {
    alive.current = true
    if (configuredURL && user && client) {
      let previous; try { previous = sessionStorage.getItem(storageKey) } catch {}
      if (previous) { room.current = previous; resume() }
    }
    const online = () => { if (room.current && socket.current?.readyState !== WebSocket.OPEN) resume() }
    window.addEventListener('online', online)
    return () => {
      alive.current = false; ++generation.current; clearTimeout(reconnect.current); socket.current?.close(); window.removeEventListener('online', online)
      // Switching to local or closing Arcade releases the queue/room. A page reload can resume via sessionStorage.
      if (room.current && token.current && ownsConnection.current && !['finished','expired'].includes(stateRef.current?.phase)) {
        fetch(`${configuredURL}/session`, { method: 'POST', headers: { Authorization: `Bearer ${token.current}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'leave' }), keepalive: true })
          .then(r => { if (r.ok) remember(null) }).catch(() => {})
      } else remember(null)
    }
  }, [client, user?.id])
  useEffect(() => {
    if (!state || !['waiting','ready','question','reveal'].includes(state.phase)) return
    const timer = setInterval(() => setNow(Date.now() + offset.current), 250)
    return () => clearInterval(timer)
  }, [state?.phase])
  const seconds = state ? Math.max(0, Math.ceil((state.deadline - now) / 1000)) : 0
  const connected = connection === 'connected', active = state && !['finished','expired'].includes(state.phase)
  async function copyCode() {
    try { await navigator.clipboard.writeText(state.code); setCopied(true) } catch { setError('No se pudo copiar. Selecciona el código y cópialo manualmente.') }
  }
  return <section className="geo-online" aria-label="Geoduelo online">
    {!state && <div className="geo-online-lobby">
      <img className="geo-online-cover" src="./juegos/geoduelo/cover.svg" alt="Globo de Geoduelo con dos marcadores"/>
      <div className="geo-online-intro">
        <h2>El mundo entre los dos.</h2>
        <p>Un rival, dos pantallas. Respondan las mismas 10 preguntas de capitales: 25 segundos por ronda, hasta 150 puntos por acierto.</p>
        {!configuredURL ? <p className="geo-online-message" role="status">Online estará disponible cuando se active el servidor. Ya puedes jugar en Offline en la misma máquina.</p>
          : !user || !client ? <p className="geo-online-message" role="status">Inicia sesión en tu cuenta para buscar rival o entrar a una sala.</p>
          : <>
            <button className="geo-primary" disabled={busy || connection === 'connecting'} onClick={() => begin('search')}>{busy ? 'Preparando partida…' : 'Buscar rival'}</button>
            <div className="geo-online-private"><h3>Jugar con un amigo</h3>
              <button disabled={busy} onClick={() => begin('create')}>Crear sala privada</button>
              <form onSubmit={e => { e.preventDefault(); begin('join') }}>
                <label htmlFor="geo-room-code">Código de sala</label>
                <div className="geo-code-input"><input id="geo-room-code" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 8))} maxLength={8} autoComplete="off" autoCapitalize="characters" spellCheck="false" placeholder="8 caracteres" required pattern="[A-Fa-f0-9]{8}"/>
                  <button disabled={busy || code.length !== 8}>Entrar</button></div>
              </form>
            </div>
          </>}
      </div>
    </div>}
    {state && <div className="geo-online-match">
      <header className="geo-online-score" aria-label="Marcador">{[0, 1].map(i => <div key={i} className={`geo-player geo-player-${i}`}>
        <span><svg className="geo-player-mark" viewBox="0 0 16 16" aria-hidden="true">{i === 0 ? <circle cx="8" cy="8" r="5"/> : <path d="M8 1 15 8 8 15 1 8Z"/>}</svg>{state.players[i]?.name || 'Buscando rival…'}{i === state.seat ? ' (tú)' : ''}</span><strong>{state.scores[i]}</strong>
      </div>)}</header>
      <div className="geo-online-play">
        {state.phase === 'waiting' && <><h2>{state.code ? 'Tu sala está lista.' : 'Buscando un explorador…'}</h2>
          {state.code ? <><p>Comparte este código con tu amigo. Debe entrar a Online desde su cuenta y elegir Entrar.</p>
            <div className="geo-room-share"><output aria-label="Código de sala">{state.code}</output><button onClick={copyCode}>{copied ? 'Código copiado' : 'Copiar código'}</button></div></>
            : <p>Te conectaremos cuando otra persona pulse Buscar rival. Puedes cancelar si prefieres jugar local.</p>}
          <p className="geo-round-meta">La sala espera hasta {seconds} s.</p></>}
        {state.phase === 'ready' && <><h2>Rival encontrado.</h2><p>La partida comienza cuando ambos estén listos. Después de empezar, el reloj continúa aunque cambies de pestaña.</p>
          <button className="geo-primary" disabled={!connected || state.players[state.seat]?.ready} onClick={() => send('ready')}>{state.players[state.seat]?.ready ? 'Esperando al rival…' : 'Estoy listo'}</button><p className="geo-round-meta">Confirmen en {seconds} s.</p></>}
        {['question','reveal'].includes(state.phase) && <>
          <div className="geo-round-meta"><span>Ronda {state.round + 1} de {state.rounds}</span><span role="timer" aria-label="Segundos restantes">{seconds} s</span></div>
          <h2>¿Cuál es la capital de {state.question.country}?</h2>
          <div className="geo-online-options">{state.question.options.map((option, i) => <button key={`${state.round}-${i}`} className={`${choice === i ? 'geo-selected' : ''} ${state.phase === 'reveal' && state.correct === i ? 'geo-correct' : ''}`}
            disabled={!connected || state.phase !== 'question' || choice !== null || seconds === 0} aria-pressed={choice === i}
            onClick={() => { setChoice(i); send('answer', { choice: i, round: state.round }) }}>{option}{state.phase === 'reveal' && state.correct === i ? ' · Correcta' : ''}</button>)}</div>
          <p role="status">{state.phase === 'reveal' ? `Respuesta: ${state.question.options[state.correct]}. Siguiente ronda en ${seconds} s.` : choice !== null ? state.answered[state.seat] ? 'Respuesta recibida. Esperando al rival.' : 'Enviando respuesta…' : 'Ambos responden. Un acierto rápido suma más puntos.'}</p>
        </>}
        {state.phase === 'finished' && <><h2>{state.winner === null ? 'Empate en el atlas.' : state.winner === state.seat ? '¡El duelo es tuyo!' : 'Esta vez ganó tu rival.'}</h2>
          <p>{state.reason === 'abandoned' ? 'La partida terminó por abandono.' : 'Diez rondas, un mundo por aprender. ¿Otro duelo?'}</p>
          <p role="status">{state.saved === 'saved' ? 'Resultado online guardado en tu cuenta.' : state.saved === 'failed' ? 'No se pudo guardar el resultado. Comunícalo al administrador.' : 'Guardando el resultado. Reintentaremos automáticamente.'}</p>
        </>}
        {state.phase === 'expired' && <><h2>La sala venció.</h2><p>Vuelve a buscar rival o crea una nueva sala.</p></>}
      </div>
      <footer className="geo-online-footer"><span role="status">{connected ? 'Conectado' : connection === 'connecting' ? 'Conectando…' : 'Sin conexión'}</span>
        {!connected && active && <button onClick={() => resume()} disabled={busy}>Volver a conectar</button>}
        <button onClick={leave} disabled={busy}>{active ? state.phase === 'waiting' ? 'Cancelar búsqueda / sala' : 'Abandonar partida' : 'Volver a Online'}</button>
      </footer>
    </div>}
    {error && <p className="geo-online-error" role="alert">{error}</p>}
    {!state && connection === 'disconnected' && room.current && <button onClick={() => resume()}>Volver a conectar</button>}
  </section>
}
