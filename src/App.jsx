import { useState, useEffect } from 'react'
import { supabase } from './lib/supabaseClient'
import { getTheme, applyTheme, saveTheme } from './lib/theme'
import LoginPage from './components/LoginPage'
import MallaCurricular from './components/MallaCurricular'
import UpdatePassword from './components/UpdatePassword'
import CareerSelect from './components/CareerSelect'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // true cuando el usuario llega desde el enlace de recuperación del correo
  const [recovering, setRecovering] = useState(false)
  // modo visitante: ver la malla sin cuenta (el avance no se guarda en la nube)
  const [guest, setGuest] = useState(false)
  const [guestCarrera, setGuestCarrera] = useState(null)
  // carrera del perfil: undefined = cargando · null = aún no elegida (cuenta
  // creada antes de que existieran carreras) · 'ia' | 'industrial'
  const [carrera, setCarrera] = useState(undefined)
  const [savingCarrera, setSavingCarrera] = useState(false)
  const [carreraError, setCarreraError] = useState('')
  // tema claro/oscuro: la elección persiste y es el modo de inicio siempre
  const [tema, setTema] = useState(getTheme)

  useEffect(() => { applyTheme(tema) }, [])

  const toggleTema = () => {
    const t = tema === 'dark' ? 'light' : 'dark'
    setTema(t)
    saveTheme(t)
  }

  // botón flotante para alternar el tema (el arcade lo tapa: allí no aplica)
  const themeBtn = (
    <button
      className="theme-toggle"
      onClick={toggleTema}
      title={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
    >
      {tema === 'dark' ? '☀️' : '🌙'}
    </button>
  )

  // Tiempo límite de inactividad/cierre (10 minutos)
  const INACTIVITY_LIMIT_MS = 10 * 60 * 1000

  useEffect(() => {
    let idleTimer = null

    const updateLastActive = () => {
      const now = Date.now()
      localStorage.setItem('app_last_active', now.toString())
    }

    const resetIdleTimer = () => {
      updateLastActive()
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(async () => {
        console.log('[auth] Sesión cerrada automáticamente por inactividad.')
        await supabase.auth.signOut()
        localStorage.removeItem('app_last_active')
        setUser(null)
      }, INACTIVITY_LIMIT_MS)
    }

    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const lastActiveStr = localStorage.getItem('app_last_active')
          const lastActive = lastActiveStr ? Number(lastActiveStr) : null
          const now = Date.now()

          if (lastActive && (now - lastActive > INACTIVITY_LIMIT_MS)) {
            console.log('[auth] Sesión cerrada: transcurrieron más de 10 min sin uso/cerrado.')
            await supabase.auth.signOut()
            localStorage.removeItem('app_last_active')
            setUser(null)
          } else {
            setUser(session.user)
            resetIdleTimer()
          }
        } else {
          setUser(null)
        }
      } catch (error) {
        console.error('Error checking session:', error)
      } finally {
        setLoading(false)
      }
    }

    checkSession()

    // Escuchar eventos de interacción del usuario para mantener la sesión viva mientras trabaja
    const activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    const handleUserActivity = () => {
      const lastActiveStr = localStorage.getItem('app_last_active')
      const now = Date.now()
      // Throttle de actualización a localStorage (máximo una vez cada 15 segundos)
      if (!lastActiveStr || now - Number(lastActiveStr) > 15000) {
        resetIdleTimer()
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        updateLastActive()
      } else if (document.visibilityState === 'visible') {
        // Al regresar a la pestaña, verificar si venció el tiempo
        checkSession()
      }
    }

    activityEvents.forEach(evt => window.addEventListener(evt, handleUserActivity, { passive: true }))
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          setRecovering(true)
        }
        if (event === 'SIGNED_IN') {
          updateLastActive()
          resetIdleTimer()
        }
        if (event === 'SIGNED_OUT') {
          localStorage.removeItem('app_last_active')
          if (idleTimer) clearTimeout(idleTimer)
        }
        setUser(session?.user || null)
      }
    )

    return () => {
      subscription?.unsubscribe()
      if (idleTimer) clearTimeout(idleTimer)
      activityEvents.forEach(evt => window.removeEventListener(evt, handleUserActivity))
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // Con sesión iniciada, la carrera vive en el perfil (no en los metadatos:
  // las cuentas creadas antes de que existieran carreras la eligen después)
  useEffect(() => {
    if (!user) {
      setCarrera(undefined)
      return
    }
    let cancelled = false
    setCarrera(undefined)
    supabase
      .from('profiles')
      .select('carrera')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('[profile:carrera]', error)
        setCarrera(data?.carrera ?? null)
      })
    return () => { cancelled = true }
  }, [user?.id])

  // Pantalla actual (la app no usa router: las vistas son estado de React)
  const screen = recovering ? 'recover'
    : user ? (carrera === undefined ? 'loading' : carrera ? 'malla' : 'career')
    : guest ? (guestCarrera ? 'guest-malla' : 'guest-career')
    : 'login'

  // Botón «Atrás» del navegador. Sin ayuda, como no hay router, «Atrás»
  // abandona el sitio de golpe (te «bota al inicio del navegador»). Mientras
  // estemos en una pantalla interna dejamos una entrada-trampa en el historial:
  // al retroceder volvemos a la pantalla anterior dentro de la app (malla de
  // visitante → elegir carrera → login) en lugar de salir. Con sesión iniciada,
  // «Atrás» simplemente no te expulsa del sitio (usa «Cerrar sesión» para eso).
  useEffect(() => {
    if (screen === 'login' || screen === 'recover' || screen === 'loading') return
    window.history.pushState({ appTrap: true }, '')
    const onPop = () => {
      if (guest && guestCarrera) setGuestCarrera(null)      // malla visitante → elegir carrera
      else if (guest) setGuest(false)                       // elegir carrera → login
      else window.history.pushState({ appTrap: true }, '')  // con sesión: no salir del sitio
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [screen])

  // Elección única de carrera para cuentas que aún no la tienen
  const saveCarrera = async (key) => {
    setCarreraError('')
    setSavingCarrera(true)
    const { error } = await supabase
      .from('profiles')
      .update({ carrera: key })
      .eq('id', user.id)
    setSavingCarrera(false)
    if (error) {
      console.error('[profile:carrera:save]', error)
      setCarreraError('No se pudo guardar tu carrera. Revisa tu conexión e inténtalo de nuevo.')
      return
    }
    setCarrera(key)
  }

  if (loading) {
    return <div className="loading-container">Cargando...</div>
  }

  if (recovering) {
    return <>{themeBtn}<UpdatePassword onDone={() => setRecovering(false)} /></>
  }

  if (user) {
    if (carrera === undefined) {
      return <div className="loading-container">Cargando...</div>
    }
    if (!carrera) {
      return <>{themeBtn}<CareerSelect onSelect={saveCarrera} saving={savingCarrera} error={carreraError} /></>
    }
    return (
      <>
        {themeBtn}
        <MallaCurricular
          key={carrera}
          user={user}
          carrera={carrera}
          onLogout={() => setUser(null)}
        />
      </>
    )
  }

  if (guest) {
    if (!guestCarrera) {
      return <>{themeBtn}<CareerSelect guest onSelect={setGuestCarrera} onBack={() => setGuest(false)} /></>
    }
    return (
      <>
        {themeBtn}
        <MallaCurricular
          key={guestCarrera}
          user={null}
          carrera={guestCarrera}
          onSwitchCarrera={() => setGuestCarrera(null)}
          onLogout={() => { setGuest(false); setGuestCarrera(null) }}
        />
      </>
    )
  }

  return (
    <>
      {themeBtn}
      <LoginPage
        onLogin={(userData) => setUser(userData)}
        onGuest={() => setGuest(true)}
      />
    </>
  )
}

export default App
