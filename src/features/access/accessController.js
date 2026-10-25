import { isEsanStudentCode } from '../../institutions/esan/config.js'
import { initializeAccessBackground } from './accessBackground.js'
import { getSupabaseClient } from '../../shared/lib/getSupabaseClient.js'
import { createWebSessionGuard, webAuthStorageKey } from '../../shared/lib/webSession.js'
import { CAREER_OPTIONS, CAREER_KEYS, careerLabel } from '../../institutions/esan/careerOptions.js'

const $ = id => document.getElementById(id)
const panel = document.querySelector('.panel')
const screens = ['loginScreen', 'registerScreen', 'forgotScreen', 'mailScreen', 'resetScreen'].map($)
const reduce = matchMedia('(prefers-reduced-motion: reduce)')
const destination = new URL('./pagina.html', location.href).href
const callback = new URL('./login.html', location.href).href
const params = new URLSearchParams(location.hash.slice(1))
const query = new URLSearchParams(location.search)
const support = 'solopcional16@gmail.com'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let recovering = params.get('type') === 'recovery' || query.get('type') === 'recovery'
let busy = false, transitioning = false, checkingSession = true, acceptedSession = false
let unconfirmedCode = null, mailCode = '', mailKind = 'recovery', resendAt = 0
let client = null
for (const key of CAREER_KEYS) $('registerCareer').add(new Option(careerLabel(key), key))

try {
  client = getSupabaseClient()
} catch { /* Configuration failures are shown without exposing credentials. */ }

const webSession = client ? createWebSessionGuard(client, {
  authKey: webAuthStorageKey(),
  onLock: () => { checkingSession = true; acceptedSession = false; clearPasswords(); setBusy(false) },
  onExpired: reason => location.replace(new URL('./login.html?reason=' + reason, location.href).href),
}) : null

let fitFrame = 0
function scheduleFit() {
  if (!fitFrame) fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitViewport() })
}
function fitViewport() {
  const viewport = window.visualViewport
  const height = Math.min(window.innerHeight, viewport?.height || window.innerHeight)
  document.documentElement.style.setProperty('--access-height', `${height}px`)
  document.documentElement.style.setProperty('--access-top', `${viewport?.offsetTop || 0}px`)
  const extreme = height < 520 || height < window.innerHeight - 100
  document.body.dataset.extreme = String(extreme)
  // CSS determines the panel and controls before the first paint. Only the
  // visual viewport (virtual keyboard / zoom) needs runtime geometry.
}
window.addEventListener('resize', scheduleFit)
window.visualViewport?.addEventListener('resize', scheduleFit)
window.visualViewport?.addEventListener('scroll', scheduleFit)
fitViewport()

