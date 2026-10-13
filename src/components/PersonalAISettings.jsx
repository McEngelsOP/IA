import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/PersonalAISettings.css'
const PROVIDERS = [['gemini','Gemini','https://aistudio.google.com/apikey'],['groq','Groq','https://console.groq.com/keys'],['openrouter','OpenRouter','https://openrouter.ai/settings/keys']]
const names = Object.fromEntries(PROVIDERS.map(([id,name]) => [id,name]))
const statusLabel = value => ({ ok: 'Respondió correctamente', rate_limited: 'Cuota agotada o pausa temporal', provider_configuration: 'Revisa la clave o el modelo', provider_timeout: 'Tiempo de espera agotado', provider_unavailable: 'Proveedor no disponible', content_blocked: 'Contenido rechazado', credits_exhausted: 'Créditos agotados' }[value] || 'Sin prueba reciente')

function PersonalAISettings({ client, user, onClose, onBusy }) {
  const [config,setConfig] = useState(null), [provider,setProvider] = useState('gemini'), [key,setKey] = useState(''), [show,setShow] = useState(false)
  const [busy,setBusy] = useState(false), [loading,setLoading] = useState(true), [error,setError] = useState(''), [message,setMessage] = useState(''), [deleting,setDeleting] = useState(null)
  const alive=useRef(true), locked=useRef(false), request=useRef(null), keyInput=useRef(null)
  useEffect(() => { alive.current=true; read();return () => { alive.current=false;request.current?.abort() } }, [user.id])
  async function invoke(body) {
    request.current=new AbortController();const timer=setTimeout(()=>request.current?.abort(),45000)
    try {
      const r=await client.functions.invoke('personal-ai',{body,signal:request.current.signal})
      if(r.error) {
        let text='No pudimos conectar. Reintenta; tu configuración anterior se conserva.'
        try { text=(await r.error.context.json()).message || text } catch { /* sin cuerpo JSON */ }
        throw new Error(text)
      }
      return r.data
    } finally {clearTimeout(timer)}
  }
  async function read() {
    setLoading(true);setError('')
    try { const r=await invoke({action:'list'});if(!['system','personal'].includes(r?.mode)||!Array.isArray(r.keys))throw new Error('La configuración no es válida. Reintenta.');if(alive.current)setConfig(r) }
    catch(e) { if(alive.current)setError(e.message) }
    finally { if(alive.current)setLoading(false) }
  }
  async function action(body,success) {
    if(locked.current)return false
    locked.current=true;setBusy(true);onBusy(true);setError('');setMessage('')
    try {
      const r=await invoke(body)
      if(!alive.current)return false
      if(body.action==='test') {
        setConfig(old=>({...old,keys:old.keys.map(k=>k.provider===body.provider?{...k,lastStatus:r.status}:k)}));setMessage(r.message)
      }else{setConfig(r);setMessage(success);setDeleting(null)}
      return true
    }catch(e){if(alive.current)setError(e.message);return false}
    finally{locked.current=false;onBusy(false);if(alive.current)setBusy(false)}
  }
  async function save(e) {
    e.preventDefault()
    if(key.trim().length<20){setError('Pega una clave válida de al menos 20 caracteres.');keyInput.current?.focus();return}
    if(await action({action:'save',provider,key:key.trim()},'Clave guardada y modo personal activado. Puedes probarla ahora.')){setKey('');setShow(false)}
  }
  const selectedProvider=PROVIDERS.find(p=>p[0]===provider)
  return <section className="pai" aria-label="Mi IA">
    <button className="h-btn pai-back" disabled={busy} onClick={onClose}>Volver a Inicio</button>
    <header><h2>Tu conexión de IA</h2><p>Configura Gemini, Groq u OpenRouter para el Asesor IA y Texto → tareas.</p></header>
    {loading?<p role="status">Consultando tu configuración…</p>:!config?<><p role="alert">{error}</p><button className="h-btn" onClick={read}>Reintentar</button></>:<>
      <fieldset className="pai-mode" disabled={busy}><legend>¿Qué servicio quieres usar?</legend>
        {[['system','Servicio de la app','Usa los proveedores y las cuotas compartidas de la app.'],['personal','Mis claves','Usa solo tus proveedores activos; si fallan, puedes cambiar al servicio de la app.']].map(([mode,title,description])=><label key={mode}><input type="radio" name="ai-mode" value={mode} aria-label={title} aria-describedby={`ai-mode-desc-${mode}`} checked={config.mode===mode} onChange={()=>action({action:'mode',mode},mode==='personal'?'Modo personal activado.':'Servicio de la app activado.')}/><span><b>{title}</b><small id={`ai-mode-desc-${mode}`}>{description}</small></span></label>)}
      </fieldset>
      <section className="pai-saved" aria-label="Claves guardadas"><h3>Tus proveedores</h3>
        {!config.keys.length?<p>Aún no tienes claves guardadas. Puedes seguir usando el servicio de la app.</p>:config.keys.map(k=><div className="pai-provider" key={k.provider}>
          <div><b>{names[k.provider]}</b><span className="pai-hint">{k.hint}</span><small>{k.enabled?'Activa':'Desactivada'} · {statusLabel(k.lastStatus)}</small></div>
          <div className="pai-provider-actions"><button className="h-btn" disabled={busy} aria-pressed={k.enabled} onClick={()=>action({action:'toggle',provider:k.provider,enabled:!k.enabled},k.enabled?'Clave desactivada.':'Clave activada.')}>{k.enabled?'Desactivar':'Activar'}</button><button className="h-btn" disabled={busy||!k.enabled||config.mode!=='personal'} onClick={()=>action({action:'test',provider:k.provider},'')}>Probar {names[k.provider]}</button><button className="h-btn" disabled={busy} aria-label={`Eliminar clave de ${names[k.provider]}`} onClick={()=>setDeleting(k.provider)}>Eliminar</button></div>
          {deleting===k.provider&&<div className="pai-delete" role="group" aria-label={`Confirmar eliminación de ${names[k.provider]}`}><p>¿Eliminar esta clave guardada? Esto no revoca la clave en {names[k.provider]}.</p><button className="h-btn primary" disabled={busy} onClick={()=>action({action:'delete',provider:k.provider},'Clave eliminada de la app.')}>Confirmar eliminación</button><button className="h-btn" disabled={busy} onClick={()=>setDeleting(null)}>Conservar</button></div>}
        </div>)}
      </section>
      <form className="pai-add" onSubmit={save}><fieldset disabled={busy}><legend>Añadir o reemplazar una clave</legend>
        <label htmlFor="ai-provider">Proveedor</label><select id="ai-provider" value={provider} onChange={e=>{setProvider(e.target.value);setKey('');setShow(false)}}>{PROVIDERS.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
        <label htmlFor="ai-key">Clave de API de {names[provider]}</label><div className="pai-key-field"><input ref={keyInput} id="ai-key" name="personal-api-key" type={show?'text':'password'} required minLength={20} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)} placeholder="Pega tu clave de API"/><button className="h-btn" type="button" aria-pressed={show} onClick={()=>setShow(!show)}>{show?'Ocultar':'Mostrar'}</button></div>
        <a href={selectedProvider[2]} target="_blank" rel="noopener noreferrer">Obtener una clave en {selectedProvider[1]}</a>
        <p>Se guarda cifrada. Después de guardarla, solo mostramos sus últimos cuatro caracteres. Al guardar se activa «Mis claves».</p>
        <p>Las consultas consumen la cuota de tu cuenta del proveedor y pueden generar cargos según su configuración. La app limita el modo personal a 10 consultas cada 15 minutos y 200 al día. OpenRouter usa modelos gratuitos.</p>
        <button className="h-btn primary" type="submit">{busy?'Procesando…':'Guardar clave'}</button>
      </fieldset></form>
      {busy&&<p role="status">Procesando tu solicitud…</p>}{error&&<p className="pai-error" role="alert">{error}</p>}<p role="status" aria-live="polite">{message}</p>
    </>}
  </section>
}
export function mountPersonalAISettings(container,props){const root=createRoot(container);root.render(<PersonalAISettings {...props}/>);return()=>root.unmount()}
