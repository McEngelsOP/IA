import { todayLima, labelDate } from '../../core/calendar/calendarModel.js'
export { todayLima }
export const FOCUS_PRESETS = [['p25','Pomodoro · 25 min',1500],['p45','Estudio · 45 min',2700],['p90','Profundo · 90 min',5400],['custom','Personalizado',0]]
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })
export function enrolledFocusCourses(courses, statuses, done = new Set()) {
  return courses.filter(c => statuses[c.id]?.status === 'matriculado' && !done.has(c.id)).sort((a,b) => collator.compare(a.n,b.n) || a.id.localeCompare(b.id))
}
export const focusRemaining = (end, now = Date.now()) => Math.max(0, Math.ceil((end - now) / 1000))
export function focusDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0)), h = Math.floor(value/3600), m = Math.floor(value%3600/60), s = value%60
  return h ? `${h} h${m ? ` ${m} min` : ''}` : m ? `${m} min` : `${s} s`
}
export function focusMotivation(summary, day, today = todayLima()) {
  if (!summary?.seconds) return day === today ? 'Tu próximo momento de estudio empieza aquí. Elige un tiempo que puedas sostener.' : 'No hay tiempo de estudio registrado en esta fecha.'
  const date = day === today ? 'Hoy' : `El ${labelDate(day,{day:'numeric',month:'long',year:'numeric'})}`
  return `${date} sumaste ${focusDuration(summary.seconds)} de estudio. ${summary.completed_count ? '¡Buen trabajo! Sigue así, una sesión a la vez.' : 'Cada momento cuenta. Puedes retomar cuando estés listo.'}`
}
export function focusError(error) {
  const messages = {
    NO_AUTH: 'Tu sesión venció. Vuelve a iniciar sesión.', PROFILE_REQUIRED: 'Completa tu perfil para guardar sesiones.',
    COURSE_NOT_ENROLLED: 'Este curso ya no está marcado como matriculado. Actualiza tu matrícula y vuelve a elegirlo.',
    FOCUS_ALREADY_ACTIVE: 'Ya tienes una sesión abierta. Reintenta la carga para retomarla.',
    FOCUS_UNAVAILABLE: 'No se pudo recuperar esta sesión. Reintenta la carga.',
    FOCUS_NOT_FINISHED: 'Aún queda tiempo de esta sesión. Se actualizará el reloj para continuar.',
    FOCUS_START_LIMIT: 'Has iniciado muchas sesiones seguidas. Espera un momento y reintenta.',
    INVALID_FOCUS: 'Elige un método válido y una duración entre 5 minutos y 3 horas y 55 minutos.'
  }
  const key = Object.keys(messages).find(k => error?.message?.includes(k))
  return key ? messages[key] : ['PGRST202','PGRST205'].includes(error?.code) ? 'El historial de Mod Focus necesita configuración en el servidor. Usa Reintentar cuando esté disponible.' : 'No se pudo guardar el cambio. Tu sesión se conserva; reintenta.'
}
