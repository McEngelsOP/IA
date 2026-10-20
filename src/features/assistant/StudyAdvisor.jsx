import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../shared/lib/supabaseClient.js'
import './StudyAdvisor.css'
import OfficialIcon from '../../shared/components/OfficialIcon.jsx'
import OfficialBot from './OfficialBot.jsx'
import { useLocalChats } from './useLocalChats.js'
import { selectHistory } from './localChats.mjs'
import AdvisorDraft from './AdvisorDraft.jsx'
import { normalizeAdvisorAnswer } from './advisorFormatting.mjs'

const INITIAL_MESSAGE = {
  role: 'assistant',
  content: 'Puedo ayudarte con tus cursos, agenda y tareas. Tus conversaciones se guardan solo en este dispositivo.'
}

const ERROR_MESSAGES = {
  personal_context_unavailable: 'No pude consultar tus datos personales. Reintenta; tu conversación se conserva.',
  invalid_history: 'No se pudo enviar este contexto. Prueba iniciar un nuevo chat.',
  request_failed: 'La consulta no se completó. Reintenta en un momento.',
  curriculum_version_mismatch: 'Tu revisión de malla aún no está disponible en el asesor. Puedes revisar los requisitos desde Mi carrera.',
  personal_configuration_missing: 'No tienes claves personales activas. Abre Mi IA en tu perfil o cambia al servicio de la app.',
  credentials_unavailable: 'No pudimos consultar tu configuración de IA. Reintenta.',
  user_rate_limited: 'Alcanzaste tu límite de consultas. Reintenta más tarde.',
  global_rate_limited: 'La cuota compartida está agotada. Puedes configurar tus claves en Mi IA.',
  configuration_missing: 'El asesor aún no está configurado en el servidor.',
  unauthorized: 'Tu sesión venció. Vuelve a iniciar sesión para consultar al asesor.',
  function_missing: 'El asesor aún no está disponible. Contacta al administrador.',
  model_unavailable: 'El modelo de IA del asesor no está disponible. Contacta al administrador.',
  invalid_model: 'El modelo de IA del asesor no está configurado correctamente.',
  provider_configuration: 'Los proveedores de IA rechazaron la configuración del asesor. Contacta al administrador.',
  rate_limited: 'Se alcanzó el límite de consultas del asesor. Inténtalo más tarde.',
  provider_timeout: 'Los servicios de IA tardaron demasiado en responder. Inténtalo de nuevo.',
  empty_response: 'Los servicios de IA no devolvieron una respuesta. Prueba reformular tu pregunta.'
}

