import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import OfficialIcon from '../../shared/components/OfficialIcon.jsx'
import '../../shared/styles/OfficialSurfaces.css'
import { MAILBOX_TYPES } from '../../shared/data/mailboxTypes.js'
import { getSupabaseClient } from '../../shared/lib/getSupabaseClient.js'

let draftOwner = null, mailboxDrafts = {}
function OfficialMailbox({ category = 'Aplicativo', career = 'ia', courses = [], onCategory, draftKey = 'guest' }) {
  if (draftOwner !== draftKey) { draftOwner = draftKey; mailboxDrafts = {} }
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [drafts, setDrafts] = useState(() => mailboxDrafts)
  const config = MAILBOX_TYPES[category] || MAILBOX_TYPES.Aplicativo
  const draft = drafts[category] || { type: -1, text: '', severity: '', fields: {} }
  const changeDrafts = update => setDrafts(all => { const next = update(all); mailboxDrafts = next; return next })
  const update = patch => { setStatus(''); changeDrafts(all => ({ ...all, [category]: { ...draft, ...patch } })) }
  const isError = draft.type === config.err
  const fields = config.f.filter(f => !f[6] || f[6].includes(draft.type))
  async function send(e) {
    e.preventDefault()
    if (sending.current || draft.type < 0 || draft.text.trim().length < 25) return
    sending.current = true; setBusy(true); setStatus('Enviando…')
    const owner = draftKey
    try {
      const client = getSupabaseClient()
      const session = await client?.auth.getSession()
      const token = session?.data?.session?.access_token
      if (!token) { setStatus('Inicia sesión para enviar tu mensaje. Conservamos tu borrador.'); return }
      const response = await fetch('/api/mailbox', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ categoria: category, tipo: config.tipos[draft.type][0],
          carrera: career, mensaje: draft.text.trim(),
          detalles: Object.fromEntries(fields.filter(([key]) => draft.fields[key]).map(([key, label]) => [label, draft.fields[key]])),
          gravedad: isError ? draft.severity : '' })
      })
      if (response.status === 401) { setStatus('Tu sesión venció. Vuelve a ingresar; conservamos tu borrador.'); return }
      if (response.status === 429) { setStatus('Has enviado varios mensajes. Espera antes de reintentar; conservamos tu borrador.'); return }
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error('unconfirmed')
      if (draftOwner === owner) changeDrafts(all => ({ ...all, [category]: undefined }))
      setStatus('Mensaje registrado en el buzón del aplicativo. Gracias por escribirnos.')
    } catch {
      setStatus('No pudimos confirmar la recepción. Conservamos tu borrador para que puedas reintentar más tarde.')
    } finally { sending.current = false; setBusy(false) }
  }
  return <div className="z-wrap official-mailbox">
    <div className="seg z-tabs" role="group" aria-label="Destinatario del buzón">{Object.keys(MAILBOX_TYPES).map(name => <button className={name === category ? 'on' : ''} aria-pressed={name === category} key={name} disabled={busy} onClick={() => onCategory(name)}>{name}</button>)}</div>
    <section className="blk hl z-hero"><span className="z-hi"><OfficialIcon name={category === 'Aplicativo' ? 'monitor' : category === 'Docente' ? 'cap' : 'landmark'} size={26}/></span><div><h2>{category}</h2><p>{config.sc}</p></div></section>
    <div className="z-grid"><form className="blk z-main" aria-label={`Buzón · ${category}`} onSubmit={send}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className={`z-sec${draft.type >= 0 ? ' done' : ''}`}><div className="z-sh"><span className="z-n">{draft.type >= 0 ? <OfficialIcon name="check" size={14}/> : 1}</span><div><h3>{config.lbl}</h3><small>Elige una opción</small></div></div><div className="z-og" role="group" aria-label={config.lbl}>{config.tipos.map(([title, description, icon], i) => <button type="button" className={`z-o${draft.type === i ? ' on' : ''}`} aria-pressed={draft.type === i} key={title} onClick={() => update({ type: i })}><span className="ico"><OfficialIcon name={icon}/></span><span><b>{title}</b><small>{description}</small></span><span className="rd">{draft.type === i && <OfficialIcon name="check" size={12}/>}</span></button>)}</div></div>
      <div className="z-sec"><div className="z-sh"><span className="z-n">2</span><div><h3>Detalles</h3><small>Ayuda a ubicar el tema de tu mensaje</small></div></div><div className="z-fg">{fields.map(([key, label, kind, options, placeholder]) => <div className="z-f" key={key}><label htmlFor={`mail-${key}`}>{label}</label>{kind === 'sel' ? <select id={`mail-${key}`} className="k-sel" value={draft.fields[key] || ''} onChange={e => update({ fields: { ...draft.fields, [key]: e.target.value } })}><option value="">{placeholder}</option>{(key === 'course' ? courses.map(c => c.n) : options).map(o => <option key={o}>{o}</option>)}</select> : <input id={`mail-${key}`} className="k-sel" value={draft.fields[key] || ''} maxLength={80} placeholder={placeholder} onChange={e => update({ fields: { ...draft.fields, [key]: e.target.value } })}/>}</div>)}{isError && <div className="z-f"><span id="mail-severity">Gravedad del error</span><div className="k-row" role="group" aria-labelledby="mail-severity">{['Leve', 'Moderado', 'Grave'].map(v => <button type="button" className={`k-chip${draft.severity === v ? ' on' : ''}`} key={v} aria-pressed={draft.severity === v} onClick={() => update({ severity: v })}>{v}</button>)}</div></div>}</div></div>
      <div className={`z-sec${draft.text.trim().length >= 25 ? ' done' : ''}`}><div className="z-sh"><span className="z-n">{draft.text.trim().length >= 25 ? <OfficialIcon name="check" size={14}/> : 3}</span><div><h3>Tu mensaje</h3><small>Mínimo 25 caracteres</small></div>{isError && <button className="k-btn" type="button" onClick={() => update({ text: ((draft.text ? draft.text + '\n\n' : '') + config.tpl).slice(0, 800) })}>Usar plantilla</button>}</div><textarea className="z-ta" aria-label="Tu mensaje" value={draft.text} maxLength={800} placeholder={config.ph[Math.max(0, draft.type)]} onChange={e => update({ text: e.target.value })}/><div className="z-meta"><span>Describe hechos concretos</span><span>{draft.text.length}/800</span></div></div>
      </fieldset><div className="z-foot"><span className="z-fs" id="mail-status" role="status">{status || 'Envío anónimo. El mensaje se guarda en el buzón del aplicativo.'}</span><button className="k-btn" type="button" disabled={busy} onClick={() => { setStatus(''); changeDrafts(all => ({ ...all, [category]: undefined })) }}>Limpiar</button><button className="mk" type="submit" disabled={busy || draft.type < 0 || draft.text.trim().length < 25} aria-describedby="mail-status">{busy ? 'Enviando…' : config.send}</button></div>
    </form><aside className="z-side" aria-label="Ayuda para escribir"><section className="blk"><h2 className="bt"><OfficialIcon name="spark"/>Para que sea útil</h2><ul className="z-ul">{config.tips.map(t => <li key={t}><OfficialIcon name="check" size={16}/><span>{t}</span></li>)}</ul></section><section className="blk"><h2 className="bt"><OfficialIcon name="clock"/>Estado del buzón</h2><p>Los mensajes de las tres áreas se registran en la hoja del responsable del aplicativo. No se envían automáticamente al docente ni a la universidad.</p></section><div className="z-pv"><OfficialIcon name="lock" size={16}/><span>No escribas contraseñas ni datos personales de terceros.</span></div></aside></div>
  </div>
}
export function mountOfficialMailbox(container, props) { const root = createRoot(container); root.render(<OfficialMailbox {...props}/>); return () => root.unmount() }

