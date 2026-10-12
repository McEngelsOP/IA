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