export default function StudyAdvisor({ userId, planCourses, careerId, careerVersion, enrolledCourseIds = [], currentSemester, completedCredits = 0, careerName, onClose, embedded = false, client = supabase }) {
  const local = useLocalChats(userId)
  const {chat,setChat,ready,storageError}=local
  const messages=[INITIAL_MESSAGE,...chat.messages], draft=chat.draft||''
  const setMessages=update=>setChat(current=>({ ...current, messages:(typeof update==='function'?update([INITIAL_MESSAGE,...current.messages]):update).filter(m=>m!==INITIAL_MESSAGE) }))
  const setDraft=update=>setChat(current=>({...current,draft:typeof update==='function'?update(current.draft||''):update}))
  const [confirmClear,setConfirmClear]=useState(false)
  const [ratings, setRatings] = useState({})
  const [loadingRatings, setLoadingRatings] = useState(false)
  const [sending, setSending] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const requestLock = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const [copyStatus, setCopyStatus] = useState('')
  const [contextOpen, setContextOpen] = useState(false), [suggestionTab, setSuggestionTab] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!planCourses.length) {
      setRatings({}); setLoadingRatings(false)
      return
    }
    setLoadingRatings(true)
    Promise.all(planCourses.map(async course => {
      const { data, error } = await client.rpc('get_course_difficulty_stats', { cid: course.id })
      return [course.id, !error && data ? data : null]
    })).then(entries => {
      if (!cancelled) setRatings(Object.fromEntries(entries))
    }).catch(() => {
      if (!cancelled) setRatings({})
    }).finally(() => {
      if (!cancelled) setLoadingRatings(false)
    })
    return () => { cancelled = true }
  }, [planCourses, client])

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape' && !requestLock.current) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    if (!embedded || !window.matchMedia('(pointer:coarse)').matches) inputRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, sending])

  const summary = useMemo(() => {
    const credits = planCourses.reduce((total, course) => total + course.credits, 0)
    const rated = planCourses.filter(course => Number(ratings[course.id]?.total_votes) > 0)
    const ratedCredits = rated.reduce((total, course) => total + course.credits, 0)
    const weightedDifficulty = ratedCredits
      ? rated.reduce((total, course) => total + Number(ratings[course.id].avg_rating) * course.credits, 0) / ratedCredits
      : null
    return { credits, ratedCount: rated.length, weightedDifficulty }
  }, [planCourses, ratings])

  const sendMessage = async event => {
    event.preventDefault()
    const question = draft.trim()
    if (!ready || !userId || !question || question.length > 1200 || requestLock.current) return
    if(chat.messages.length>=298){setErrorMessage('Esta conversación alcanzó su límite local. Inicia un nuevo chat para continuar.');return}
    requestLock.current = true

    const userMessage = { role: 'user', content: question }
    const restoreQuestion = () => {
      if (!alive.current) return
      setMessages(current => current.filter(message => message !== userMessage))
      setDraft(current => current || question)
    }
    const previousMessages = selectHistory(chat.messages)
    setMessages(current => [...current, userMessage])
    setDraft('')
    setErrorMessage('')
    setSending(true)

    const courses = planCourses.map(course => {
      const stats = ratings[course.id]
      const votes = Number(stats?.total_votes || 0)
      return {
        id: course.id,
        name: course.name,
        credits: course.credits,
        difficultyAverage: votes > 0 ? Number(stats.avg_rating) : null,
        difficultyVotes: votes, prerequisites: course.prerequisites || []
      }
    })

    try {
      const verified=await client.auth.getUser()
      if(verified.error||verified.data.user?.id!==userId){restoreQuestion();setErrorMessage(ERROR_MESSAGES.unauthorized);return}
      const { data, error } = await client.functions.invoke('study-advisor', {
        body: { question, history: previousMessages, courses, careerId, careerName, careerVersion, completedCredits, enrolledCourseIds, currentSemester }
      })
      if (!alive.current) return
      const current=await client.auth.getUser()
      if(!alive.current)return
      if(current.error||current.data.user?.id!==userId){restoreQuestion();setErrorMessage(ERROR_MESSAGES.unauthorized);return}
      let errorCode = data?.error
      if (error && !errorCode) {
        try { errorCode = (await error.context?.json())?.error } catch { /* respuesta sin cuerpo JSON */ }
      }
      if (error || !data?.answer) {
        if (!errorCode) {
          const status = error?.context?.status
          if (status === 401) errorCode = 'unauthorized'
          if (status === 404) errorCode = 'function_missing'
          if (status === 429) errorCode = 'rate_limited'
        }
        restoreQuestion()
        setErrorMessage(ERROR_MESSAGES[errorCode] || 'No pude obtener una respuesta. Inténtalo de nuevo en un momento.')
        return
      }
      setMessages(current => [...current, { role: 'assistant', content: data.answer, proposal: data.draft || null, operationId: data.draft ? crypto.randomUUID() : null }])
    } catch {
      if (!alive.current) return
      restoreQuestion()
      setErrorMessage('No pude conectar con el asesor. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      requestLock.current = false
      if (alive.current) { setSending(false); if (!window.matchMedia('(pointer:coarse)').matches) inputRef.current?.focus() }
    }
  }

  const renderDraft = index => {
    const item=chat.messages[index]
    if(!item?.proposal)return null
    return <AdvisorDraft key={chat.id+index} operationId={item.operationId} beforeSave={local.flush} draft={item.proposal} saved={item.saved} client={client} userId={userId} onChange={(proposal,saved=false)=>setChat(current=>({...current,messages:current.messages.map((m,i)=>i===index?{...m,proposal,saved}:m)}))}/>
  }
  const historyControls=<><details className="advisor-history-panel"><summary>Historial de este dispositivo</summary><div className="advisor-history">
    <label>Chats de este dispositivo<select aria-label="Chats de este dispositivo" disabled={!ready||sending} value={chat.id} onChange={e=>{local.openChat(e.target.value);setErrorMessage('')}}>
      {!local.chats.some(c=>c.id===chat.id)&&<option value={chat.id}>Nuevo chat</option>}
      {local.chats.map(c=><option key={c.id} value={c.id}>{c.title||'Nuevo chat'}</option>)}
    </select></label>
    <button type="button" disabled={!ready||sending} onClick={()=>{local.newChat();setErrorMessage('')}}>Nuevo chat</button>
    <button type="button" disabled={!ready||sending||!local.chats.some(c=>c.id===chat.id)} onClick={()=>local.removeChat(chat.id)}>Eliminar chat</button>
    <button type="button" disabled={!ready||sending||!local.chats.length} onClick={()=>setConfirmClear(true)}>Borrar historial</button>
    {confirmClear&&<div className="advisor-clear" role="group" aria-label="Confirmar borrado local"><span>¿Borrar todos tus chats de este navegador?</span><button type="button" disabled={sending} onClick={async()=>{await local.clearChats();setConfirmClear(false)}}>Sí, borrar</button><button type="button" onClick={()=>setConfirmClear(false)}>Cancelar</button></div>}
  </div></details>{(!ready||storageError)&&<p role="status">{storageError||'Abriendo historial local…'}</p>}</>

  if (embedded === 'web') {
    const hasChat = messages.length > 1
    const hour = Number(new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
    const suggestions = [
      ['Sugeridas', 'spark', ['¿Qué tareas pendientes debería priorizar hoy?', '¿Qué tengo en mi agenda esta semana?', 'Crea un borrador de tarea para mi próxima entrega.']],
      ['Carga', 'trend', ['¿Esta combinación de cursos se ve pesada?', '¿Cuál de mis cursos exige más estudio semanal?', '¿Qué debería considerar para equilibrar mi próximo ciclo?']],
      ['Prerrequisitos', 'cap', ['¿Qué debería revisar sobre los prerrequisitos antes de matricularme?', '¿Cómo puedo verificar si mi plan es viable?']],
      ['Plan', 'clock', ['¿Cómo reparto mi tiempo de estudio esta semana?', 'Ármame un plan de estudio con bloques de Mod Focus de 45 minutos.']],
    ]
    const compose = <div className="a-cwrap">{!hasChat && <div className="a-bot"><OfficialBot/></div>}<form className="a-cmp" onSubmit={sendMessage}>
      {contextOpen && <div className="a-cbody" id="advisor-context"><div className="a-cx"><div className="a-cs"><span>Créditos</span><b>{summary.credits}</b></div><div className="a-cs"><span>Dificultad ponderada</span><b>{summary.weightedDifficulty?.toFixed(1) || '—'}<small>/5</small></b></div><div className="a-cs"><span>Cursos</span><b>{planCourses.length}</b></div></div><div className="a-cl">{planCourses.map(c => <span className="a-cc" key={c.id}><b>{c.name}</b><small>{c.credits} cr</small></span>)}</div><p className="a-cn">{loadingRatings ? 'Consultando votos…' : `${summary.ratedCount} de ${planCourses.length} cursos con votos`}. {careerName}. No enviamos tus notas ni tu código.</p><details className="a-prerequisites"><summary>Prerrequisitos registrados en tu plan</summary><ul>{planCourses.map(c => <li key={c.id}>{c.name}: {c.requirementNote || c.prerequisites?.map(r => typeof r === 'string' ? r : `${r.name} (${r.completed ? 'aprobado' : 'pendiente'})`).join(', ') || 'Sin prerrequisitos directos'}</li>)}</ul><p>Este detalle te ayuda a revisar el plan; la consulta al asesor incluye los requisitos registrados y los créditos aprobados.</p></details></div>}
      {errorMessage && <p className="a-error" role="alert">{errorMessage}</p>}
      <textarea ref={inputRef} value={draft} onChange={e => setDraft(e.target.value.slice(0, 1200))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} maxLength={1200} rows={2} placeholder={hasChat ? 'Escribe tu siguiente pregunta…' : 'Ej. ¿Esta combinación de cursos se ve pesada?'} aria-label="Pregunta para el asesor académico"/>
      <div className="a-cb"><button className={`a-chip${contextOpen ? ' on' : ''}`} type="button" aria-expanded={contextOpen} onClick={() => setContextOpen(o => !o)}><OfficialIcon name="cap" size={16}/>Mis cursos · {planCourses.length}</button><span className="a-sp"/><span className="a-cnt">{draft.length}/1200</span><button className="a-go" aria-label="Enviar pregunta" type="submit" disabled={!ready || !draft.trim() || sending}><OfficialIcon name="arrow" size={20}/></button></div>
    </form></div>
    const newChat = () => { if (sending) return; local.newChat(); setErrorMessage(''); setCopyStatus(''); inputRef.current?.focus() }
    const privacy = <p className="a-privacy">Chats solo en este dispositivo. El proveedor de IA recibe el contexto necesario. Borrar los datos del navegador elimina el historial.</p>
    return <section className={`official-advisor ${hasChat ? 'a-chatv' : 'a-page'}`} aria-label="Asesor IA">
      {historyControls}
      {hasChat ? <><div className="a-bar"><div className="a-id"><OfficialBot compact/><div><b>Asesor IA</b><small>{sending ? 'Analizando tu plan…' : 'Consulta académica'}</small></div></div><div className="a-tools"><button className="a-ib" aria-label="Nuevo chat" title="Nuevo chat" onClick={newChat} disabled={sending}><OfficialIcon name="plus"/></button><button className="a-ib" aria-label="Copiar conversación" title="Copiar conversación" disabled={sending} onClick={async () => { try { await navigator.clipboard.writeText(messages.slice(1).map(m => `${m.role === 'user' ? 'Tú' : 'Asesor'}: ${m.role === 'assistant' ? normalizeAdvisorAnswer(m.content) : m.content}`).join('\n\n')); setCopyStatus('Conversación copiada') } catch { setCopyStatus('No se pudo copiar. Selecciona el texto de la conversación.') } }}><OfficialIcon name="copy"/></button></div></div><p className="a-copy-status" role="status">{copyStatus}</p><div className="a-scroll" ref={listRef} role="log" aria-live="polite"><div className="a-msgs">{messages.slice(1).map((m, i) => m.role === 'user' ? <div className="a-um" key={i}>{m.content}</div> : <div className="a-bm" key={i}><OfficialBot compact/><div><div className="a-rep">{normalizeAdvisorAnswer(m.content)}</div>{renderDraft(i)}</div></div>)}{sending && <div className="a-bm"><OfficialBot compact/><p role="status">Analizando tu plan…</p></div>}</div></div>{compose}{privacy}</> : <><section className="a-hcard"><p className="a-greeting">{hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'}</p><h2 className="a-hi">Convierte tus <b>dudas</b> en un <b>plan</b></h2><p className="a-hs">Consulta tus pendientes, revisa tu agenda y organiza tu estudio.</p></section>{compose}{!planCourses.length && <p className="a-plan-empty">{enrolledCourseIds.length ? 'Tu matrícula actual aporta contexto. Añade cursos en Planificar para revisar el próximo semestre.' : 'Puedes consultar tu agenda y tareas; añade cursos en Planificar para revisar tu carga.'}</p>}<section className="a-sug" aria-label="Preguntas sugeridas"><div className="a-tabs" role="group" aria-label="Categorías de consulta">{suggestions.map(([label, icon], i) => <button className={`a-tab${suggestionTab === i ? ' on' : ''}`} aria-pressed={suggestionTab === i} key={label} onClick={() => setSuggestionTab(i)}><OfficialIcon name={icon} size={16}/>{label}</button>)}</div><div className="a-rows">{suggestions[suggestionTab][2].map(question => <button className="a-row" key={question} onClick={() => { setDraft(question); inputRef.current?.focus() }}><OfficialIcon name={suggestions[suggestionTab][1]}/><span>{question}</span><span className="go"><OfficialIcon name="arrow" size={16}/></span></button>)}</div></section>{privacy}</>}
    </section>
  }

  return (
    <div className="study-advisor-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="study-advisor" role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-labelledby="study-advisor-title">
        <header className="study-advisor-head">
          <div>
            <span className="study-advisor-kicker">Lyra · ASESOR ACADÉMICO</span>
            <h2 id="study-advisor-title">Tu próximo ciclo</h2>
          </div>
          <button className="study-advisor-close" onClick={onClose} aria-label="Cerrar asesor">×</button>
        </header>

        {historyControls}
        <div className="study-advisor-summary">
          <strong>{summary.credits} créditos</strong>
          <span>
            {summary.weightedDifficulty === null
              ? 'Sin votos de dificultad para estimar'
              : `Dificultad ponderada ${summary.weightedDifficulty.toFixed(1)}/5`}
          </span>
          <small>
            {loadingRatings
              ? 'Consultando estrellas…'
              : `${summary.ratedCount} de ${planCourses.length} cursos con votos · ${careerName}`}
          </small>
        </div>

        <div className="study-advisor-messages" ref={listRef} aria-live="polite">
          {messages.map((message, index) => (
            <div className={`study-advisor-message ${message.role}`} key={index}>
              {message.role === 'assistant' ? normalizeAdvisorAnswer(message.content) : message.content}{message.role==='assistant'&&renderDraft(index-1)}
            </div>
          ))}
          {sending && <div className="study-advisor-message assistant pending">Analizando tu plan…</div>}
          {planCourses.length === 0 && (
            <div className="study-advisor-empty">
              Puedes consultar tu agenda y tareas aunque todavía no tengas un plan de cursos.
            </div>
          )}
        </div>

        <form className="study-advisor-form" onSubmit={sendMessage}>
          {errorMessage && <div className="study-advisor-error" role="alert">{errorMessage}</div>}
          <label className="study-advisor-privacy">
            El historial permanece en este dispositivo. El proveedor de IA recibe tu pregunta, historial seleccionado y los datos personales necesarios; no guardamos chats en Supabase.
          </label>
          <div className="study-advisor-compose">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={event => setDraft(event.target.value.slice(0, 1200))}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder="Ej. ¿Esta combinación se ve pesada?"
              maxLength={1200}
              rows={2}
              aria-label="Pregunta para el asesor académico"
            />
            <button type="submit" disabled={!ready || !draft.trim() || sending}>
              {sending ? '…' : 'Enviar'}
            </button>
          </div>
          <span className="study-advisor-count">{draft.length}/1200 · La recomendación es orientativa</span>
        </form>
      </section>
    </div>
  )
}

