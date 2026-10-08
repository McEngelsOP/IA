export const ROOM_PAGE_SIZE = 30
export const MESSAGE_PAGE_SIZE = 50
const ERRORS = {
  NO_AUTH: 'Tu sesión venció. Vuelve a iniciar sesión.',
  PROFILE_REQUIRED: 'Completa tu perfil para participar en una sala.',
  ROOM_LIMIT: 'Ya creaste cinco salas. Cierra una de ellas para crear otra.',
  INVALID_ROOM: 'Revisa el curso, el nombre y los datos de la sala.',
  INVALID_NAME: 'Elige un nombre de 2 a 40 caracteres para aparecer en la sala.',
  ROOM_UNAVAILABLE: 'No puedes acceder a esta sala. Revisa el código o vuelve al listado.',
  ROOM_FULL: 'La sala alcanzó su límite de 100 participantes.',
  MEMBERSHIP_LIMIT: 'Ya participas en 50 salas. Sal de una antes de unirte a otra.',
  INVALID_MESSAGE: 'Escribe un mensaje de hasta 1200 caracteres.',
  MESSAGE_LIMIT: 'Enviaste diez mensajes en el último minuto. Espera un momento y reintenta.',
  OWNER_CANNOT_LEAVE: 'Como creador, puedes cerrar la sala desde sus opciones.'
}
export function studyError(error, fallback = 'No se pudo completar la acción. Tus datos y el borrador se conservan; reintenta.') {
  const key = Object.keys(ERRORS).find(key => error?.message?.includes(key))
  if (key) return ERRORS[key]
  if (['PGRST202', 'PGRST205'].includes(error?.code)) return 'Grupos de estudio aún necesita configuración en el servidor. Reintenta cuando esté disponible.'
  return fallback
}
export function mergeMessages(current, incoming) {
  return [...new Map([...current, ...incoming].map(message => [message.id, message])).values()]
    .sort((a, b) => (Date.parse(a.created_at) - Date.parse(b.created_at)) || a.id.localeCompare(b.id))
}
export const cleanInvite = code => code.trim().replace(/[\s-]/g, '').toLowerCase()
export function validRoom(draft, courses) {
  if (!courses.some(c => c.id === draft.course)) return 'Elige un curso de tu malla.'
  if (draft.name.trim().length < 2 || draft.name.trim().length > 80) return 'Escribe un nombre de 2 a 80 caracteres para la sala.'
  if (draft.nickname.trim().length < 2 || draft.nickname.trim().length > 40) return ERRORS.INVALID_NAME
  if (draft.description.length > 500) return 'La descripción admite hasta 500 caracteres.'
  return ''
}
