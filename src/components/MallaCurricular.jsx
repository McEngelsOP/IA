import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import '../styles/MallaCurricular.css'

export default function MallaCurricular({ user, onLogout }) {
  const [userInfo, setUserInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        // Aquí puedes hacer consultas a Supabase para obtener:
        // - Información del estudiante
        // - Cursos completados
        // - Cursos disponibles
        // - Dependencias entre cursos
        setLoading(false)
      } catch (error) {
        console.error('Error:', error)
        setLoading(false)
      }
    }

    fetchUserInfo()
  }, [user])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    onLogout()
  }

  if (loading) {
    return <div className="loading">Cargando malla curricular...</div>
  }

  return (
    <div className="malla-container">
      <header className="malla-header">
        <div className="header-content">
          <h1>Ingeniería en IA - Malla Curricular</h1>
          <p>ESAN</p>
        </div>
        <div className="header-user">
          <span>{user?.email}</span>
          <button onClick={handleLogout} className="logout-button">
            Cerrar Sesión
          </button>
        </div>
      </header>

      <main className="malla-main">
        <div className="malla-content">
          <h2>Bienvenido a tu Malla Curricular</h2>
          <p>Aquí se mostrará:</p>
          <ul>
            <li>Cursos ya llevados ✓</li>
            <li>Cursos disponibles para llevar</li>
            <li>Cursos bloqueados (esperando requisitos)</li>
            <li>Dependencias entre cursos</li>
          </ul>

          <div className="placeholder">
            <p>Visualización de malla en construcción...</p>
            <p>Próximamente se integrará la malla curricular interactiva</p>
          </div>
        </div>
      </main>
    </div>
  )
}
