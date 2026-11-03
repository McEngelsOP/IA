export function accessDescription(access) {
  if (access?.sharedEligible) return 'Afiliación ESAN verificada. Puedes elegir el servicio de Lyra o tus propias claves.'
  if (access?.verificationStatus === 'external') return 'Tu universidad requiere una clave de API propia para usar la IA.'
  if (access?.verificationStatus === 'pending') return 'Tu cuenta está registrada en ESAN y su afiliación aún está pendiente de verificación. Un administrador debe revisarla para habilitar el servicio de Lyra. Mientras tanto, puedes usar una clave propia.'
  if (access?.verificationStatus === 'expired') return 'Tu verificación ESAN venció. Solicita su renovación para volver a usar el servicio de Lyra; mientras tanto, puedes usar una clave propia.'
  if (access?.verificationStatus === 'revoked') return 'Tu acceso compartido fue revocado. Solicita una revisión de tu afiliación ESAN o utiliza una clave propia.'
  return 'No se pudo confirmar una afiliación ESAN vigente. Revisa el acceso de tu cuenta en Mi IA antes de configurar una clave propia.'
}
export function usageDescription(usage) {
  if (!Number.isFinite(usage?.dailyRemaining)) return 'La cuota se comprobará en el servidor antes de cada consulta.'
  const pause=usage.allowed===false&&usage.nextAvailableAt?` Puedes reintentar desde las ${new Date(usage.nextAvailableAt).toLocaleTimeString('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit'})} (Lima).`:''
  return `${usage.source === 'system' ? 'Servicio de Lyra' : 'Tu proveedor'} · ${usage.remaining}/${usage.limit} disponibles en 15 minutos · ${usage.dailyRemaining}/${usage.dailyLimit} hoy (Lima).${pause}`
}
