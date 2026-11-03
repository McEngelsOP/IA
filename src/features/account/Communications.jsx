import { useEffect, useRef, useState } from 'react'

const INITIAL = {
  subject: 'Lyra está creciendo. Gracias por estar desde el inicio 💙',
  preview: 'Tus comentarios ayudaron a dar forma a Lyra. Hoy somos más, y tú eres parte de esta historia ^^',
  message: '¡Hola!\n\nLyra ha crecido y cada vez más estudiantes están usando la plataforma. Quería agradecerte por acompañarnos desde el inicio y por compartir tus comentarios cuando todo recién comenzaba.\n\nTus ideas y observaciones nos ayudaron a mejorar. Me hacía ilusión contártelo y darte las gracias personalmente ^^\n\nGracias por ser parte de esta historia.\nEquipo Lyra'
}
const ERRORS = {
  invalid_message:'Revisa el asunto y el mensaje: deben contener texto y respetar los límites indicados.',
  authorization_unavailable:'No se pudo comprobar el permiso de administrador. Reintenta más tarde.',
  service_unavailable:'No se pudo consultar el servicio. Tus campos se conservan; reintenta más tarde.',
  session:'Tu sesión terminó. Vuelve a iniciar sesión antes de enviar.', forbidden:'Esta acción está reservada a administradores.',
  configuration:'El envío aún no está configurado. Puedes copiar o exportar el destinatario para usarlo en Brevo.',
  recipient_changed:'El correo de la cuenta cambió. Actualiza los usuarios y vuelve a revisar el destinatario.',
  recipient_unavailable:'Esta cuenta no está disponible para recibir el mensaje o aún no ha confirmado su correo.',
  duplicate:'Brevo ya procesó este mismo mensaje recientemente. Revisa su registro antes de volver a enviar.',
  delivery_unknown:'No pudimos confirmar el resultado. Revisa los registros de Brevo antes de intentar otro envío.',
  provider_rejected:'Brevo rechazó el envío. Revisa la clave API, el remitente verificado y los registros de Brevo.'
}
const csvCell = value => `"${String(value || '').replace(/^[\s]*[=+@-]/, "'$&").replaceAll('"','""')}"`
export function Communications({ client, user, onBusy = () => {} }) {
  const [users,setUsers] = useState([]), [query,setQuery] = useState(''), [selected,setSelected] = useState(null)
  const [draft,setDraft] = useState(INITIAL), [state,setState] = useState('loading'), [connection,setConnection] = useState(null)
  const [error,setError] = useState(''), [notice,setNotice] = useState(''), [review,setReview] = useState(false), [sent,setSent] = useState(false), [busy,setBusy] = useState(false)
  const alive = useRef(true), lock = useRef(false), revision = useRef(0)
  useEffect(() => { alive.current=true; load(); return () => { alive.current=false; revision.current++ } }, [client,user.id])
  async function sessionToken() {
    const verified = await client.auth.getUser()
    if (verified.error || verified.data?.user?.id !== user.id) throw new Error('session')
    const session = await client.auth.getSession()
    if (session.error || session.data?.session?.user?.id !== user.id || !session.data.session.access_token) throw new Error('session')
    return session.data.session.access_token
  }
  async function load() {
    const version=++revision.current; setState('loading'); setError('');setSelected(null);setReview(false);setSent(false);setConnection(null)
    try {
      const result = await client.rpc('admin_get_users')
      if (result.error || !Array.isArray(result.data)) throw new Error('users')
      if (!alive.current || revision.current!==version) return
      setUsers(result.data.filter(p=>p.email).map(({id,email,alias,created_at})=>({id,email,alias,created_at})));setState('ready')
      try {
        const token=await sessionToken()
        const status=await fetch('/api/communications',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'})
        const value=await status.json()
        if(alive.current && revision.current===version)setConnection(status.ok?value:{ready:false})
      } catch { if(alive.current && revision.current===version)setConnection({ready:false}) }
    } catch { if(alive.current && revision.current===version){setState('error');setError('No se pudieron cargar los usuarios. Comprueba tu permiso de administrador y pulsa Actualizar usuarios.')} }
  }
  const found=users.filter(p=>`${p.alias||''} ${p.email}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()))
  function change(field,value){setDraft(v=>({...v,[field]:value}));setReview(false);setSent(false);setNotice('');setError('')}
  async function copy(){try{await navigator.clipboard.writeText(selected.email);setNotice('Correo copiado.')}catch{setError('No se pudo copiar. Selecciona el correo visible y cópialo manualmente.')}}
  function exportContact(){const blob=new Blob(['\ufeffEMAIL,FIRSTNAME\r\n'+csvCell(selected.email)+','+csvCell(selected.alias)+'\r\n'],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='Lyra_destinatario_Brevo.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('CSV descargado con una sola persona. En Brevo, importa EMAIL como correo y FIRSTNAME como nombre. La importación no envía mensajes.')}
  async function send(){
    if(lock.current||!review||!selected||sent)return
    lock.current=true;setBusy(true);onBusy(true);setError('');setNotice('')
    try{
      const token=await sessionToken()
      const response=await fetch('/api/communications',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({userId:selected.id,expectedEmail:selected.email,...draft}),signal:AbortSignal.timeout(30000)})
      const result=await response.json().catch(()=>({error:'delivery_unknown'}))
      if(!response.ok||!result.accepted)throw new Error(result.error||'delivery_unknown')
      if(alive.current){setSent(true);setReview(false);setNotice(`Brevo aceptó el mensaje para ${selected.email}. Esto no confirma su entrega en la bandeja. Referencia: ${result.messageId}`)}
    }catch(e){if(alive.current)setError(ERRORS[e.message]||ERRORS.delivery_unknown)}
    finally{lock.current=false;if(alive.current)setBusy(false);onBusy(false)}
  }
  return <section className="blk communications" aria-labelledby="communications-heading"><h2 id="communications-heading">Comunicaciones</h2>
    <p>Elige una persona registrada en Lyra y revisa el mensaje antes de enviarlo. Cada envío tiene un solo destinatario.</p>
    <div className="system-actions"><button className="h-btn" type="button" disabled={busy||state==='loading'} onClick={load}>Actualizar usuarios</button></div>
    {state==='loading'&&<p role="status">Cargando usuarios registrados…</p>}
    {state==='ready'&&<><label className="communications-search">Buscar por nombre o correo<input type="search" value={query} disabled={busy} onChange={e=>setQuery(e.target.value)} placeholder="Nombre o correo del estudiante"/></label>
      <p>{found.length} {found.length===1?'usuario encontrado':'usuarios encontrados'}{found.length>30?' · Se muestran los primeros 30; escribe para filtrar.':''}</p>
      {found.length>0?<ul className="system-list communications-users">{found.slice(0,30).map(p=><li key={p.id}><div><strong>{p.alias||'Sin apodo'}</strong><span>{p.email}</span><small>Registro: {p.created_at?new Date(p.created_at).toLocaleDateString('es-PE',{timeZone:'America/Lima'}):'Sin fecha'}</small></div><button type="button" className="h-btn" disabled={busy} aria-pressed={selected?.id===p.id} onClick={()=>{setSelected(p);setReview(false);setSent(false);setNotice('');setError('')}}>{selected?.id===p.id?'Seleccionado':'Seleccionar'}<span className="communications-sr"> a {p.email}</span></button></li>)}</ul>:<p>No hay usuarios que coincidan con la búsqueda.</p>}
    </>}
    {selected&&<div className="communications-compose"><h3>Mensaje para {selected.alias||'el usuario seleccionado'}</h3><p><strong>Para:</strong> {selected.email}</p>
      <div className="system-actions"><button className="h-btn" disabled={busy} onClick={copy}>Copiar correo</button><button className="h-btn" disabled={busy} onClick={exportContact}>Exportar contacto para Brevo</button></div>
      <p>El CSV incluye únicamente esta persona. No identifica quién dio feedback ni suscribe a nadie a novedades.</p>
      <form onSubmit={e=>{e.preventDefault();setError('');setReview(true)}}>
        <fieldset disabled={busy}><label>Asunto<input required maxLength={160} value={draft.subject} onChange={e=>change('subject',e.target.value)}/></label><label>Texto de vista previa<input maxLength={200} value={draft.preview} onChange={e=>change('preview',e.target.value)}/></label><label>Mensaje<textarea required maxLength={5000} rows={9} value={draft.message} onChange={e=>change('message',e.target.value)}/></label><button className="h-btn" disabled={sent}>Revisar mensaje</button></fieldset>
      </form>
      {review&&<div className="communications-preview"><h3>Vista previa del mensaje</h3><p><strong>Para:</strong> {selected.email}</p><p><strong>Asunto:</strong> {draft.subject}</p><p><small>{draft.preview}</small></p><div className="communications-message">{draft.message}</div>
        <p>Se enviará a una sola persona. Comprueba que participó en el feedback inicial antes de agradecerle su colaboración.</p>
        {connection?.ready?<p>Remitente: {connection.sender}</p>:<p>Envío desde Lyra pendiente de configuración. Puedes usar Copiar correo o Exportar contacto para enviarlo desde Brevo.</p>}
        <button type="button" className="h-btn primary" disabled={busy||!connection?.ready||sent} onClick={send}>{busy?'Enviando…':'Enviar a esta persona'}</button>
      </div>}
    </div>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  </section>
}
