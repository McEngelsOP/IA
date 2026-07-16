import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { CARRERAS, CARRERA_KEYS } from '../data/carreras'
import '../styles/LoginPage.css'

// Resuelve el código de alumno en el servidor (Edge Function auth-by-code).
// El navegador nunca recibe el correo completo de nadie: solo la sesión o
// el correo ya enmascarado, según la acción.
const authByCode = async (action, payload = {}) => {
  const { data, error } = await supabase.functions.invoke('auth-by-code', {
    body: { action, ...payload }
  })
  if (error) throw error
  return data
}

// Código de alumno: exactamente 8 dígitos. La regla depende de la universidad:
// - ESAN: los dos primeros son la promoción, desde 25 hasta el año en curso.
// - PUCP: empieza con 20 (año de ingreso 20xx).
const isValidStudentCode = (code, carrera) => {
  if (!/^\d{8}$/.test(code)) return false
  if (carrera === 'pucp-mecatronica') return code.startsWith('20')
  const promo = Number(code.slice(0, 2))
  return promo >= 25 && promo <= new Date().getFullYear() % 100
}

// Enmascara el correo para mostrarlo sin exponerlo completo: ju•••@gmail.com
const maskEmail = (email) => {
  const [user, domain] = email.split('@')
  return `${user.slice(0, 2)}•••@${domain}`
}

// Extrae un mensaje legible de cualquier forma de error de Supabase
const errorMessage = (err, fallback) => {
  console.error('[auth]', err) // deja el error completo en la consola del navegador
  const msg =
    err?.message || err?.error_description || err?.error || err?.msg
  if (typeof msg === 'string' && msg.trim() && msg.trim() !== '{}') return msg
  return fallback
}

