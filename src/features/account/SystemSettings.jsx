import { OFFLINE_ENABLED } from './offlineEnabled.js'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { formatGrade, scaleLabel } from '../../core/academic/grading.js'
import './system.css'
export function SystemSettings({ client, user, profile, sync, scale, syncStatus, install, onBusy = () => {} }) {
  const [settings, setSettings] = useState(() => sync.get('notifications') || { enabled: false, weekly: true, quietStart: '22:00', quietEnd: '07:00', leadMinutes: 30, timeZone: 'America/Lima' })
  const [body, setBody] = useState(''), [category, setCategory] = useState('error'), [reports, setReports] = useState([]), [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(syncStatus)
  useEffect(() => { const handler = e => setStatus(e.detail); window.addEventListener('lyra-sync-status', handler); return () => window.removeEventListener('lyra-sync-status', handler) }, [])
  useEffect(() => { let alive = true; client.from('incident_reports').select('id,body,status,created_at').eq('student_id', user.id).order('created_at', { ascending: false }).limit(20).then(r => { if (alive) { if (r.error) setError('No se pudo consultar tus reportes.'); else setReports(r.data || []) } }); return () => { alive = false } }, [user.id])
  const change = (key, value) => { const next = { ...settings, [key]: value }; setSettings(next); sync.set('notifications', next) }
  async function enable() {
    if (!('Notification' in window)) { setError('Este navegador no admite avisos. El resumen seguirá disponible en Mi semestre.'); return }
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') { setError('El navegador no autorizó los avisos. Puedes habilitarlos en sus ajustes.'); return }
    change('enabled', true); setError(''); setMessage('Recordatorios activados en este navegador.')
  }
  async function report(e) {
    e.preventDefault(); if (busy) return
    setBusy(true); onBusy(true); setError('')
    try {
      const verified = await client.auth.getUser()
      if (verified.error || verified.data.user?.id !== user.id) throw new Error('session')
      const r = await client.from('incident_reports').insert({ student_id: user.id, institution_id: profile.institution_id, category, body: body.trim() }).select('id,body,status,created_at').single()
      if (r.error || !r.data) throw r.error || new Error('save')
      setReports(old => [r.data, ...old]); setBody(''); setMessage('Reporte enviado al panel de atención.')
    } catch { setError('No se pudo enviar. Conservamos tu texto para que reintentes.') }
    finally { setBusy(false); onBusy(false) }
  }
  return <div className="lyra-system">
    <section className="blk"><h2>Tu cuenta, en cada dispositivo</h2><p>El orden de Inicio, objetivos, tema y preferencias de Focus se guardan con tu cuenta.</p><p role="status">{status}</p><button className="h-btn" onClick={() => sync.refresh()}>Sincronizar ahora</button></section>
    <section className="blk"><h2>Recordatorios y descanso</h2><p>Los avisos se revisan mientras Lyra está abierta. El permiso de notificaciones se activa por separado en cada dispositivo.</p>
      <label><input type="checkbox" checked={!!settings.enabled} onChange={e => e.target.checked ? enable() : change('enabled', false)}/> Avisarme de clases y entregas</label>
      <label><input type="checkbox" checked={!!settings.weekly} onChange={e => change('weekly', e.target.checked)}/> Resumen de la semana los lunes desde las 08:00</label>
      <div className="system-fields"><label>Silencio desde<input type="time" value={settings.quietStart} onChange={e => change('quietStart', e.target.value)}/></label><label>Hasta<input type="time" value={settings.quietEnd} onChange={e => change('quietEnd', e.target.value)}/></label><label>Anticipación<select value={settings.leadMinutes} onChange={e => change('leadMinutes', Number(e.target.value))}><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option></select></label><label>Zona horaria<select value={settings.timeZone} onChange={e => change('timeZone', e.target.value)}>{['America/Lima','America/Bogota','America/Santiago','America/Mexico_City','Europe/Madrid'].map(zone => <option key={zone}>{zone}</option>)}</select></label></div>
      <p>Si inicio y fin coinciden, el silencio dura todo el día.</p>
    </section>
    {OFFLINE_ENABLED&&<section className="blk"><h2>Lyra sin conexión</h2><p>En este dispositivo se conserva una copia de tu malla, horario y tareas después de consultarlos con conexión. La copia se elimina al cerrar sesión.</p><div className="system-actions"><button className="h-btn" onClick={install}>Instalar Lyra</button><a className="h-btn" href="./offline.html">Consultar copia guardada</a></div><p>En iPhone o iPad: Compartir → Añadir a pantalla de inicio.</p></section>}
    <section className="blk"><h2>Reglas de calificaciones</h2><p>{profile.institution_id?.toUpperCase()} · Escala {scaleLabel(scale)} · Aprobación desde {formatGrade(scale.passing, scale)}.</p><p>Promedio por {scale.weighting === 'credits' ? 'créditos' : 'curso, con pesos iguales'}. Las evaluaciones de cada curso deben sumar 100%. Las reglas institucionales las administra Lyra.</p></section>
    <section className="blk"><h2>Reportar un problema</h2><form onSubmit={report}><label>Tipo<select value={category} onChange={e => setCategory(e.target.value)}><option value="error">Fallo del aplicativo</option><option value="academic">Malla o información académica</option><option value="suggestion">Sugerencia</option></select></label><label>Qué ocurrió<textarea minLength="10" maxLength="2000" required value={body} onChange={e => setBody(e.target.value)} placeholder="Indica qué estabas intentando hacer. Evita incluir contraseñas o información sensible."/></label><button className="h-btn primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar reporte'}</button></form>
      <h3>Mis reportes</h3>{reports.length ? <ul className="system-list">{reports.map(r => <li key={r.id}><p>{r.body}</p><small>{({ open: 'Recibido', investigating: 'En revisión', resolved: 'Resuelto' })[r.status]} · {new Date(r.created_at).toLocaleDateString('es-PE')}</small></li>)}</ul> : <p>Aún no has enviado reportes.</p>}
    </section><p role="status">{message}</p>{error && <p role="alert">{error}</p>}
  </div>
}
export function mountSystemSettings(container, props) { const root = createRoot(container); root.render(<SystemSettings {...props}/>); return () => root.unmount() }
