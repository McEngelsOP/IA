export function accessDescription(access) {
  if (access?.sharedEligible) return 'Afiliación ESAN verificada. Puedes elegir el servicio de Lyra o tus propias claves.'
  if (access?.verificationStatus === 'external') return 'Tu universidad requiere una clave de API propia para usar la IA.'
  return 'Necesitas una clave propia mientras tu afiliación ESAN no esté verificada y vigente. Un administrador puede revisar tu afiliación.'
}
export function usageDescription(usage) {
  if (!Number.isFinite(usage?.dailyRemaining)) return 'La cuota se comprobará en el servidor antes de cada consulta.'
  const pause=usage.allowed===false&&usage.nextAvailableAt?` Puedes reintentar desde las ${new Date(usage.nextAvailableAt).toLocaleTimeString('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit'})} (Lima).`:''
  return `${usage.source === 'system' ? 'Servicio de Lyra' : 'Tu proveedor'} · ${usage.remaining}/${usage.limit} disponibles en 15 minutos · ${usage.dailyRemaining}/${usage.dailyLimit} hoy (Lima).${pause}`
}
