import {normalizeLayout} from '../../features/home/homeLayout.js'
const keys = ['homeLayout','homeOrder', 'glow', 'diagnosis', 'theme', 'sidebar', 'focus', 'notifications']
const safe = value => value && typeof value === 'object' && !Array.isArray(value)
export function normalizePreferences(input) {
  if (!safe(input)) return {}
  const result = {}
  if(safe(input.homeLayout))result.homeLayout=normalizeLayout(input.homeLayout)
  if (['light','dark'].includes(input.theme)) result.theme = input.theme
  if (['full','rail'].includes(input.sidebar)) result.sidebar = input.sidebar
  if (Array.isArray(input.homeOrder)) result.homeOrder = [...new Set(input.homeOrder.filter(k => ['hero','hoy','stats','notas','racha','semestre','panel'].includes(k)))]
  if (safe(input.glow)) result.glow = { on: input.glow.on !== false, lv: Math.max(10, Math.min(100, Number(input.glow.lv) || 100)) }
  if (safe(input.focus)) result.focus = Object.fromEntries(Object.entries(input.focus).filter(([k,v]) => ({ method:['p25','p45','p90','custom'], companion:['cat','rabbit','owl'], clockStyle:['ring','arc','dots','digital'] })[k]?.includes(v)))
  if (safe(input.diagnosis)) {
    const d = input.diagnosis
    result.diagnosis = { ...(Number.isFinite(d.t) ? { t: d.t } : {}), p: Object.fromEntries(Object.entries(safe(d.p) ? d.p : {}).slice(0, 500).filter(([id, rows]) => id.length <= 180 && Array.isArray(rows)).map(([id,rows]) => [id, rows.slice(0,30).filter(safe).map(r => ({ n: String(r.n || 'Evaluación').slice(0,120), w: Number.isFinite(+r.w) ? Math.max(0,Math.min(100,+r.w)) : 0, s: Number.isFinite(r.s) ? r.s : null }))])) }
  }
  if (safe(input.notifications)) {
    const n = input.notifications, time = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : ''
    let zone = n.timeZone || 'America/Lima'
    try { new Intl.DateTimeFormat('en', { timeZone: zone }) } catch { zone = 'America/Lima' }
    result.notifications = { enabled: n.enabled === true, weekly: n.weekly === true, quietStart: time(n.quietStart), quietEnd: time(n.quietEnd), leadMinutes: [15,30,60].includes(n.leadMinutes) ? n.leadMinutes : 30, timeZone: zone }
  }
  return result
}
export function createPreferenceSync({ client, storage = localStorage, onChange = () => {}, onStatus = () => {} }) {
  let owner = null, generation = 0, values = {}, pending = {}, running = false, timer, disposed = false
  const cacheKey = id => `lyra-preferences:${id}`
  function persist() { if (owner) try { storage.setItem(cacheKey(owner), JSON.stringify({ values, pending })) } catch { onStatus('No se pudo guardar la copia local.') } }
  function emit() { onChange(structuredClone(values)) }
  async function refresh() {
    if (!owner || disposed) return
    const id = owner, gen = generation
    onStatus(Object.keys(pending).length ? 'Cambios pendientes de sincronizar' : 'Sincronizando…')
    try {
      const result = await client.from('student_preferences').select('values,updated_at').eq('student_id', id).maybeSingle()
      if (gen !== generation || disposed) return
      if (result.error) throw result.error
      const remote = normalizePreferences(result.data?.values)
      // Only import local legacy keys when that key does not exist in the account.
      for (const key of keys) if (!(key in remote) && key in values && !(key in pending)) pending[key] = values[key]
      values = { ...remote, ...pending }; persist(); emit()
      if (Object.keys(pending).length) await flush()
      else onStatus('Preferencias sincronizadas')
    } catch { if (gen === generation) onStatus('Sin conexión o servicio no disponible · cambios conservados en este equipo') }
  }
  async function flush() {
    if (running || !owner || !Object.keys(pending).length || disposed) return
    running = true
    const id = owner, gen = generation, batch = structuredClone(pending)
    try {
      const verified = await client.auth.getUser()
      if (gen !== generation || verified.error || verified.data.user?.id !== id) return
      const result = await client.rpc('save_lyra_preferences', { p_patch: batch, p_owner: id })
      if (gen !== generation || disposed) return
      if (result.error || !safe(result.data?.values)) throw result.error || new Error('invalid_response')
      for (const key of Object.keys(batch)) if (JSON.stringify(pending[key]) === JSON.stringify(batch[key])) delete pending[key]
      values = { ...normalizePreferences(result.data.values), ...pending }; persist(); emit(); onStatus('Preferencias sincronizadas')
    } catch { if (gen === generation) onStatus('Pendiente de sincronizar · cambios conservados en este equipo') }
    finally { running = false; if(gen!==generation && owner && !disposed) void flush() }
    if (gen === generation && Object.keys(pending).length && JSON.stringify(pending) !== JSON.stringify(batch)) void flush()
  }
  return {
    async start(id, legacy = {}) {
      generation++; owner = id; values = {}; pending = {}; disposed = false
      try { const saved = JSON.parse(storage.getItem(cacheKey(id))); values = normalizePreferences(saved?.values); pending = normalizePreferences(saved?.pending) } catch { /* No previous copy. */ }
      values = { ...normalizePreferences(legacy), ...values }; emit(); await refresh()
    },
    set(key, value) { if (!owner || !keys.includes(key)) return; const clean = normalizePreferences({[key]:value}); if (!(key in clean)) return; values[key] = clean[key]; pending[key] = clean[key]; persist(); clearTimeout(timer); timer = setTimeout(flush, 450) },
    get: key => values[key], refresh, flush,
    stop() { generation++; owner = null; values = {}; pending = {}; disposed = true; clearTimeout(timer) }
  }
}
