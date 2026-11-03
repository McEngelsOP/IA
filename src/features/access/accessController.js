import { authCallback, initializeAndroid, isAndroid } from '../../native/android.js'
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
const callback = authCallback()
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
  if (old && animate && !reduce.matches) { old.classList.add('screen-exit'); await delay(180) }
  screens.forEach(el => { el.hidden = el !== next; el.classList.remove('entrance', 'screen-exit') })
  const shouldAnimate = animate && !reduce.matches
  document.body.dataset.state = id; foot(); panel.classList.remove('has-message')
  if (id === 'registerScreen') void loadUniversities()
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
function validCode(id) { return (id!=='registerCode'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($(id).value.trim())) || /^\d{8}$/.test($(id).value.trim()) || invalid(id, 'Revisa tu código universitario: debe tener 8 dígitos.') }
function available() { if (client) return true; feedback('El acceso no está disponible en este momento. Inténtalo más tarde.', 'error'); return false }
function maskEmail(email) { const [name, domain] = email.split('@'); return `${name.slice(0, 2)}•••@${domain}` }
async function authByCode(action, payload) {
  if(String(payload.code||'').includes('@')){const email=payload.code.trim().toLowerCase();if(action==='login'){const r=await client.auth.signInWithPassword({email,password:payload.password});if(r.error)return{ok:false,error:r.error.code||'invalid_credentials'};return{ok:true,session:r.data.session}}const r=action==='recover'?await client.auth.resetPasswordForEmail(email,{redirectTo:callback}):await client.auth.resend({type:'signup',email,options:{emailRedirectTo:callback}});return{ok:!r.error,masked:maskEmail(email)}}

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
  if (isAndroid() && authCallback().startsWith('https:')) $('mailCopy').textContent += ' Abre el enlace en tu navegador y después vuelve a Lyra.'
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
  if (!available() || ($('registerUniversityType').value==='esan'&&!validCode('registerCode'))) return
  const career = $('registerCareer').value, code = $('registerCode').value.trim(), email = $('registerEmail').value.trim().toLowerCase()
  const selection = $('registerUniversityType').value
  const other = selection !== 'esan'
  const university = selection === 'other' ? $('registerUniversity').value.trim() : universities.get(selection)?.name || ''
  const externalCareer = selection === 'other' || $('registerKnownCareer').value === 'other'
    ? $('registerExternalCareer').value.trim() : $('registerKnownCareer').value
  if(other&&(/esan|^ue$/i.test(university.normalize('NFD').replace(/[\u0300-\u036f]/g,''))||/@ue\.edu\.pe$/i.test(email))){$('registerUniversityType').value='esan';$('registerUniversityType').dispatchEvent(new Event('change'));feedback('Completa el registro ESAN con código y correo institucional.','error');return}
  if (other && university.length < 2) { invalid(selection === 'other' ? 'registerUniversity' : 'registerUniversityType', 'Completa el nombre de tu universidad.'); return }
  if (other && externalCareer.length < 2) { invalid(selection === 'other' || $('registerKnownCareer').value === 'other' ? 'registerExternalCareer' : 'registerKnownCareer', 'Completa tu carrera.'); return }
  if (!other&&!Object.hasOwn(CAREER_OPTIONS, career)) { invalid('registerCareer', 'Elige tu carrera.'); return }
  if (!other&&!isEsanStudentCode(code)) { invalid('registerCode', 'Ese código no corresponde a la universidad seleccionada.'); return }
  if(!other&&!/^[a-z0-9._%+-]+@ue\.edu\.pe$/.test(email)){invalid('registerEmail','Usa tu correo institucional que termina en @ue.edu.pe.');return}
  if (!$('registerEmail').validity.valid || !email) { invalid('registerEmail', 'Ingresa un correo válido.'); return }
  if ($('registerPassword').value.length < 6) { invalid('registerPassword', 'La contraseña debe tener al menos 6 caracteres.'); return }
  if ($('registerPassword').value !== $('registerConfirm').value) { invalid('registerConfirm', 'Las contraseñas no coinciden.'); return }
  setBusy(true, 'Creando cuenta…'); feedback('')
  try {
    if(other){const probe=await client.rpc('search_universities',{p_query:university});if(probe.error){feedback('El registro de otras universidades todavía no está activado. Conservamos tus datos.','error');return}}
    const result = await client.auth.signUp({ email, password: $('registerPassword').value, options: { data: other?{institution_id:'other',university_name:university,external_career:externalCareer}:{institution_id:'esan',university_name:'Universidad ESAN',student_code:code,carrera:career}, emailRedirectTo: callback } })
    if (result.error) throw result.error
    if (!result.data.user || result.data.user.identities?.length === 0) { feedback('Ese correo ya tiene una cuenta. Usa otro correo o inicia sesión.', 'error'); return }
    if (result.data.session) { if (webSession.begin(result.data.session)) await enterHome() }
    else { clearPasswords(); await mailScreen('confirmation', other?email:code, maskEmail(email)) }
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
void initializeAndroid().catch(() => {})
foot(); initialize()




const universities = new Map()
let catalogLoaded = false, catalogLoading = false
async function loadUniversities() {
  if (catalogLoaded || catalogLoading || !client) return
  catalogLoading = true
  $('retryUniversities').hidden = true
  $('universityLookup').hidden = false
  $('universityLookup').textContent = 'Cargando universidades…'
  try {
    const { data, error } = await client.rpc('registration_universities')
    if (error || !Array.isArray(data)) throw new Error('catalog_unavailable')
    const select = $('registerUniversityType'), selected = select.value
    for (const item of data) {
      if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || item.id === 'esan' || item.id === 'other' || universities.has(item.id)) continue
      const careers = Array.isArray(item.careers) ? [...new Set(item.careers.filter(name => typeof name === 'string' && name.trim().length >= 2))].sort((a, b) => a.localeCompare(b, 'es')) : []
      universities.set(item.id, { name: item.name, careers })
    }
    select.replaceChildren(new Option('Universidad ESAN', 'esan'))
    for (const [id, university] of [...universities].sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'))) select.add(new Option(university.name, id))
    select.add(new Option('Otro', 'other'))
    select.value = selected
    catalogLoaded = true
    $('universityLookup').hidden = true
  } catch {
    $('universityLookup').textContent = 'No pudimos cargar el catálogo. Puedes elegir ESAN u Otro, o reintentar.'
    $('retryUniversities').hidden = false
  } finally { catalogLoading = false; scheduleFit() }
}
function updateUniversityFields() {
  const selection = $('registerUniversityType').value
  const esan = selection === 'esan', manual = selection === 'other'
  $('otherUniversityFields').hidden = !manual
  $('registerUniversity').required = manual
  $('knownCareerField').hidden = esan || manual
  $('registerKnownCareer').required = !esan && !manual
  $('externalRegistrationHint').hidden = esan
  for (const id of ['registerCode', 'registerCareer']) {
    $(id).closest('.field').hidden = !esan
    $(id).required = esan
  }
  const select = $('registerKnownCareer')
  select.replaceChildren(new Option('Elige tu carrera', ''))
  for (const name of universities.get(selection)?.careers || []) select.add(new Option(name, name))
  select.add(new Option('Otra carrera', 'other'))
  if (!esan && !manual && !universities.get(selection)?.careers.length) select.value = 'other'
  updateExternalCareerField()
  feedback('')
  scheduleFit()
}
function updateExternalCareerField() {
  const selection = $('registerUniversityType').value
  const manual = selection === 'other' || (selection !== 'esan' && $('registerKnownCareer').value === 'other')
  $('externalCareerField').hidden = !manual
  $('registerExternalCareer').required = manual
  $('externalCareerField').querySelector('label').textContent = selection === 'other' ? 'Carrera' : 'Nombre de tu carrera'
  scheduleFit()
}
$('registerUniversityType').addEventListener('change', updateUniversityFields)
$('registerKnownCareer').addEventListener('change', updateExternalCareerField)
$('retryUniversities').addEventListener('click', () => { void loadUniversities() })
