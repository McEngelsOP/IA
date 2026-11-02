import { useRef, useState } from 'react'

export default function AIAffiliationAdmin({ client, onBusy }) {
  const [account, setAccount] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const locked = useRef(false)
  async function update(verified) {
    if (locked.current) return
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account.trim())) { setError('Ingresa el UUID completo de la cuenta.'); return }
    if (verified && !confirmed) { setError('Confirma que revisaste una prueba de afiliación ESAN.'); return }
    locked.current = true; setBusy(true); onBusy(true); setNotice(''); setError('')
    try {
      const { error } = await client.rpc('admin_set_ai_affiliation', { p_user_id: account.trim(), p_verified: verified, p_source: 'manual_review' })
      if (error) throw error
      setNotice(verified ? 'Afiliación verificada durante 180 días. El alumno puede actualizar Mi IA para elegir el servicio de Lyra.' : 'Acceso compartido revocado. Las próximas consultas requerirán una clave propia.')
      setConfirmed(false)
    } catch { setError('No se pudo cambiar la afiliación. Revisa el UUID, que la cuenta pertenezca a ESAN y tus permisos de administrador.') }
    finally { locked.current = false; setBusy(false); onBusy(false) }
  }
  return <section className="pai-add" aria-label="Verificación administrativa de IA">
    <h3>Verificar afiliación ESAN</h3><p>Solo administradores. Revisa una prueba institucional antes de habilitar la cuota compartida. Elegir ESAN durante el registro no verifica la afiliación.</p>
    <fieldset disabled={busy}><label htmlFor="ai-affiliation-account">UUID de la cuenta</label><input id="ai-affiliation-account" value={account} onChange={e=>setAccount(e.target.value)} autoComplete="off" spellCheck={false}/>
    <label className="pai-attestation"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Revisé una prueba de afiliación ESAN vigente.</label>
    <div><button type="button" className="h-btn primary" disabled={!confirmed} onClick={()=>update(true)}>Verificar por 180 días</button> <button type="button" className="h-btn" onClick={()=>update(false)}>Revocar acceso compartido</button></div></fieldset>
    {error&&<p role="alert">{error}</p>}<p role="status">{busy?'Actualizando afiliación…':notice}</p>
  </section>
}
