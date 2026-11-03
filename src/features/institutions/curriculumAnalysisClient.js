export const analysisLabels={draft:'Borrador privado',queued:'En cola de análisis',analyzing:'Analizando con IA',approved:'Aprobada para compartir',corrections:'Requiere correcciones',review:'En revisión por moderación',rejected:'Documento rechazado'}
export function analysisError(error){
 const message=error?.message||''
 for(const [key,text] of Object.entries({ANALYSIS_DAILY_LIMIT:'Puedes enviar hasta tres análisis en 24 horas. Conserva tus cambios y reintenta más tarde.',ANALYSIS_PLATFORM_LIMIT:'Se alcanzó el límite diario de análisis de Lyra. Reintenta mañana.',ANALYSIS_COOLDOWN:'Espera cinco minutos desde el último envío para volver a analizar.',ANALYSIS_BUSY:'Hay un análisis en curso. Espera su resultado antes de editar.',CORRECTIONS_REQUIRED:'Modifica los campos señalados antes de volver a enviar.',COURSE_IDS_LOCKED:'Ya tienes avance académico. Conserva el orden, el número de cursos y sus códigos (o sus nombres si no tienen código) para mantenerlo.',REVIEW_CONFLICT:'Otro moderador ya resolvió o actualizó este envío. Actualiza la bandeja.',MODERATOR_REQUIRED:'Tu cuenta no tiene permisos de moderación.'}))if(message.includes(key))return text
 return 'No pudimos confirmar la operación. Conservamos los datos; actualiza el estado o reintenta.'
}
export async function startAnalysis(client,id){
 const r=await client.functions.invoke('curriculum-analysis',{body:{action:'analyze',curriculumId:id}})
 if(r.error||r.data?.error)throw r.error||new Error(r.data.error)
 return r.data
}
