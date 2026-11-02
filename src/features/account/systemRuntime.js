import { createPreferenceSync } from '../../shared/lib/preferenceSync.js'
import { activateOfflineAccount, clearOfflineAccount } from '../../shared/lib/offlineStore.js'
import { dueReminders } from '../../core/calendar/prevention.js'
import './system.css'
export function createSystemRuntime({ client, getUser, getAgenda, apply }) {
  let owner = null, status = '', installPrompt, lastRefresh = 0
  const sync = createPreferenceSync({ client, onChange: apply, onStatus: value => { status = value; window.dispatchEvent(new CustomEvent('lyra-sync-status', { detail: value })) } })
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e })
  async function install() {
    if (installPrompt) { await installPrompt.prompt(); installPrompt = null }
    else alert('Para instalar Lyra, abre el menú del navegador y elige «Instalar aplicación» o «Añadir a pantalla de inicio».')
  }
  function connection() {
    document.querySelector('#lyra-connection')?.remove()
    if (!navigator.onLine) {
      const el = document.createElement('p'); el.id = 'lyra-connection'; el.className = 'system-connection'; el.setAttribute('role', 'status')
      el.append('Sin conexión. '); const link = document.createElement('a'); link.href = './offline.html'; link.textContent = 'Consultar copia guardada'; el.append(link); document.body.append(el)
    }
  }
  window.addEventListener('online', () => { connection(); void sync.refresh() }); window.addEventListener('offline', connection); connection()
  window.addEventListener('focus', () => { if (owner && Date.now() - lastRefresh > 15000) { lastRefresh = Date.now(); void sync.refresh() } })
  async function record(code) { if (owner && getUser()?.id === owner) try { await client.rpc('record_service_event', { p_code: code }) } catch { /* Telemetry must not interrupt the app. */ } }
  window.addEventListener('error', () => void record('client_error'))
  window.addEventListener('unhandledrejection', () => void record('unhandled_rejection'))
  async function reminders() {
    const id = owner
    if (!id || getUser()?.id !== id || !('Notification' in window) || Notification.permission !== 'granted') return
    const settings = sync.get('notifications'), agenda = getAgenda()
    if (!settings || agenda.calendarLoading || agenda.calendarError) return
    const key = `lyra-reminders:${id}`
    let sent = {}; try { sent = JSON.parse(localStorage.getItem(key)) || {} } catch { /* No prior reminders. */ }
    for (const item of dueReminders(agenda.calendar_events, agenda.calendar_tasks, settings)) {
      if (sent[item.key] || getUser()?.id !== id) continue
      try {
        const registration = await navigator.serviceWorker?.getRegistration()
        if (getUser()?.id !== id) return
        if (registration) await registration.showNotification(item.title, { body: item.body, tag: item.key, icon: '/icon-192.png', data: { url: '/pagina.html' } })
        else new Notification(item.title, { body: item.body, tag: item.key })
        sent[item.key] = Date.now()
      } catch { /* Browser may require an installed app. */ }
    }
    sent = Object.fromEntries(Object.entries(sent).filter(([, at]) => Date.now() - at < 35 * 86400000))
    localStorage.setItem(key, JSON.stringify(sent))
  }
  setInterval(() => void reminders(), 60000)
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {})
  return { sync, install, record, get status() { return status },
    async start(id, legacy) { owner = id; activateOfflineAccount(id); await sync.start(id, legacy); void reminders() },
    stop() { owner = null; sync.stop() },
    async signOut() { owner = null; sync.stop(); try { await clearOfflineAccount() } catch { /* The active account marker is already cleared. */ } }
  }
}
