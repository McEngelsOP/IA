import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import '../styles/LoginPage.css'

// Pantalla a la que llega el alumno desde el enlace de recuperación del correo
export default function UpdatePassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      onDone()
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la contraseña')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-left" style={{ flex: '1 1 100%' }}>
        <div className="login-brand mono">
          UNIVERSIDAD ESAN · INGENIERÍA EN IA
        </div>

        <div className="login-form-wrap">
          <p className="login-eyebrow mono">RECUPERACIÓN DE CUENTA</p>
          <h1 className="login-title">Nueva contraseña</h1>
          <p className="login-sub">
            Elige tu nueva contraseña. Al guardarla entrarás directo a tu malla.
          </p>

          <form onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="new-password" className="mono">NUEVA CONTRASEÑA</label>
              <input
                id="new-password"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="confirm-password" className="mono">CONFIRMAR CONTRASEÑA</label>
              <input
                id="confirm-password"
                type="password"
                placeholder="Repite tu contraseña"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
                required
              />
            </div>

            {error && <div className="login-error">{error}</div>}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Guardando…' : 'Guardar y entrar'}
            </button>
          </form>
        </div>

        <div className="login-foot mono">PLAN 200 CRÉDITOS · 10 CICLOS</div>
      </div>
    </div>
  )
}
