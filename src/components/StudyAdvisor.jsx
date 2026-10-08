import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import '../styles/StudyAdvisor.css'

const INITIAL_MESSAGE = {
  role: 'assistant',
  content: 'Puedo ayudarte a evaluar la carga de tu próximo ciclo usando los créditos y las calificaciones de dificultad de los cursos. ¿Qué te gustaría saber?'
}

const ERROR_MESSAGES = {
  configuration_missing: 'El asesor aún no está configurado en el servidor.',
  unauthorized: 'Tu sesión venció. Vuelve a iniciar sesión para consultar al asesor.',
  function_missing: 'El asesor aún no está disponible. Contacta al administrador.',
  model_unavailable: 'El modelo de IA del asesor no está disponible. Contacta al administrador.',
  invalid_model: 'El modelo de IA del asesor no está configurado correctamente.',
  provider_configuration: 'Google rechazó la configuración del asesor. Contacta al administrador.',
  rate_limited: 'Se alcanzó el límite de consultas del asesor. Inténtalo más tarde.',
  provider_timeout: 'Google tardó demasiado en responder. Inténtalo de nuevo.',
  empty_response: 'Google no devolvió una respuesta. Prueba reformular tu pregunta.'
}

export default function StudyAdvisor({ planCourses, careerName, onClose, embedded = false }) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE])
  const [draft, setDraft] = useState('')
  const [ratings, setRatings] = useState({})
  const [loadingRatings, setLoadingRatings] = useState(false)
  const [sending, setSending] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const listRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    if (!planCourses.length) {
      setRatings({})
      return
    }
    setLoadingRatings(true)
    Promise.all(planCourses.map(async course => {
      const { data, error } = await supabase.rpc('get_course_difficulty_stats', { cid: course.id })
      return [course.id, !error && data ? data : null]
    })).then(entries => {
      if (!cancelled) setRatings(Object.fromEntries(entries))
    }).catch(() => {
      if (!cancelled) setRatings({})
    }).finally(() => {
      if (!cancelled) setLoadingRatings(false)
    })
    return () => { cancelled = true }
  }, [planCourses])

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    inputRef.current?.focus()
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
    if (!question || sending) return

    const userMessage = { role: 'user', content: question }
    const previousMessages = messages
      .filter(message => message !== INITIAL_MESSAGE)
      .slice(-6)
      .map(({ role, content }) => ({ role, content }))
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
        difficultyVotes: votes
      }
    })

    try {
      const { data, error } = await supabase.functions.invoke('study-advisor', {
        body: { question, history: previousMessages, courses, careerName }
      })
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
        setErrorMessage(ERROR_MESSAGES[errorCode] || 'No pude obtener una respuesta. Inténtalo de nuevo en un momento.')
        return
      }
      setMessages(current => [...current, { role: 'assistant', content: data.answer }])
    } catch {
      setErrorMessage('No pude conectar con el asesor. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="study-advisor-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="study-advisor" role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-labelledby="study-advisor-title">
        <header className="study-advisor-head">
          <div>
            <span className="study-advisor-kicker">LESAN · ASESOR ACADÉMICO</span>
            <h2 id="study-advisor-title">Tu próximo ciclo</h2>
          </div>
          <button className="study-advisor-close" onClick={onClose} aria-label="Cerrar asesor">×</button>
        </header>

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
              {message.content}
            </div>
          ))}
          {sending && <div className="study-advisor-message assistant pending">Analizando tu plan…</div>}
          {planCourses.length === 0 && (
            <div className="study-advisor-empty">
              Primero agrega cursos en el Planificador para recibir una recomendación sobre tu carga.
            </div>
          )}
        </div>

        <form className="study-advisor-form" onSubmit={sendMessage}>
          {errorMessage && <div className="study-advisor-error" role="alert">{errorMessage}</div>}
          <label className="study-advisor-privacy">
            Al enviar, Google Gemini recibe tu pregunta y los cursos de este plan con sus estrellas agregadas. No enviamos tus notas ni tu código.
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
            <button type="submit" disabled={!draft.trim() || sending}>
              {sending ? '…' : 'Enviar'}
            </button>
          </div>
          <span className="study-advisor-count">{draft.length}/1200 · La recomendación es orientativa</span>
        </form>
      </section>
    </div>
  )
}
