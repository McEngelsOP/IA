import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import '../styles/LoginPage.css'

export default function LoginPage({ onLogin }) {
  const [codigo, setCodigo] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Usar el código de alumno como email (supabase requiere email para auth)
      const email = `${codigo}@estudiante.esan.edu.pe`

      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (authError) throw authError

      // Guardar información del usuario en session
      onLogin(data.user)
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>Sílabo IA</h1>
          <p>Gestión de Cursos - ESAN</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label htmlFor="codigo">Código de Alumno</label>
            <input
              id="codigo"
              type="text"
              placeholder="ej: A00123456"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              placeholder="Ingresa tu contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
          </button>
        </form>

        <div className="login-footer">
          <p>¿Problemas para acceder?</p>
          <p className="contact">Contacta con sistemas: sistemas@esan.edu.pe</p>
        </div>
      </div>
    </div>
  )
}
