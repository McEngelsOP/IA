import { useState, useEffect } from 'react'
import { supabase } from './lib/supabaseClient'
import LoginPage from './components/LoginPage'
import MallaCurricular from './components/MallaCurricular'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

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

    const { data: { subscription } } = supabase.auth.onAuthStateChanged(
      (_event, session) => {
        setUser(session?.user || null)
      }
    )

    return () => subscription?.unsubscribe()
  }, [])

  if (loading) {
    return <div className="loading-container">Cargando...</div>
  }

  return (
    <>
      {user ? (
        <MallaCurricular
          user={user}
          onLogout={() => setUser(null)}
        />
      ) : (
        <LoginPage
          onLogin={(userData) => setUser(userData)}
        />
      )}
    </>
  )
}

export default App
