import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ROOM_PAGE_SIZE, MESSAGE_PAGE_SIZE, studyError, mergeMessages, cleanInvite, validRoom } from '../lib/studyGroups'
import '../styles/OfficialStudyGroups.css'

const initialForm = course => ({ course, name: '', description: '', nickname: '', private: false })
const when = value => new Date(value).toLocaleString('es-PE', { timeZone: 'America/Lima', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
function Icon({ name }) {
  const paths = { plus: <path d="M12 5v14M5 12h14"/>, left: <path d="m14 6-6 6 6 6"/>, right: <path d="m10 6 6 6-6 6"/>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>, lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>, users: <><path d="M3 21v-3a5 5 0 0 1 10 0v3m4-7a4 4 0 0 1 4 4v3"/><circle cx="8" cy="7" r="4"/><path d="M16 3a4 4 0 0 1 0 8"/></>, send: <><path d="m3 3 19 9-19 9 4-9zM7 12h15"/></>, refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 7M4 12l2 7a7 7 0 0 0 12-2"/></>, close: <path d="m6 6 12 12M6 18 18 6"/> }
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
function OfficialStudyGroups({ client, user, courses, onBusy }) {
  const [rooms, setRooms] = useState([]), [state, setState] = useState('loading'), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [course, setCourse] = useState(''), [scope, setScope] = useState('all'), [page, setPage] = useState(0)
  const [form, setForm] = useState(null), [createDraft, setCreateDraft] = useState(initialForm(courses[0]?.id || ''))
  const [joinDraft, setJoinDraft] = useState({ code: '', nickname: '', room: null })
  const [room, setRoom] = useState(null), [roomId, setRoomId] = useState(null), [chatState, setChatState] = useState('loading')
  const [members, setMembers] = useState([]), [messages, setMessages] = useState([]), [messageDraft, setMessageDraft] = useState(''), [older, setOlder] = useState(false), [loadingOlder, setLoadingOlder] = useState(false)
  const [invite, setInvite] = useState(''), [confirm, setConfirm] = useState(null), [refreshing, setRefreshing] = useState(false)
  const alive = useRef(true), lock = useRef(false), listRevision = useRef(0), chatRevision = useRef(0), activeRoom = useRef(null), formRef = useRef(null), messageInput = useRef(null), transcript = useRef(null), headerRef = useRef(null), listAction = useRef(null)
  const creation = useRef(null), submission = useRef(null), scrolling = useRef(false), lastCount = useRef(0), chatLoading = useRef(null), olderLoading = useRef(null)
  const courseName = id => courses.find(c => c.id === id)?.n || 'Curso de la sala'
  useEffect(() => { alive.current = true; return () => { alive.current = false; listRevision.current++; chatRevision.current++ } }, [])
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(0) }, 300); return () => clearTimeout(timer) }, [query])
  useEffect(() => { if (!roomId) loadRooms() }, [course, search, scope, page, roomId])
  useEffect(() => {
    if (!roomId) return
    const id = roomId, revision = ++chatRevision.current
    activeRoom.current = id; setChatState('loading'); setMessages([]); setMembers([]); setInvite(''); setError(''); lastCount.current = 0
    const load = () => refreshChat(id, revision, false)
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !lock.current) refreshChat(id, revision, true) }, 10000)
    const focus = () => { if (!lock.current && document.visibilityState === 'visible') refreshChat(id, revision, true) }
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus)
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); chatRevision.current++; activeRoom.current = null }
  }, [roomId])
  useEffect(() => { if (form) { formRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); formRef.current?.querySelector('input,select')?.focus({ preventScroll: true }) } }, [form])
  useEffect(() => { if (chatState === 'ready') headerRef.current?.focus({ preventScroll: true }) }, [chatState])
  useEffect(() => {
    if (messages.length !== lastCount.current && !scrolling.current) transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'instant' })
    lastCount.current = messages.length
  }, [messages])
  async function verify() {
    const result = await client.auth.getUser()
    if (result.error || result.data.user?.id !== user.id) throw { message: 'NO_AUTH' }
  }
  async function rpc(name, args) {
    const result = await client.rpc(name, args)
    if (result.error) throw result.error
    return result.data
  }
  async function loadRooms() {
    const revision = ++listRevision.current
    setState('loading'); setError('')
    try {
      await verify()
      const data = await rpc('list_study_rooms', { course_ids: course ? [course] : courses.map(c => c.id), room_query: search.trim(), room_scope: scope, page_offset: page * ROOM_PAGE_SIZE })
      if (!alive.current || revision !== listRevision.current || activeRoom.current) return
      setRooms(data || []); setState('ready')
    } catch (e) { if (alive.current && revision === listRevision.current && !activeRoom.current) { setState('error'); setError(studyError(e, 'No se pudieron cargar las salas. Reintenta.')) } }
  }
  async function refreshChat(id, revision, background) {
    if (chatLoading.current === revision || olderLoading.current === revision) return
    chatLoading.current = revision
    try {
      const [info, incoming, result] = await Promise.all([
        rpc('study_room_info', { rid: id }), rpc('read_study_messages', { rid: id }), client.from('study_room_members').select('nickname,joined_at').eq('room_id', id).order('joined_at')
      ])
      if (result.error) throw result.error
      if (!info?.[0]) throw { message: 'ROOM_UNAVAILABLE' }
      if (!alive.current || revision !== chatRevision.current || activeRoom.current !== id) return
      setRoom(info[0]); setMembers(result.data || []); setMessages(previous => mergeMessages(previous, incoming || []))
      if (!background) { setOlder((incoming || []).length === MESSAGE_PAGE_SIZE); setChatState('ready') }
      else setNotice('')
    } catch (e) { if (alive.current && revision === chatRevision.current) { if (!background) { setChatState('error'); setError(studyError(e, 'No se pudo abrir la conversación. Reintenta.')) } else if (e?.message?.includes('ROOM_UNAVAILABLE')) { setChatState('error'); setMessages([]); setMembers([]); setError(studyError(e)) } else setNotice('No pudimos actualizar la conversación. Conservamos los mensajes que ya cargaron. Usa Actualizar para reintentar.') } }
    finally { if (chatLoading.current === revision) chatLoading.current = null }
  }
  async function mutate(action) {
    if (lock.current) return false
    lock.current = true; setBusy(true); onBusy(true); setError(''); setNotice('')
    try { await verify(); await action(); return true }
    catch (e) { if (alive.current) setError(studyError(e)); return false }
    finally { lock.current = false; onBusy(false); if (alive.current) setBusy(false) }
  }
  function enter(id) { listRevision.current++; scrolling.current = false; setLoadingOlder(false); setForm(null); setChatState('loading'); setRoomId(id); setRoom(null); setMessageDraft(''); submission.current = null; setConfirm(null); setError(''); setNotice('') }
  function back() { if (lock.current) return; setRoomId(null); setRoom(null); setConfirm(null); setError(''); setNotice(''); setMessages([]); setMembers([]); setInvite('') }
  function closeForm() { if (lock.current) return; setForm(null); setError(''); listAction.current?.focus({ preventScroll: true }) }
  async function create(e) {
    e.preventDefault(); const issue = validRoom(createDraft, courses)
    if (issue) { setError(issue); return }
    const fingerprint = JSON.stringify(createDraft)
    if (creation.current?.fingerprint !== fingerprint) creation.current = { fingerprint, id: crypto.randomUUID() }
    const ok = await mutate(async () => {
      const id = await rpc('create_study_room', { cid: createDraft.course, room_name: createDraft.name.trim(), room_description: createDraft.description.trim(), private_room: createDraft.private, display_name: createDraft.nickname.trim(), request_id: creation.current.id })
      if (!id) throw new Error('empty')
      if (alive.current) { creation.current = null; setCreateDraft(initialForm(course || courses[0]?.id || '')); enter(id) }
    })
    if (ok) setNotice('Sala creada. Ya puedes invitar a tus compañeros.')
  }
  async function join(e) {
    e.preventDefault()
    if (joinDraft.nickname.trim().length < 2) { setError('Elige un nombre de 2 a 40 caracteres para aparecer en la sala.'); return }
    if (!joinDraft.room && !/^[a-f0-9]{32}$/.test(cleanInvite(joinDraft.code))) { setError('Revisa el código de invitación de 32 caracteres.'); return }
    await mutate(async () => {
      const id = await rpc('join_study_room', { rid: joinDraft.room?.id || null, access_code: joinDraft.room ? null : cleanInvite(joinDraft.code), display_name: joinDraft.nickname.trim() })
      if (!id) throw new Error('empty')
      if (alive.current) { setJoinDraft({ code: '', nickname: '', room: null }); enter(id) }
    })
  }
  async function send(e) {
    e.preventDefault(); if (!messageDraft.trim() || messageDraft.trim().length > 1200) return
    const id = roomId, body = messageDraft.trim(), revision = chatRevision.current
    if (submission.current?.body !== body || submission.current?.room !== id) submission.current = { body, room: id, id: crypto.randomUUID() }
    const ok = await mutate(async () => {
      const response = await rpc('send_moderated_study_message', { rid: id, message_body: body, request_id: submission.current.id })
      if (!response?.allowed) throw new Error(response?.error || 'MESSAGE_FAILED')
      const result = response.messages
      if (!result?.[0]?.id) throw new Error('empty')
      if (alive.current && revision === chatRevision.current) { setMessages(previous => mergeMessages(previous, result)); setMessageDraft(''); submission.current = null; scrolling.current = false }
    })
    if (ok) { setNotice('Mensaje enviado.'); messageInput.current?.focus({ preventScroll: true }) }
  }
  async function earlier() {
    if (lock.current || loadingOlder || !messages.length) return
    const first = messages[0], id = roomId, revision = chatRevision.current
    setLoadingOlder(true); olderLoading.current = revision; scrolling.current = true
    const node = transcript.current, previousHeight = node?.scrollHeight || 0, previousTop = node?.scrollTop || 0
    try {
      const incoming = await rpc('read_study_messages', { rid: id, before_time: first.created_at, before_id: first.id })
      if (!alive.current || revision !== chatRevision.current) return
      setMessages(previous => mergeMessages(previous, incoming || [])); setOlder((incoming || []).length === MESSAGE_PAGE_SIZE)
      requestAnimationFrame(() => { if (node?.isConnected) node.scrollTop = node.scrollHeight - previousHeight + previousTop })
    } catch (e) { if (alive.current && revision === chatRevision.current) setError(studyError(e)) }
    finally { if (olderLoading.current === revision) olderLoading.current = null; if (alive.current && revision === chatRevision.current) setLoadingOlder(false) }
  }
  async function invitation(rotate = false) {
    await mutate(async () => { const result = await rpc('study_room_invite', { rid: roomId, rotate }); if (alive.current) { setInvite(result); setConfirm(null); setNotice(rotate ? 'Código renovado. El anterior ya no permite unirse.' : '') } })
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(invite); setNotice('Código copiado.') }
    catch { setNotice('No se pudo copiar automáticamente. Selecciona el código y cópialo.') }
  }
  async function depart() {
    await mutate(async () => { await rpc(confirm === 'close' ? 'close_study_room' : 'leave_study_room', { rid: roomId }); if (alive.current) { backAfterWrite(); setNotice(confirm === 'close' ? 'Sala cerrada.' : 'Saliste de la sala.') } })
  }
  function backAfterWrite() { setRoomId(null); setRoom(null); setMessages([]); setMembers([]); setInvite(''); setConfirm(null) }
  const feedback = <>{error && !form && <p className="sg-feedback" role="alert">{error}</p>}<p className="sg-status" role="status" aria-live="polite">{busy ? 'Guardando…' : notice}</p></>
  const formContents = form && <section className="blk sg-form" ref={formRef} aria-label={form === 'create' ? 'Crear sala de estudio' : 'Unirse a una sala'}><div className="sg-form-head"><h3>{form === 'create' ? 'Nueva sala' : joinDraft.room ? `Unirse a ${joinDraft.room.name}` : 'Unirse con código'}</h3><button className="hb" disabled={busy} aria-label="Cancelar formulario" onClick={closeForm}><Icon name="close"/></button></div><form onSubmit={form === 'create' ? create : join}><fieldset disabled={busy}>
    {form === 'create' ? <><label>Curso<select aria-label="Curso de la nueva sala" required value={createDraft.course} onChange={e => setCreateDraft({ ...createDraft, course: e.target.value })}>{courses.map(c => <option key={c.id} value={c.id}>{c.n}</option>)}</select></label><label>Nombre de la sala<input required minLength="2" maxLength="80" value={createDraft.name} onChange={e => setCreateDraft({ ...createDraft, name: e.target.value })}/></label><label>Descripción (opcional)<textarea rows="3" maxLength="500" value={createDraft.description} onChange={e => setCreateDraft({ ...createDraft, description: e.target.value })}/></label><label>Acceso<select aria-label="Acceso de la sala" value={createDraft.private ? 'private' : 'public'} onChange={e => setCreateDraft({ ...createDraft, private: e.target.value === 'private' })}><option value="public">Pública · cualquiera puede unirse</option><option value="private">Privada · solo con código</option></select></label><p className="sg-help">{createDraft.private ? 'Solo quienes reciban el código podrán encontrarla y entrar.' : 'Aparecerá en el listado de estudiantes con este curso.'}</p></> : !joinDraft.room && <label>Código de invitación<input required autoComplete="off" maxLength="40" value={joinDraft.code} onChange={e => setJoinDraft({ ...joinDraft, code: e.target.value })}/></label>}
    <label>Tu nombre en la sala<input required minLength="2" maxLength="40" value={form === 'create' ? createDraft.nickname : joinDraft.nickname} onChange={e => form === 'create' ? setCreateDraft({ ...createDraft, nickname: e.target.value }) : setJoinDraft({ ...joinDraft, nickname: e.target.value })}/></label><p className="sg-help">Este nombre aparecerá junto a tus mensajes. Tu correo y código de alumno no se muestran.</p>
    {error && <p className="sg-feedback" role="alert">{error}</p>}<div className="sg-actions"><button className="mk" type="submit">{busy ? 'Guardando…' : form === 'create' ? 'Crear sala' : 'Unirme'}</button><button className="h-btn" type="button" onClick={closeForm}>Cancelar</button></div>
  </fieldset></form></section>
  if (roomId) return <section className="sg" aria-label="Sala de estudio"><button className="h-btn sg-back" disabled={busy} onClick={back}><Icon name="left"/>Todas las salas</button>{feedback}
    {chatState === 'loading' ? <section className="blk sg-loading" role="status" aria-busy="true">Abriendo la conversación…</section> : chatState === 'error' ? <section className="blk"><h2>No se pudo abrir la sala</h2><button className="h-btn" onClick={() => { setError(''); setChatState('loading'); refreshChat(roomId, chatRevision.current, false) }}>Reintentar</button></section> : <><header className="sg-room-head" ref={headerRef} tabIndex="-1"><div><h2>{room.name}</h2><p>{courseName(room.course_id)} · {room.is_private ? 'Privada' : 'Pública'} · {room.member_count} {room.member_count === 1 ? 'participante' : 'participantes'}</p>{room.description && <p>{room.description}</p>}</div><button className="h-btn" disabled={busy || refreshing} onClick={async () => { setRefreshing(true); await refreshChat(roomId, chatRevision.current, true); setRefreshing(false) }}><Icon name="refresh"/>Actualizar</button></header><div className="sg-chat-grid"><section className="blk sg-chat"><div className="sg-transcript" ref={transcript} role="region" aria-label="Mensajes de la sala" tabIndex="0" onScroll={e => { const node = e.currentTarget; scrolling.current = node.scrollHeight - node.scrollTop - node.clientHeight > 90 }}>
      {older && <button className="h-btn sg-earlier" disabled={loadingOlder || busy} onClick={earlier}>{loadingOlder ? 'Cargando…' : 'Cargar mensajes anteriores'}</button>}
      {!messages.length && <div className="sg-chat-empty"><h3>La conversación empieza aquí</h3><p>Escribe el primer mensaje para organizar la sesión de estudio.</p></div>}
      <div className="sg-message-list" role="log" aria-label="Conversación" aria-live="polite" aria-relevant="additions">{messages.map(m => <article key={m.id} className={`sg-message${m.is_mine ? ' mine' : ''}`}><header><b>{m.is_mine ? 'Tú' : m.nickname}</b><time dateTime={m.created_at}>{when(m.created_at)}</time></header><p>{m.body}</p></article>)}</div>
    </div><form className="sg-compose" onSubmit={send}><label htmlFor="sg-message-input">Mensaje</label><textarea ref={messageInput} id="sg-message-input" rows="2" maxLength="1200" disabled={busy} placeholder="Escribe a tus compañeros…" value={messageDraft} onChange={e => setMessageDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!lock.current && messageDraft.trim()) send(e) } }}/><div><span>{messageDraft.length}/1200 · Mayús + Enter para nueva línea</span><button className="mk" disabled={busy || !messageDraft.trim()} type="submit"><Icon name="send"/>{busy ? 'Enviando…' : 'Enviar'}</button></div></form></section>
      <aside className="sg-room-side"><section className="blk"><h3>Participantes · {members.length}</h3><ul className="sg-members">{members.map((m, i) => <li key={m.joined_at + i}>{m.nickname}</li>)}</ul><p className="sg-help">Los mensajes se actualizan automáticamente.</p></section><section className="blk"><h3>Opciones de la sala</h3>{room.is_owner ? <><button className="h-btn" disabled={busy} onClick={() => invitation()}>Ver código de invitación</button>{invite && <div className="sg-invite"><label>Código de invitación<input readOnly value={invite} onFocus={e => e.target.select()}/></label><button className="h-btn" onClick={copyCode}>Copiar código</button><button className="h-btn" disabled={busy} onClick={() => setConfirm('rotate')}>Renovar código</button></div>}<button className="h-btn" disabled={busy} onClick={() => setConfirm('close')}>Cerrar sala</button></> : <button className="h-btn" disabled={busy} onClick={() => setConfirm('leave')}>Salir de la sala</button>}
      {confirm && <div className="sg-confirm" role="group" aria-label="Confirmar acción"><p>{confirm === 'rotate' ? 'El código anterior dejará de permitir nuevas entradas. Los participantes actuales conservarán su acceso.' : confirm === 'close' ? 'Se eliminarán la sala y todos sus mensajes para todos los participantes. Esta acción no se puede deshacer.' : 'Dejarás de ver la conversación. Podrás volver a unirte si tienes acceso a la sala.'}</p><button className="mk" disabled={busy} onClick={() => confirm === 'rotate' ? invitation(true) : depart()}>{confirm === 'rotate' ? 'Renovar código' : confirm === 'close' ? 'Confirmar cierre' : 'Confirmar salida'}</button><button className="h-btn" disabled={busy} onClick={() => setConfirm(null)}>Cancelar</button></div>}
      </section></aside></div></>}
  </section>
  return <section className="sg" aria-label="Grupos de estudio" onKeyDown={e => { if (e.key === 'Escape' && form && !busy) { e.stopPropagation(); closeForm() } }}><header className="sg-heading"><div><h2>Estudia en compañía</h2><p>Crea una sala para tu curso o únete a la de tus compañeros.</p></div><div className="sg-actions"><button className="h-btn" disabled={busy} onClick={() => { setForm('join'); setJoinDraft({ ...joinDraft, room: null }); setError('') }}>Unirse con código</button><button className="mk" ref={listAction} disabled={busy || !courses.length} onClick={() => { setForm('create'); setError('') }}><Icon name="plus"/>Crear sala</button></div></header>{feedback}
    <div className="sg-toolbar"><label className="sg-search"><Icon name="search"/><input aria-label="Buscar salas" placeholder="Buscar una sala…" value={query} onChange={e => setQuery(e.target.value)}/></label><label className="sg-course">Curso<select aria-label="Filtrar salas por curso" value={course} onChange={e => { setCourse(e.target.value); setPage(0) }}><option value="">Todos mis cursos</option>{courses.map(c => <option key={c.id} value={c.id}>{c.n}</option>)}</select></label><div className="seg" role="group" aria-label="Salas a mostrar">{[['all', 'Todas'], ['mine', 'Mis salas'], ['public', 'Públicas']].map(([id, text]) => <button key={id} aria-pressed={scope === id} className={scope === id ? 'on' : ''} onClick={() => { setScope(id); setPage(0) }}>{text}</button>)}</div></div>
    <div className={`sg-list-layout${form ? ' editing' : ''}`}>{formContents}<section className="blk sg-list" aria-busy={state === 'loading'}>
      {state === 'loading' ? <p className="sg-loading" role="status">Buscando salas…</p> : state === 'error' ? <div className="sg-empty"><h3>No pudimos cargar las salas</h3><p>Reintenta para consultar las salas disponibles.</p><button className="h-btn" onClick={loadRooms}>Reintentar</button></div> : !rooms.length ? <div className="sg-empty"><h3>{search || course || scope !== 'all' || page ? 'No hay salas con estos filtros' : 'Todavía no hay salas de estudio'}</h3><p>{search || course || scope !== 'all' || page ? 'Prueba otro curso, cambia los filtros o crea una sala.' : 'Puedes crear la primera para tu curso. Las salas aparecerán aquí cuando alguien las cree.'}</p>{Boolean(search || course || scope !== 'all' || page) && <button className="h-btn" onClick={() => { setQuery(''); setSearch(''); setCourse(''); setScope('all'); setPage(0) }}>Limpiar filtros</button>}</div> : rooms.map(r => <article className="sg-room-row" key={r.id}><div><span className="sg-room-label">{courseName(r.course_id)}{r.is_private && <><Icon name="lock"/>Privada</>}{r.is_owner && <span>Tu sala</span>}</span><h3>{r.name}</h3>{r.description && <p>{r.description}</p>}<small><Icon name="users"/>{r.member_count} {r.member_count === 1 ? 'participante' : 'participantes'}</small></div><button className={r.is_member ? 'h-btn' : 'mk'} disabled={busy} onClick={() => { if (r.is_member) enter(r.id); else { setJoinDraft({ ...joinDraft, room: r }); setForm('join'); setError('') } }}>{r.is_member ? 'Entrar' : 'Unirme'}<Icon name="right"/></button></article>)}
      {state === 'ready' && (page > 0 || rooms.length === ROOM_PAGE_SIZE) && <nav className="sg-pages" aria-label="Páginas de salas"><button className="h-btn" disabled={!page} onClick={() => setPage(p => p - 1)}>Anterior</button><span>Página {page + 1}</span><button className="h-btn" disabled={rooms.length < ROOM_PAGE_SIZE} onClick={() => setPage(p => p + 1)}>Siguiente</button></nav>}
    </section></div>
  </section>
}
export function mountOfficialStudyGroups(container, props) { const root = createRoot(container); root.render(<OfficialStudyGroups {...props}/>); return () => root.unmount() }

