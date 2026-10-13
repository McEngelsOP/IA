export const wordCount = value => value.trim() ? value.trim().split(/\s+/u).length : 0
export function resourceUrl(value) {
  const raw = value.trim()
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new Error('INVALID_RESOURCE_URL')
  url.hash = ''
  return url.href
}
export function resourceError(error) {
  const errors = { RESOURCE_DUPLICATE: 'Este enlace ya está publicado. Busca el recurso existente para darle corazón.', INVALID_RESOURCE_URL: 'Escribe un enlace válido de un sitio web, sin usuario ni contraseña.', RESOURCE_DESCRIPTION: 'El comentario admite hasta 25 palabras y 500 caracteres.', RESOURCE_LIMIT: 'Ya compartiste 20 recursos. Puedes editar los comentarios de los tuyos.', RESOURCE_NOT_OWNED: 'Solo el autor puede editar este comentario.', INVALID_RESOURCE_NAME: 'El nombre debe tener entre 2 y 60 caracteres.', NO_AUTH: 'Inicia sesión para compartir recursos o darles corazón.' }
  const key = Object.keys(errors).find(k => error?.message?.includes(k))
  return key ? errors[key] : 'No se pudo guardar. Tus datos se conservan; reintenta.'
}

const RESOURCE_ICON_HOSTS = {
  'grok.com': 'grok.com',
  'claude.ai': 'claude.ai',
  'claude.com': 'claude.ai',
  'gemini.google.com': 'gemini.google.com',
  'theastudy.com': 'theastudy.com',
  'auth.tidbcloud.com': 'tidbcloud.com',
  'tidbcloud.com': 'tidbcloud.com',
  'gamma.app': 'gamma.app',
  'canva.com': 'canva.com',
  'supabase.com': 'supabase.com',
  'notebooklm.google': 'notebooklm.google',
  'notebooklm.google.com': 'notebooklm.google',
  'notebook.google': 'notebooklm.google'
}

const RESOURCE_ICON_ASSETS = {
  'grok.com': new URL('../assets/resource-icons/grok.com.png', import.meta.url).href,
  'claude.ai': new URL('../assets/resource-icons/claude.ai.png', import.meta.url).href,
  'gemini.google.com': new URL('../assets/resource-icons/gemini.google.com.png', import.meta.url).href,
  'theastudy.com': new URL('../assets/resource-icons/theastudy.com.png', import.meta.url).href,
  'tidbcloud.com': new URL('../assets/resource-icons/tidbcloud.com.png', import.meta.url).href,
  'gamma.app': new URL('../assets/resource-icons/gamma.app.png', import.meta.url).href,
  'canva.com': new URL('../assets/resource-icons/canva.com.png', import.meta.url).href,
  'supabase.com': new URL('../assets/resource-icons/supabase.com.png', import.meta.url).href,
  'notebooklm.google': new URL('../assets/resource-icons/notebooklm.google.png', import.meta.url).href
}

/** Packaged icons avoid hotlink blocks. Remote fallbacks receive only the host. */
export function resourceIconSources(value) {
  try {
    const url = new URL(resourceUrl(value))
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!host.includes('.') || host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return []
    const known = RESOURCE_ICON_HOSTS[host]
    const iconHost = known || host
    const local = known ? [RESOURCE_ICON_ASSETS[known]] : []
    return [
      ...local,
      'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(iconHost) + '&sz=64',
      'https://icons.duckduckgo.com/ip3/' + encodeURIComponent(iconHost) + '.ico',
      new URL('/favicon.ico', url).href
    ]
  } catch { return [] }
}
