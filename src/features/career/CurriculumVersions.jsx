import '../account/system.css'
import { useEffect, useState } from 'react'
import { compareCurricula } from '../../core/academic/curriculumVersions.js'
export default function CurriculumVersions({ client, user, catalog, onUpdated = () => {}, onBusy = () => {} }) {
  const [versions, setVersions] = useState([]), [target, setTarget] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false)
  useEffect(() => { let alive = true; if (user && client) client.from('curriculum_versions').select('version,plan_year,plan_name,published_at,catalog').eq('institution_id', catalog.institutionId).eq('career_key', catalog.key).order('published_at', { ascending: false }).then(r => { if (alive) { if (r.error) setError('No pudimos consultar las versiones.'); else setVersions(r.data || []) } }); return () => { alive = false } }, [catalog.version, user?.id])
  async function update() {
    if (busy || !confirmed) return
    setBusy(true);onBusy(true); setError('')
    try {
      const verified = await client.auth.getUser()
      if (verified.error || verified.data.user?.id !== user.id) throw new Error('session')
      const r = await client.rpc('upgrade_curriculum', { p_expected: catalog.version, p_target: target.version, p_owner: user.id })
      if (r.error) throw r.error
      onUpdated()
    } catch (e) { setError(e?.message?.includes('EQUIVALENCE_REVIEW_REQUIRED') ? 'Hay cursos aprobados o matriculados que requieren una equivalencia institucional. Se conserva tu malla actual; envía un reporte académico desde Preferencias.' : 'No se pudo actualizar. Tu malla y tu avance se conservan; vuelve a consultar las versiones.') }
    finally { setBusy(false);onBusy(false) }
  }
  const diff = target?.catalog ? compareCurricula(catalog, target.catalog) : null
  const current = versions.find(v => v.version === catalog.version)
  return <details className="oc-versions"><summary>Versiones y actualización de mi malla</summary><p>Plan: {current?.plan_name || 'Sin denominación oficial registrada'} · Año: {current?.plan_year || 'Por verificar'} · Revisión: {catalog.version}</p>
    {versions.filter(v => v.version !== catalog.version && v.catalog && v.published_at).length ? <label>Comparar con<select disabled={busy} value={target?.version || ''} onChange={e => { setTarget(versions.find(v => v.version === e.target.value)); setConfirmed(false) }}><option value="">Selecciona una versión</option>{versions.filter(v => v.version !== catalog.version && v.catalog && v.published_at).map(v => <option key={v.version} value={v.version}>{v.plan_name || v.version} · {v.plan_year || 'Año por verificar'}</option>)}</select></label> : <p>No hay otra versión publicada para esta carrera.</p>}
    {diff && <><p>{diff.added.length} cursos añadidos · {diff.removed.length} retirados · {diff.changed.length} modificados.</p><ul>{diff.added.map(c => <li key={'a'+c.id}>Añadido: {c.n} · {c.cr} créditos</li>)}{diff.removed.map(c => <li key={'r'+c.id}>Retirado: {c.n}</li>)}{diff.changed.map(c => <li key={'c'+c.after.id}>{c.after.n}: {c.fields.map(f => ({ n: 'nombre', cr: `créditos ${c.before.cr} → ${c.after.cr}`, c: 'ciclo', r: `requisitos ${c.before.r.join(', ') || 'ninguno'} → ${c.after.r.join(', ') || 'ninguno'}`, rc: 'créditos requeridos', requirementNote: 'observaciones de requisitos' })[f]).join(' · ')}</li>)}</ul><p>Se conserva una copia del registro anterior. Los cursos con el mismo identificador mantienen su avance. Las equivalencias pendientes requieren revisión.</p><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/> Revisé los cambios y quiero actualizar mi malla</label><button type="button" className="h-btn" disabled={!confirmed || busy} onClick={update}>{busy ? 'Actualizando…' : 'Actualizar conservando mi avance'}</button></>}
    {error && <p role="alert">{error}</p>}
  </details>
}
