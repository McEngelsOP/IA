import { DEFAULT_SETTINGS } from '../../../src/lib/geoduelo-modes.js'
import { answer, appendQuestion, view, validSettings, QUESTION_MS, REVEAL_MS, ROUNDS } from './engine.js'
const json = (body, status = 200) => Response.json(body, { status })
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const stub = (binding, name) => binding.get(binding.idFromName(name))
const uuid = /^[0-9a-f-]{36}$/i
const encoder = new TextEncoder()
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const unb64 = s => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
async function key(env) { return crypto.subtle.importKey('raw', encoder.encode(env.TICKET_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) }
async function ticket(env, data) {
  const payload = b64(encoder.encode(JSON.stringify({ ...data, exp: Date.now() + 45000 })))
  return `${payload}.${b64(await crypto.subtle.sign('HMAC', await key(env), encoder.encode(payload)))}`
}
async function verify(env, value, room) {
  try {
    if (!value || value.length > 1500) return null
    const [payload, signature] = value.split('.')
    if (!await crypto.subtle.verify('HMAC', await key(env), unb64(signature), encoder.encode(payload))) return null
    const data = JSON.parse(new TextDecoder().decode(unb64(payload)))
    return data.room === room && data.exp > Date.now() ? data : null
  } catch { return null }
}
async function body(request) {
  if (Number(request.headers.get('content-length')) > 4096) fail('Solicitud demasiado grande.', 413)
  const raw = await request.text()
  if (raw.length > 4096) fail('Solicitud demasiado grande.', 413)
  try { return JSON.parse(raw) } catch { fail('Solicitud inválida.') }
}
async function identity(request, env) {
  const auth = request.headers.get('authorization')
  if (!/^Bearer [^\s]+$/.test(auth || '')) fail('Inicia sesión para jugar online.', 401)
  const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: auth }
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers, signal: AbortSignal.timeout(8000) })
  if (!r.ok) fail('Tu sesión venció. Vuelve a iniciar sesión.', 401)
  const user = await r.json()
  if (!uuid.test(user.id) || user.is_anonymous) fail('Necesitas una cuenta para jugar online.', 401)
  const p = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=alias&id=eq.${user.id}`, { headers, signal: AbortSignal.timeout(8000) })
  if (!p.ok) fail('No se pudo cargar tu perfil. Inténtalo nuevamente.', 503)
  const profile = (await p.json())[0]
  return { id: user.id, name: typeof profile?.alias === 'string' && profile.alias.trim() ? profile.alias.trim().slice(0, 24) : 'Explorador' }
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin'), url = new URL(request.url)
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim())
    if (!origin || !allowed.includes(origin)) return json({ error: 'Origen no permitido.' }, 403)
    const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Cache-Control': 'no-store' }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    let result
    try {
      if ((!env.TICKET_SECRET || env.TICKET_SECRET.length < 32) || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) fail('El modo online aún no está configurado.', 503)
      if (url.pathname.startsWith('/ws/') && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        if (url.searchParams.get('v') !== '2') fail('Actualiza la página para usar la nueva versión de Geoduelo.', 426)
        const room = url.pathname.slice(4)
        if (!uuid.test(room)) fail('Sala inválida.')
        const data = await verify(env, url.searchParams.get('ticket'), room)
        if (!data) fail('Conexión vencida. Vuelve a conectar.', 401)
        // The browser never receives a Supabase token in the WebSocket URL.
        result = await stub(env.ROOM, room).fetch(new Request('https://internal/socket', { headers: { Upgrade: 'websocket', 'X-Player': data.user } }))
        return result
      }
      if (url.pathname !== '/session' || request.method !== 'POST') fail('Ruta no encontrada.', 404)
      const data = await body(request)
      if (data.protocol !== 2) fail('Actualiza la página para usar la nueva versión de Geoduelo.', 426)
      if (!['search', 'create', 'join', 'resume', 'leave'].includes(data.action)) fail('Acción inválida.')
      const player = await identity(request, env)
      const r = await stub(env.LOBBY, 'global-v1').fetch(new Request('https://internal/session', { method: 'POST', body: JSON.stringify({ ...data, player }) }))
      const payload = await r.json()
      if (r.ok && payload.room) payload.ticket = await ticket(env, { room: payload.room, user: player.id })
      result = json(payload, r.status)
    } catch (e) { result = json({ error: e.status ? e.message : 'No se pudo conectar. Inténtalo nuevamente.' }, e.status || 503) }
    const response = new Response(result.body, result)
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v)
    return response
  }
}
export class Lobby {
  constructor(ctx, env) { this.ctx = ctx; this.env = env }
  async fetch(request) {
    // Serialize the complete allocation, including calls to a room: no duplicate matches.
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return await this.handle(await request.json()) } catch (e) { return json({ error: e.status ? e.message : 'No se pudo preparar la sala.' }, e.status || 503) }
    })
  }
  async handle(data) {
    const now = Date.now(), { player, action } = data
    const records = await this.ctx.storage.get('rooms') || []
    let rooms = records.filter(r => r.expires > now && (r.players.length === 2 || r.waitUntil > now))
    let current = rooms.find(r => r.players.includes(player.id))
    if (current) {
      const status = await (await stub(this.env.ROOM, current.id).fetch('https://internal/status')).json()
      if (['finished', 'expired'].includes(status.phase)) { rooms = rooms.filter(r => r.id !== current.id); current = null }
    }
    if (action === 'leave') {
      if (current) {
        await stub(this.env.ROOM, current.id).fetch(new Request('https://internal/leave', { method: 'POST', body: JSON.stringify({ id: player.id }) }))
        rooms = rooms.filter(r => r.id !== current.id)
      }
      await this.ctx.storage.put('rooms', rooms); return json({ left: true })
    }
    if (action === 'resume') {
      if (!current || current.id !== data.room) fail('La sala ya no está disponible.', 404)
      return json({ room: current.id })
    }
    // Repeated clicks or a second tab return the existing room, never a second allocation.
    if (current) return json({ room: current.id })
    if (rooms.reduce((n, r) => n + r.players.length, 0) >= Math.min(100, Math.max(2, Number(this.env.MAX_PLAYERS) || 50))) fail('Todas las plazas están ocupadas. Inténtalo en unos minutos.', 429)
    let room
    if (action === 'join') {
      const code = typeof data.code === 'string' ? data.code.toUpperCase().replaceAll(' ', '') : ''
      if (!/^[A-F0-9]{8}$/.test(code)) fail('Introduce los 8 caracteres del código.')
      room = rooms.find(r => r.code === code && !r.public && r.players.length === 1)
      if (!room) fail('Código incorrecto, sala llena o sala vencida.', 404)
    } else if (action === 'search') {
      room = rooms.find(r => r.public && r.players.length === 1 && r.waitUntil > now)
    }
    if (room) {
      const r = await stub(this.env.ROOM, room.id).fetch(new Request('https://internal/join', { method: 'POST', body: JSON.stringify(player) }))
      if (!r.ok) { rooms = rooms.filter(x => x.id !== room.id); await this.ctx.storage.put('rooms', rooms); fail('La sala venció. Vuelve a buscar.', 409) }
      room.players.push(player.id)
    } else {
      const id = crypto.randomUUID()
      // 32 random bits, valid only while the host is waiting.
      let code
      do { code = [...crypto.getRandomValues(new Uint8Array(4))].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase() } while (rooms.some(r => r.code === code))
      room = { id, code, public: action === 'search', players: [player.id], waitUntil: now + (action === 'search' ? 120000 : 300000), expires: now + 900000 }
      const r = await stub(this.env.ROOM, id).fetch(new Request('https://internal/create', { method: 'POST', body: JSON.stringify({ ...room, player }) }))
      if (!r.ok) fail('No se pudo crear la sala.', 503)
      rooms.push(room)
    }
    await this.ctx.storage.put('rooms', rooms)
    await this.ctx.storage.setAlarm(Math.min(...rooms.map(r => r.expires)))
    return json({ room: room.id })
  }
  async alarm() {
    const rooms = (await this.ctx.storage.get('rooms') || []).filter(r => r.expires > Date.now())
    if (rooms.length) { await this.ctx.storage.put('rooms', rooms); await this.ctx.storage.setAlarm(Math.min(...rooms.map(r => r.expires))) }
    else await this.ctx.storage.deleteAll()
  }
}
export class Room {
  constructor(ctx, env) { this.ctx = ctx; this.env = env }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const path = new URL(request.url).pathname
      let s = await this.ctx.storage.get('game')
      if (path === '/create' && !s) {
        const r = await request.json()
        s = { id: r.id, code: r.public ? null : r.code, phase: 'waiting', players: [r.player], scores: [0, 0], answers: [null, null], round: -1, deadline: r.waitUntil, saved: 'pending', expires: r.expires, host: r.public ? null : 0, public: r.public, settings: {...DEFAULT_SETTINGS}, revision: 0 }
        await this.save(s); return json({ ok: true })
      }
      if (!s) return json({ phase: 'expired', error: 'Sala vencida.' }, 404)
      await this.advance(s)
      if (path === '/status') return json({ phase: s.phase })
      if (path === '/join') {
        const player = await request.json()
        if (s.phase !== 'waiting' || s.players[0].id === player.id) return json({ error: 'Sala no disponible.' }, 409)
        s.players.push(player); if (s.public) s.host = crypto.getRandomValues(new Uint8Array(1))[0] % 2; s.phase = 'ready'; s.deadline = Date.now() + 120000
        await this.save(s); this.broadcast(s); return json({ ok: true })
      }
      if (path === '/leave') {
        const { id } = await request.json()
        const seat = s.players.findIndex(p => p.id === id)
        if (seat >= 0 && !['finished','expired'].includes(s.phase)) {
          if (s.players.length === 1 || s.phase === 'ready') { s.phase = 'expired'; s.deadline = Date.now() + 60000; await this.save(s) }
          else await this.finish(s, 'abandoned', 1 - seat)
          this.broadcast(s)
        }
        return json({ ok: true })
      }
      if (path === '/socket') {
        const seat = s.players.findIndex(p => p.id === request.headers.get('X-Player'))
        if (seat < 0 || s.phase === 'expired') return json({ error: 'Sala no disponible.' }, 403)
        const pair = new WebSocketPair(), [client, server] = Object.values(pair)
        for (const ws of this.ctx.getWebSockets()) if (ws.deserializeAttachment()?.seat === seat) ws.close(4001, 'Otra pestaña tomó la conexión')
        this.ctx.acceptWebSocket(server); server.serializeAttachment({ seat, last: 0, burst: 0 })
        server.send(JSON.stringify(view(s, seat)))
        return new Response(null, { status: 101, webSocket: client })
      }
      return json({ error: 'Ruta inválida.' }, 404)
    })
  }
  async save(s) { await this.ctx.storage.put('game', s); await this.ctx.storage.setAlarm(s.deadline) }
  broadcast(s) {
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(JSON.stringify(view(s, ws.deserializeAttachment().seat))) } catch {} }
  }
  async webSocketMessage(ws, raw) {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (typeof raw !== 'string' || raw.length > 512) { ws.close(1008, 'Mensaje inválido'); return }
      const a = ws.deserializeAttachment(), now = Date.now()
      if (now - a.last < 1000) a.burst++; else { a.last = now; a.burst = 0 }
      ws.serializeAttachment(a)
      if (a.burst > 20) { ws.close(1008, 'Demasiados mensajes'); return }
      const s = await this.ctx.storage.get('game')
      if (!s || s.phase === 'expired') { ws.close(1000, 'Sala vencida'); return }
      // A replaced socket must not issue a last command during its closing handshake.
      if (!this.ctx.getWebSockets().includes(ws) || ws.readyState !== 1) return
      await this.advance(s)
      let m; try { m = JSON.parse(raw) } catch { ws.close(1008, 'Mensaje inválido'); return }
      if (m.action === 'configure' && ['waiting','ready'].includes(s.phase) && a.seat === s.host && validSettings(m.settings)) {
        if (m.settings.mode !== s.settings?.mode || m.settings.level !== s.settings?.level) {
          s.settings = {mode:m.settings.mode,level:m.settings.level}; s.revision = (s.revision || 0) + 1
          s.players.forEach(p => { p.ready = false })
          await this.save(s); this.broadcast(s)
        }
      } else if (m.action === 'ready' && s.phase === 'ready' && m.revision === (s.revision || 0)) {
        s.players[a.seat].ready = true
        if (s.players.every(p => p.ready)) { s.questions = []; s.used = []; this.next(s) }
        await this.save(s); this.broadcast(s)
      } else if (m.action === 'answer' && answer(s, a.seat, m, now)) {
        if (s.answers.every(v => v !== null)) this.reveal(s)
        await this.save(s); this.broadcast(s)
      }
    })
  }
  next(s) { s.round++; appendQuestion(s); s.phase = 'question'; s.answers = [null, null]; s.deadline = Date.now() + QUESTION_MS }
  reveal(s) { s.phase = 'reveal'; s.deadline = Date.now() + REVEAL_MS }
  async advance(s) {
    if (Date.now() < s.deadline) return
    if (s.phase === 'waiting' || s.phase === 'ready') { s.phase = 'expired'; s.deadline = Date.now() + 60000; await this.save(s) }
    else if (s.phase === 'question') { this.reveal(s); await this.save(s) }
    else if (s.phase === 'reveal') {
      if (s.round + 1 === ROUNDS) await this.finish(s, 'completed', s.scores[0] === s.scores[1] ? null : s.scores[0] > s.scores[1] ? 0 : 1)
      else { this.next(s); await this.save(s) }
    }
    this.broadcast(s)
  }
  async finish(s, reason, winner) {
    s.phase = 'finished'; s.reason = reason; s.winner = winner; s.saved = 'pending'; s.deadline = Date.now() + 5000; s.attempts = 0
    await this.save(s)
    // Finalization is persisted before the network call; retrying uses the same match UUID.
    await this.persist(s)
  }
  async persist(s) {
    s.attempts++
    try {
      const r = await fetch(`${this.env.SUPABASE_URL}/rest/v1/rpc/record_geoduelo_online`, { method: 'POST',
        headers: { apikey: this.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: s.id, player_one: s.players[0].id, player_two: s.players[1].id, score_one: s.scores[0], score_two: s.scores[1], outcome: s.reason, winner_seat: s.winner }), signal: AbortSignal.timeout(8000) })
      if (!r.ok) throw new Error('save')
      s.saved = 'saved'
    } catch { s.saved = s.attempts < 8 ? 'retrying' : 'failed' }
    s.deadline = s.saved === 'retrying' ? Date.now() + Math.min(60000, 5000 * 2 ** s.attempts) : Date.now() + 300000
    await this.save(s); this.broadcast(s)
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.ctx.storage.get('game'); if (!s) return
      if (s.phase === 'finished' && ['pending','retrying'].includes(s.saved)) await this.persist(s)
      else if (s.phase === 'finished' || s.phase === 'expired') {
        for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'Partida cerrada')
        await this.ctx.storage.deleteAll()
      } else await this.advance(s)
    })
  }
  // No interval or ping loop: Cloudflare can hibernate this object with sockets open.
  async webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code) } catch {} }
  async webSocketError(ws) { try { ws.close(1011, 'Reconecta para continuar') } catch {} }
}
