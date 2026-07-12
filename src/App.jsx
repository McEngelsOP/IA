import { useState, useEffect } from 'react'
import { supabase } from './lib/supabaseClient'
import LoginPage from './components/LoginPage'
import MallaCurricular from './components/MallaCurricular'
import UpdatePassword from './components/UpdatePassword'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // true cuando el usuario llega desde el enlace de recuperación del correo
  const [recovering, setRecovering] = useState(false)
  // modo visitante: ver la malla sin cuenta (el avance no se guarda en la nube)
  const [guest, setGuest] = useState(false)

  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        setUser(session?.user || null)
      } catch (error) {
        console.error('Error checking session:', error)
      } finally {
        setLoading(false)
      }
    }

    checkSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          setRecovering(true)
        }
        setUser(session?.user || null)
      }
    )

    return () => subscription?.unsubscribe()
  }, [])

  if (loading) {
    return <div className="loading-container">Cargando...</div>
  }

  if (recovering) {
    return <UpdatePassword onDone={() => setRecovering(false)} />
  }

  if (user) {
    return <MallaCurricular user={user} onLogout={() => setUser(null)} />
  }

  if (guest) {
    return <MallaCurricular user={null} onLogout={() => setGuest(false)} />
  }

  return (
    <LoginPage
      onLogin={(userData) => setUser(userData)}
      onGuest={() => setGuest(true)}
    />
  )
}

export default App