export default function LoginPage({ onLogin, onGuest }) {
  const [mode, setMode] = useState('login') // 'login' | 'register' | 'forgot'
  const [codigo, setCodigo] = useState('')
  const [carrera, setCarrera] = useState('') // solo en registro; queda fija en el perfil
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Código con correo pendiente de confirmar, para poder reenviar el enlace
  const [unconfirmedCode, setUnconfirmedCode] = useState(null)
  // true cuando el código que intentan registrar ya tiene una cuenta (posible suplantación)
  const [codeTaken, setCodeTaken] = useState(false)

  // En registro forzamos el formato (8 dígitos); en login/recuperación se deja libre
  // para no bloquear a alguien que ya tenga una cuenta con un código anterior.
  const handleCodigoChange = (e) => {
    const raw = e.target.value
    setCodigo(mode === 'register' ? raw.replace(/\D/g, '').slice(0, 8) : raw)
  }

  const switchMode = (next) => {
    setMode(next)
    setError('')
    setNotice('')
    setPassword('')
    setConfirm('')
    setCarrera('')
    setUnconfirmedCode(null)
    setCodeTaken(false)
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setUnconfirmedCode(null)
    setLoading(true)

    try {
      const res = await authByCode('login', { code: codigo, password })

      if (res.error === 'code_not_found') {
        setError('Código no registrado. Si es tu primera vez, crea tu cuenta abajo.')
        return
      }
      if (res.error === 'email_not_confirmed') {
        setUnconfirmedCode(codigo)
        setError('Aún no confirmas tu correo. Revisa tu bandeja (y spam) o reenvía el enlace.')
        return
      }
      if (res.error === 'invalid_credentials') {
        setError('Contraseña incorrecta. ¿La olvidaste? Recupérala abajo.')
        return
      }
      if (!res.ok) {
        setError(res.message || 'Error al iniciar sesión')
        return
      }

      const { data, error: sessionError } = await supabase.auth.setSession(res.session)
      if (sessionError) throw sessionError
      onLogin(data.user)
    } catch (err) {
      setError(errorMessage(err, 'Error al iniciar sesión'))
    } finally {
      setLoading(false)
    }
  }

  const handleResendConfirmation = async () => {
    if (!unconfirmedCode) return
    setError('')
    setLoading(true)
    try {
      const res = await authByCode('resend', { code: unconfirmedCode })
      if (!res.ok) throw new Error(res.message || 'No se pudo reenviar el correo')
      setNotice(`Te reenviamos el enlace a ${res.masked}.`)
    } catch (err) {
      setError(err.message || 'No se pudo reenviar el correo')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setCodeTaken(false)

    // La carrera va primero: la regla del código depende de la universidad
    if (!CARRERAS[carrera]) {
      setError('Elige tu carrera para armar tu malla.')
      return
    }
    if (!isValidStudentCode(codigo.trim(), carrera)) {
      setError('Ese código de alumno no es válido.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())) {
      setError('Ingresa un correo válido (lo usarás para recuperar tu contraseña)')
      return
    }
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
      // Evita registros duplicados del mismo código
      const { exists } = await authByCode('exists', { code: codigo })
      if (exists) {
        setCodeTaken(true)
        setError('Este código de alumno ya tiene una cuenta.')
        return
      }

      const { data, error: authError } = await supabase.auth.signUp({
        email: correo.trim().toLowerCase(),
        password,
        options: {
          data: { student_code: codigo.trim().toUpperCase(), carrera }
        }
      })

      if (authError) throw authError

      // Con la confirmación por correo activada, Supabase no da error si el
      // correo ya tiene cuenta (para no delatar correos registrados): devuelve
      // un usuario "fantasma" sin identidades y no crea ni envía nada.
      if (data.user?.identities?.length === 0) {
        setError('Ese correo ya está registrado con otra cuenta.')
        return
      }

      if (data.session) {
        onLogin(data.user)
      } else {
        switchMode('login')
        setNotice(
          `Cuenta creada. Te enviamos un enlace a ${maskEmail(correo.trim())} — confírmalo antes de iniciar sesión.`
        )
      }
    } catch (err) {
      if (err.message === 'User already registered') {
        setError('Ese correo ya está registrado con otra cuenta.')
      } else if (/rate limit/i.test(err.message || '')) {
        setError('Se alcanzó el límite de correos por hora. Espera un momento antes de reintentar.')
      } else if (/Database error|Error sending/i.test(err.message || '')) {
        setError('La cuenta pudo crearse pero falló el envío del correo. Revisa la configuración SMTP.')
      } else {
        setError(errorMessage(err, 'Error al crear la cuenta'))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)

    try {
      const res = await authByCode('recover', { code: codigo, origin: window.location.origin })
      if (res.error === 'code_not_found') {
        setError('No encontramos una cuenta con ese código.')
        return
      }
      if (!res.ok) throw new Error(res.message || 'No se pudo enviar el correo de recuperación')

      setNotice(`Te enviamos un enlace de recuperación a ${res.masked}. Revisa tu bandeja (y spam).`)
    } catch (err) {
      setError(errorMessage(err, 'No se pudo enviar el correo de recuperación'))
    } finally {
      setLoading(false)
    }
  }

  const copy = {
    login: {
      title: 'Inicia sesión',
      sub: 'Accede con tu código de alumno para ver tu progreso, los cursos que te faltan y qué te abre cada uno.',
      btn: 'INGRESAR',
      submit: handleLogin
    },
    register: {
      title: 'Crea tu cuenta',
      sub: 'Primera vez aquí: ingresa tu código, tu correo (para recuperar tu contraseña si la olvidas) y elige una contraseña.',
      btn: 'Crear cuenta y entrar',
      submit: handleRegister
    },
    forgot: {
      title: 'Recupera tu contraseña',
      sub: 'Ingresa tu código de alumno y te enviaremos un enlace de recuperación al correo con el que te registraste.',
      btn: 'Enviarme el enlace',
      submit: handleForgot
    }
  }[mode]

  return (
    <div className="login-page">
      {/* Panel izquierdo: formulario */}
      <div className="login-left">
        <div className="login-brand mono">
          ESAN · PUCP — INGENIERÍAS
        </div>

        <div className="login-form-wrap">
          <p className="login-eyebrow mono">MALLA CURRICULAR INTERACTIVA</p>
          <h1 className="login-title">{copy.title}</h1>
          <p className="login-sub">{copy.sub}</p>

          <form onSubmit={copy.submit} noValidate>
            <div className="field">
              <label htmlFor="codigo" className="mono">CÓDIGO DE ALUMNO</label>
              <input
                id="codigo"
                type="text"
                inputMode="numeric"
                placeholder={mode === 'register' ? '8 dígitos' : 'Tu código de alumno'}
                value={codigo}
                onChange={handleCodigoChange}
                disabled={loading}
                autoComplete="username"
                required
              />
            </div>

            {mode === 'register' && (
              <div className="field">
                <label htmlFor="carrera" className="mono">CARRERA</label>
                <select
                  id="carrera"
                  value={carrera}
                  onChange={(e) => setCarrera(e.target.value)}
                  disabled={loading}
                  required
                >
                  <option value="" disabled>Elige tu carrera</option>
                  {CARRERA_KEYS.map(k => (
                    <option key={k} value={k}>{CARRERAS[k].nombre} · {CARRERAS[k].uni}</option>
                  ))}
                </select>
              </div>
            )}

            {mode === 'register' && (
              <div className="field">
                <label htmlFor="correo" className="mono">CORREO DE RECUPERACIÓN</label>
                <input
                  id="correo"
                  type="email"
                  placeholder="tucorreo@gmail.com"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  disabled={loading}
                  autoComplete="email"
                  required
                />
              </div>
            )}

            {mode !== 'forgot' && (
              <div className="field">
                <label htmlFor="password" className="mono">
                  {mode === 'login' ? 'CONTRASEÑA' : 'NUEVA CONTRASEÑA'}
                </label>
                <input
                  id="password"
                  type="password"
                  placeholder={mode === 'login' ? '••••••••' : 'Mínimo 6 caracteres'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
              </div>
            )}

            {mode === 'register' && (
              <div className="field">
                <label htmlFor="confirm" className="mono">CONFIRMAR CONTRASEÑA</label>
                <input
                  id="confirm"
                  type="password"
                  placeholder="Repite tu contraseña"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                  required
                />
              </div>
            )}

            {error && (
              <div className="login-error">
                {error}
                {unconfirmedCode && (
                  <>
                    {' '}
                    <button type="button" className="link-btn" onClick={handleResendConfirmation}>
                      Reenviar enlace
                    </button>
                  </>
                )}
                {codeTaken && (
                  <>
                    {' '}Si no fuiste tú, escribe a{' '}
                    <a href="mailto:hernandengels@gmail.com">hernandengels@gmail.com</a> para resolverlo.
                  </>
                )}
              </div>
            )}
            {notice && <div className="login-notice">{notice}</div>}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Procesando…' : copy.btn}
            </button>
          </form>

          {mode === 'login' && (
            <>
              <button type="button" className="guest-btn" onClick={onGuest}>
                Explorar como visitante →
              </button>
              <p className="login-help">
                ¿Primera vez?{' '}
                <button type="button" className="link-btn" onClick={() => switchMode('register')}>
                  Crea tu cuenta
                </button>
                {' · '}
                <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>
                  Olvidé mi contraseña
                </button>
              </p>
            </>
          )}
          {mode !== 'login' && (
            <p className="login-help">
              <button type="button" className="link-btn" onClick={() => switchMode('login')}>
                ← Volver a iniciar sesión
              </button>
            </p>
          )}
          {mode !== 'forgot' && (
            <p className="login-note">
              ¿Escribiste mal tu correo? Avisa a{' '}
              <a href="mailto:hernandengels@gmail.com">hernandengels@gmail.com</a>{' '}
              para liberarlo y volver a registrarte.
            </p>
          )}
        </div>

        <div className="login-foot mono">ING. EN IA · ING. INDUSTRIAL · COMUNICACIÓN Y MKT. DIGITAL · MECATRÓNICA (PUCP)</div>
      </div>

      {/* Panel derecho: visual estilo malla */}
      <div className="login-right" aria-hidden="true">
        <svg
          className="malla-art"
          viewBox="0 0 640 800"
          preserveAspectRatio="xMidYMid slice"
        >
          <g className="edges">
            <path d="M150 180 C 260 180, 240 300, 350 300" />
            <path d="M150 180 C 280 190, 250 430, 350 430" />
            <path d="M150 320 C 250 320, 260 310, 350 300" />
            <path d="M350 300 C 460 300, 440 210, 540 210" />
            <path d="M350 300 C 470 310, 430 470, 540 470" />
            <path d="M350 430 C 460 430, 450 475, 540 470" />
            <path d="M150 560 C 260 560, 250 435, 350 430" />
            <path d="M350 560 C 460 560, 450 610, 540 610" />
            <path d="M150 560 C 250 565, 260 555, 350 560" />
          </g>

          <g className="nodes">
            <g transform="translate(70,150)">
              <rect width="160" height="60" rx="12" className="node done" />
              <text x="16" y="27">Cálculo I</text>
              <text x="16" y="45" className="cred">5 CRÉD · LLEVADO</text>
            </g>
            <g transform="translate(70,290)">
              <rect width="160" height="60" rx="12" className="node done" />
              <text x="16" y="27">Programación I</text>
              <text x="16" y="45" className="cred">4 CRÉD · LLEVADO</text>
            </g>
            <g transform="translate(70,530)">
              <rect width="160" height="60" rx="12" className="node done" />
              <text x="16" y="27">Matemática Discreta</text>
              <text x="16" y="45" className="cred">4 CRÉD · LLEVADO</text>
            </g>

            <g transform="translate(270,270)">
              <rect width="160" height="60" rx="12" className="node open" />
              <text x="16" y="27">Cálculo II</text>
              <text x="16" y="45" className="cred">5 CRÉD · DISPONIBLE</text>
            </g>
            <g transform="translate(270,400)">
              <rect width="160" height="60" rx="12" className="node open" />
              <text x="16" y="27">Programación II</text>
              <text x="16" y="45" className="cred">3 CRÉD · DISPONIBLE</text>
            </g>
            <g transform="translate(270,530)">
              <rect width="160" height="60" rx="12" className="node open" />
              <text x="16" y="27">Estadística I</text>
              <text x="16" y="45" className="cred">4 CRÉD · DISPONIBLE</text>
            </g>

            <g transform="translate(460,180)">
              <rect width="160" height="60" rx="12" className="node locked" />
              <text x="16" y="27">Ecuaciones Dif.</text>
              <text x="16" y="45" className="cred">3 CRÉD · BLOQUEADO</text>
            </g>
            <g transform="translate(460,440)">
              <rect width="160" height="60" rx="12" className="node locked" />
              <text x="16" y="27">Fund. de ML</text>
              <text x="16" y="45" className="cred">4 CRÉD · BLOQUEADO</text>
            </g>
            <g transform="translate(460,580)">
              <rect width="160" height="60" rx="12" className="node locked" />
              <text x="16" y="27">Optimización I</text>
              <text x="16" y="45" className="cred">3 CRÉD · BLOQUEADO</text>
            </g>
          </g>
        </svg>

        <div className="right-caption">
          <p className="mono">TOCA UN CURSO PARA VER SU CADENA</p>
          <h2>Un vistazo a tu malla,<br />curso por curso :3</h2>
        </div>
      </div>
    </div>
  )
}
