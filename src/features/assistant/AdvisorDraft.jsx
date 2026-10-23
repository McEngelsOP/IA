import { useEffect, useRef, useState } from 'react'
export default function AdvisorDraft({ draft, onChange, client, userId, saved, operationId, beforeSave }) {
  const [busy,setBusy]=useState(false), [message,setMessage]=useState('')
  const lock=useRef(false), approval=useRef(null), alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  async function invoke(action,extra={}) {
    const {data,error}=await client.functions.invoke('study-advisor',{body:{action,draft,operationId,...extra}})
    if(error||data?.error){let code=data?.error;try{code ||= (await error?.context?.json())?.error}catch{};throw Error(code||'save_failed')}
    return data
  }
  async function save(event) {
    event.preventDefault();if(lock.current||saved)return
    lock.current=true;setBusy(true);setMessage('')
    try {
      const verified=await client.auth.getUser()
      if(verified.error||verified.data.user?.id!==userId)throw Error('unauthorized')
      await beforeSave()
      const fingerprint=JSON.stringify(draft)
      // Reuse the exact approval on network failure: a retry must not create a second record.
      if(!approval.current||approval.current.fingerprint!==fingerprint||approval.current.expires<=Date.now())approval.current={...await invoke('prepare_draft'),fingerprint}
      const result=await invoke('save_draft',{approval:approval.current.token})
      if(!result.saved?.id)throw Error('save_failed')
      if(!alive.current)return
      onChange({...draft},true);setMessage('Guardado en tu calendario y tareas.')
    }catch(error){if(!alive.current)return;setMessage(error.message==='unauthorized'?'Tu sesión venció. Vuelve a iniciar sesión; el borrador se conserva.':error.message==='approval_invalid'?'La aprobación venció. Reintenta: conservaremos la misma operación para evitar duplicados.':'No se pudo confirmar el guardado. Reintenta sin cambiar el borrador para evitar duplicados.')}
    finally{lock.current=false;if(alive.current)setBusy(false)}
  }
  const edit=(key,value)=>{approval.current=null;setMessage('');onChange({...draft,[key]:value})}
  return <form className="advisor-draft" onSubmit={save} aria-label="Revisar borrador">
    <strong>{draft.kind==='task'?'Borrador de tarea':'Borrador de evento'}</strong>
    <p>Revisa los datos antes de guardar.</p>
    <fieldset disabled={busy||saved}>
      <label>Título<input required maxLength={160} value={draft.title} onChange={e=>edit('title',e.target.value)}/></label>
      <label>Fecha<input required type="date" value={draft.date} onChange={e=>edit('date',e.target.value)}/></label>
      {draft.kind==='event'&&<div className="advisor-draft-hours"><label>Desde<input type="time" value={draft.start_time} onChange={e=>edit('start_time',e.target.value)}/></label><label>Hasta<input type="time" value={draft.end_time} onChange={e=>edit('end_time',e.target.value)}/></label></div>}
      <button type="submit">{saved?'Guardado':busy?'Guardando…':'Guardar'}</button>
    </fieldset>
    <p role="status">{message}</p>
  </form>
}