function state() { return document.body.dataset.state }
function feedback(text, kind = 'info', shouldFit = true) {
  const screen = $(state())
  const container = screen.querySelector('form') || screen
  const el = $('formMessage')
  container.insertBefore(el, container.querySelector('.primary, .secondary'))
  el.textContent = text; el.dataset.kind = kind; el.hidden = !text
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status')
  el.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite')
  panel.classList.toggle('has-message', !!text)
  if (shouldFit) scheduleFit()
}
function foot() {
  const help = `<a href="mailto:${support}">${support}</a>`
  $('entryInfo').hidden = state() !== 'loginScreen'
  $('accessHint').innerHTML = ({
    registerScreen: `¿Escribiste mal tu correo? Avisa a ${help} para liberarlo y volver a registrarte.`,
    forgotScreen: `¿Ya no tienes acceso a ese correo? Escribe a ${help}.`,
    mailScreen: '¿No llega? Revisa spam o correo no deseado.',
    resetScreen: 'Tu contraseña anterior dejará de funcionar.'
  })[state()] || 'Inicia sesión con tu cuenta universitaria.'
}
async function show(id, animate = true) {
  const next = $(id), old = screens.find(el => !el.hidden)
  if (next === old || transitioning) return
  transitioning = true
  if (old && animate && !reduce.matches) { old.classList.add('screen-exit'); await delay(320) }
  screens.forEach(el => { el.hidden = el !== next; el.classList.remove('entrance', 'screen-exit') })
  const shouldAnimate = animate && !reduce.matches
  document.body.dataset.state = id; foot(); panel.classList.remove('has-message')
  feedback('', 'info', false)
  document.querySelector('.stage').scrollTop = 0
  fitViewport()
  if (shouldAnimate) {
    next.classList.add('entrance')
    next.addEventListener('animationend', event => {
      if (event.target !== next) return
      next.classList.remove('entrance')
    }, { once: true })
  }
  transitioning = false
  next.querySelector('h1, h2')?.focus({ preventScroll: true })
}
function updateResend() {
  const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000))
  $('resendLink').textContent = seconds ? `Reenviar enlace en ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Reenviar enlace'
  $('resendLink').disabled = busy || checkingSession || seconds > 0
}
function setBusy(value, label) {
  busy = value
  panel.querySelectorAll('form').forEach(form => form.setAttribute('aria-busy', String(value)))
  panel.querySelectorAll('input, select, button').forEach(el => { el.disabled = value || checkingSession })
  if (!value) panel.querySelectorAll('form [type="submit"]').forEach(button => {
    button.firstChild.textContent = `${button.dataset.label || 'Ingresar'} `
  })
  const form = screens.find(el => !el.hidden)?.querySelector('form')
  const button = form?.querySelector('[type="submit"]')
  if (button) button.firstChild.textContent = value ? label || 'Un momento…' : `${button.dataset.label || 'Ingresar'} `
  updateResend()
}
function clearPasswords() {
  for (const id of ['password', 'registerPassword', 'registerConfirm', 'newPassword', 'newConfirm']) { $(id).value = ''; $(id).type = 'password' }
  panel.querySelectorAll('[data-password]').forEach(button => {
    button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', 'Mostrar contraseña')
    button.querySelector('.eye-slash, #eyeSlash')?.setAttribute('hidden', '')
  })
  passwordGuide()
}
function invalid(id, text) { $(id).setAttribute('aria-invalid', 'true'); feedback(text, 'error'); $(id).focus(); return false }
function validCode(id) { return /^\d{8}$/.test($(id).value.trim()) || invalid(id, 'Revisa tu código universitario: debe tener 8 dígitos.') }
function available() { if (client) return true; feedback('El acceso no está disponible en este momento. Inténtalo más tarde.', 'error'); return false }
function maskEmail(email) { const [name, domain] = email.split('@'); return `${name.slice(0, 2)}•••@${domain}` }
async function authByCode(action, payload) {
  const { data, error } = await client.functions.invoke('auth-by-code', { body: { action, ...payload } })
  if (error || !data || typeof data !== 'object') throw new Error('auth_request_failed')
  return data
}
function cleanCallback() {
  const url = new URL(location.href); url.hash = ''
  for (const key of ['type', 'code', 'error', 'error_code', 'error_description']) url.searchParams.delete(key)
  history.replaceState(null, '', url.pathname + url.search)
}
async function enterHome() {
  if (!webSession.check()) return
  acceptedSession = true; clearPasswords(); cleanCallback()
  $('accessStatus').textContent = 'Sesión iniciada. Ya puedes consultar tu avance académico.'
  await new Promise(resolve => requestAnimationFrame(resolve))
  history.replaceState({ ...history.state, esanLoginEntry: true }, '')
  location.assign(destination)
}
async function mailScreen(kind, code, masked) {
  mailKind = kind; mailCode = code; resendAt = Date.now() + 45000
  $('mailCopy').textContent = kind === 'confirmation'
    ? `Cuenta creada. Confirma tu correo con el enlace que enviamos${masked ? ' a ' + masked : ''} antes de iniciar sesión.`
    : masked ? `Te enviamos un enlace de recuperación a ${masked}.` : 'Si el código está registrado, recibirás un enlace para recuperar tu contraseña.'
  feedback('', 'info'); await show('mailScreen'); updateResend()
}
async function sendRecovery(code) {
  const result = await authByCode('recover', { code, origin: callback })
  if (!result.ok && result.error !== 'code_not_found') throw new Error('recover_failed')
  return result.ok ? result.masked : null
}
function passwordGuide() {
  const value = $('newPassword').value, confirm = $('newConfirm').value
  const score = Number(value.length >= 6) + Number(value.length >= 10) + Number(/[0-9]/.test(value)) + Number(/[^a-zA-Z0-9]/.test(value))
  $('passwordStrength').setAttribute('aria-valuenow', String(score))
  $('passwordStrength').setAttribute('aria-valuetext', `${value.length} caracteres; ${score} de 4 indicadores de longitud y variedad`)
  $('passwordStrength').querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < score))
  $('passwordMinimum').querySelector('svg').toggleAttribute('hidden', value.length < 6)
  const mismatch = !!confirm && value !== confirm
  $('passwordMismatch').hidden = !mismatch
  $('newConfirm').setAttribute('aria-invalid', String(mismatch))
  scheduleFit()
}

$('passwordToggle').dataset.password = 'password'
panel.querySelectorAll('[data-password]').forEach(button => button.addEventListener('click', () => {
  const input = $(button.dataset.password), visible = input.type === 'password'
  input.type = visible ? 'text' : 'password'
  button.setAttribute('aria-pressed', String(visible)); button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña')
  button.querySelector('.eye-slash, #eyeSlash')?.toggleAttribute('hidden', !visible)
}))
panel.querySelectorAll('input, select').forEach(input => {
  if (!input.hasAttribute('aria-describedby')) input.setAttribute('aria-describedby', 'formMessage')
  input.addEventListener('input', () => {
  input.removeAttribute('aria-invalid'); feedback('')
  if (input.id === 'studentCode') { unconfirmedCode = null; $('resendConfirmation').hidden = true }
  if (input.id === 'registerCode') input.value = input.value.replace(/\D/g, '').slice(0, 8)
  if (['newPassword', 'newConfirm'].includes(input.id)) passwordGuide()
  })
})
panel.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', async () => {
  if (busy || checkingSession || transitioning || acceptedSession) return
  if (recovering && state() === 'resetScreen') {
    setBusy(true, 'Volviendo…')
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) { setBusy(false); feedback('No pudimos volver al acceso. Reintenta.', 'error'); return }
    recovering = false; cleanCallback(); setBusy(false)
  }
  clearPasswords(); await show(button.dataset.view); feedback('')
}))
$('forgot').addEventListener('click', async () => {
  if (busy || checkingSession || transitioning) return
  $('recoveryCode').value = $('studentCode').value.trim(); clearPasswords()
  await show('forgotScreen'); feedback('')
})
$('loginForm').addEventListener('submit', async event => {
  event.preventDefault()
  if (busy || checkingSession || transitioning || acceptedSession) return
  if (!available() || !validCode('studentCode')) return
  if (!$('password').value) { invalid('password', 'Ingresa tu contraseña.'); return }
  setBusy(true, 'Ingresando…'); feedback('')
  try {
    const result = await authByCode('login', { code: $('studentCode').value.trim(), password: $('password').value })
    if (result.error === 'email_not_confirmed') {
      unconfirmedCode = $('studentCode').value.trim(); $('resendConfirmation').hidden = false
      feedback('Confirma tu correo antes de ingresar. Revisa tu bandeja y spam o reenvía el enlace.', 'error'); return
    }
    if (!result.ok) { feedback('No pudimos iniciar sesión con esos datos. Revisa tu código y contraseña.', 'error'); return }
    if (!result.session?.access_token || !result.session?.refresh_token) throw new Error('session_missing')
    const session = await client.auth.setSession(result.session)
    if (session.error || !session.data.session || !session.data.user) throw new Error('session_failed')
    if (!webSession.begin(session.data.session)) return
    await enterHome()
  } catch { feedback('No pudimos conectar para iniciar sesión. Revisa tu conexión y reintenta.', 'error') }
  finally { if (!acceptedSession) setBusy(false) }
})
$('registerForm').addEventListener('submit', async event => {
  event.preventDefault()
  if (busy || checkingSession || transitioning || acceptedSession) return
  if (!available() || !validCode('registerCode')) return
  const career = $('registerCareer').value, code = $('registerCode').value.trim(), email = $('registerEmail').value.trim().toLowerCase()
  if (!Object.hasOwn(CAREER_OPTIONS, career)) { invalid('registerCareer', 'Elige tu carrera.'); return }
  if (!isEsanStudentCode(code)) { invalid('registerCode', 'Ese código no corresponde a la universidad seleccionada.'); return }
  if (!$('registerEmail').validity.valid || !email) { invalid('registerEmail', 'Ingresa un correo válido.'); return }
  if ($('registerPassword').value.length < 6) { invalid('registerPassword', 'La contraseña debe tener al menos 6 caracteres.'); return }
  if ($('registerPassword').value !== $('registerConfirm').value) { invalid('registerConfirm', 'Las contraseñas no coinciden.'); return }
  setBusy(true, 'Creando cuenta…'); feedback('')
  try {
    const result = await client.auth.signUp({ email, password: $('registerPassword').value, options: { data: { student_code: code, carrera: career }, emailRedirectTo: callback } })
    if (result.error) throw result.error
    if (!result.data.user || result.data.user.identities?.length === 0) { feedback('Ese correo ya tiene una cuenta. Usa otro correo o inicia sesión.', 'error'); return }
    if (result.data.session) { if (webSession.begin(result.data.session)) await enterHome() }
    else { clearPasswords(); await mailScreen('confirmation', code, maskEmail(email)) }
  } catch (error) {
    feedback(error?.status === 429 ? 'Se alcanzó el límite de registros. Espera un momento antes de reintentar.' : 'No pudimos completar el registro. Revisa tus datos y reintenta; si persiste, contacta al soporte.', 'error')
  } finally { if (!acceptedSession) setBusy(false) }
})
$('forgotForm').addEventListener('submit', async event => {
  event.preventDefault()
  if (busy || checkingSession || transitioning) return
  if (!available() || !validCode('recoveryCode')) return
  if (Date.now() < resendAt) { feedback('Espera a que termine el contador para solicitar otro enlace.', 'error'); return }
  setBusy(true, 'Enviando enlace…'); feedback('')
  try { const code = $('recoveryCode').value.trim(); await mailScreen('recovery', code, await sendRecovery(code)) }
  catch { feedback('No pudimos enviar el enlace. Revisa tu conexión y reintenta.', 'error') }
  finally { setBusy(false) }
})
$('resendLink').addEventListener('click', async () => {
  if (busy || checkingSession || Date.now() < resendAt || !available()) return
  setBusy(true); feedback('')
  try {
    if (mailKind === 'confirmation') {
      const result = await authByCode('resend', { code: mailCode })
      if (!result.ok) throw new Error('resend_failed')
    } else await sendRecovery(mailCode)
    resendAt = Date.now() + 45000
    feedback('Solicitud completada. Revisa tu correo y spam.')
  } catch { feedback('No pudimos reenviar el enlace. Reintenta en un momento.', 'error') }
  finally { setBusy(false) }
})
$('resendConfirmation').addEventListener('click', async () => {
  if (busy || checkingSession || !unconfirmedCode || !available()) return
  if (Date.now() < resendAt) { feedback('Espera a que termine el contador para reenviar otro enlace.', 'error'); return }
  setBusy(true, 'Reenviando enlace…'); feedback('')
  try {
    const result = await authByCode('resend', { code: unconfirmedCode })
    if (!result.ok) throw new Error('resend_failed')
    await mailScreen('confirmation', unconfirmedCode, result.masked)
  } catch { feedback('No pudimos reenviar el enlace. Reintenta en un momento.', 'error') }
  finally { setBusy(false) }
})
$('resetForm').addEventListener('submit', async event => {
  event.preventDefault()
  if (busy || checkingSession || transitioning || acceptedSession) return
  if (!available()) return
  if (!recovering) { feedback('Solicita un nuevo enlace para cambiar tu contraseña.', 'error'); return }
  if ($('newPassword').value.length < 6) { invalid('newPassword', 'La contraseña debe tener al menos 6 caracteres.'); return }
  if ($('newPassword').value !== $('newConfirm').value) { invalid('newConfirm', 'Las contraseñas no coinciden.'); return }
  setBusy(true, 'Guardando…'); feedback('')
  try {
    const verified = await client.auth.getUser()
    if (verified.error || !verified.data.user) throw new Error('recovery_session_failed')
    const result = await client.auth.updateUser({ password: $('newPassword').value })
    if (result.error || !result.data.user) throw new Error('password_update_failed')
    await enterHome()
  } catch { feedback('No pudimos guardar la contraseña. Reintenta o solicita un nuevo enlace.', 'error') }
  finally { if (!acceptedSession) setBusy(false) }
})

try { initializeAccessBackground() } catch {
  // A decorative-media failure must never leave login navigation blocked.
  document.body.dataset.paused = 'true'
  document.body.dataset.backgroundError = 'true'
}
setInterval(updateResend, 1000)
document.addEventListener('visibilitychange', updateResend)
if (client) client.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') recovering = true })
async function initialize() {
  panel.querySelectorAll('input, select, button').forEach(el => { el.disabled = true })
  try {
    if (!client) { feedback('El acceso no está disponible en este momento. Inténtalo más tarde.', 'error'); return }
    const { data, error } = await client.auth.getSession()
    if (error) throw error
    if (!data.session) {
      if (query.get('reason') === 'inactivity') {
        await show('loginScreen', false)
        feedback('Tu sesión se cerró tras 30 minutos sin actividad. Inicia sesión de nuevo para continuar.')
      }
      if (recovering || params.get('error') || query.get('error')) {
        recovering = false; await show('forgotScreen'); cleanCallback()
        feedback('El enlace no es válido o ha caducado. Solicita uno nuevo con tu código universitario.', 'error')
      }
      return
    }
    if (!recovering && !params.get('access_token') && !query.get('code') && !webSession.restore(data.session)) return
    const verified = await client.auth.getUser()
    if (verified.error || !verified.data.user) {
      if (verified.error && [401, 403].includes(verified.error.status)) await client.auth.signOut({ scope: 'local' })
      throw new Error('session_failed')
    }
    if (recovering || params.get('access_token') || query.get('code')) {
      if (!webSession.begin(data.session)) return
    }
    if (!webSession.check()) return
    cleanCallback()
    if (recovering) { clearPasswords(); await show('resetScreen', false) }
    else if (!history.state?.esanLoginEntry) await enterHome()
  } catch { recovering = false; feedback('No pudimos comprobar tu sesión. Reintenta el acceso o solicita un nuevo enlace.', 'error') }
  finally { checkingSession = false; if (!acceptedSession) setBusy(false) }
}
window.addEventListener('pageshow', event => {
  if (!event.persisted || !history.state?.esanLoginEntry) return
  acceptedSession = false; checkingSession = false; busy = false
  clearPasswords(); setBusy(false); void show('loginScreen', false)
})
foot(); initialize()



