// Catálogo de logros: las CLAVES deben coincidir con el CHECK de la
// tabla logros y con reclamar_logros() (query 27 · logros.sql).
// Las condiciones se validan SIEMPRE en el servidor; esto es solo
// la parte visual. Los logros son privados: solo los ve su dueño.

export const LOGROS = {
  'primer-paso': { icon: '👣', name: 'Primer paso', desc: 'Marca tu primer curso como llevado' },
  'en-marcha': { icon: '🚶', name: 'En marcha', desc: 'Lleva 10 cursos de tu malla' },
  'medio-camino': { icon: '⛰️', name: 'Medio camino', desc: 'Lleva 25 cursos de tu malla' },
  'veterano': { icon: '🎓', name: 'Veterano', desc: 'Lleva 45 cursos de tu malla' },
  'primera-resena': { icon: '✍️', name: 'Primera reseña', desc: 'Escribe tu primera reseña de un curso' },
  'critico': { icon: '📝', name: 'Crítico de culto', desc: 'Escribe 5 reseñas de cursos' },
  'voz-del-aula': { icon: '📣', name: 'Voz del aula', desc: 'Sugiere tu primer profesor' },
  'orientador': { icon: '🧭', name: 'Orientador', desc: 'Pon 10 etiquetas a profesores' },
  'aporte-herramienta': { icon: '🧰', name: 'Caja de herramientas', desc: 'Comparte una herramienta de estudio' },
  'arcade-novato': { icon: '🕹️', name: 'Novato del arcade', desc: 'Guarda tu primer puntaje en el ranking' },
  'arcade-completo': { icon: '🏟️', name: 'Cinco estrellas', desc: 'Guarda puntaje en los 5 juegos' },
  'arcade-10k': { icon: '💯', name: 'Diez mil', desc: 'Supera los 10 000 puntos en un juego' },
  'identidad': { icon: '🎭', name: 'Identidad secreta', desc: 'Elige tu nombre secreto' }
}
