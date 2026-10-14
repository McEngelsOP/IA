import { MAILBOX_TYPES } from '../src/data/mailboxTypes.js'

const endpoint = 'https://script.google.com/macros/s/AKfycbxgNhhnNAki37rL0hYDxnpl2ZCO9shPc3WXr5NWjHLouoIitJBUqD9ZeOEzeT3gEkryEQ/exec'
const safeCell = text => /^[=+@-]/.test(text) ? "'" + text : text
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }) }
  try {
    const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const config = MAILBOX_TYPES[data?.categoria]
    if (!config || !config.tipos.some(([name]) => name === data.tipo) ||
      typeof data.mensaje !== 'string' || data.mensaje.trim().length < 25 || data.mensaje.length > 800 ||
      typeof data.carrera !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(data.carrera)) return res.status(400).json({ ok: false })
    const details = data.detalles || {}
    const allowed = new Set(config.f.map(f => f[1]))
    if (typeof details !== 'object' || Array.isArray(details) || Object.entries(details).some(([k,v]) =>
      !allowed.has(k) || typeof v !== 'string' || v.length > 160)) return res.status(400).json({ ok: false })
    if (data.gravedad && !['Leve','Moderado','Grave'].includes(data.gravedad)) return res.status(400).json({ ok: false })
    const message = [data.mensaje.trim(), ...Object.entries(details).map(([k,v]) => k + ': ' + v),
      ...(data.gravedad ? ['Gravedad: ' + data.gravedad] : [])].join('\n\n')
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fecha_legible: new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }),
        carrera: data.carrera, alias: 'Anónimo', categoria: data.categoria,
        categoria_nombre: data.categoria + ' · ' + data.tipo, mensaje: safeCell(message) }),
      signal: AbortSignal.timeout(25000), redirect: 'follow'
    })
    if (!response.ok || (await response.text()).trim() !== 'OK') {
      console.error('Mailbox upstream did not confirm reception')
      return res.status(502).json({ ok: false })
    }
    return res.status(200).json({ ok: true })
  } catch {
    console.error('Mailbox request failed')
    return res.status(502).json({ ok: false })
  }
}
