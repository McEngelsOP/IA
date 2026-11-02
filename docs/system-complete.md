# Servicios académicos y continuidad de Lyra

Esta ampliación conserva el catálogo ESAN y la información existente. Las nuevas universidades no se habilitan automáticamente. Las pantallas están en **Perfil → Preferencias** y, para cuentas autorizadas, **Perfil → Administración**. Mi semestre incorpora prevención y Mi carrera incorpora comparación de versiones.

## Persistencia y sincronización

`student_preferences` guarda las preferencias por cuenta con RLS. La RPC `save_lyra_preferences` combina las claves modificadas atómicamente: orden de Inicio, tema, brillo, objetivos y evaluaciones, lateral, Focus y notificaciones. La copia local y las modificaciones pendientes se separan por cuenta. La carga inicial importa los valores anteriores del navegador solo cuando la cuenta no tiene ese valor. Se reintenta al recuperar conexión, abrir la ventana o pulsar Sincronizar ahora. Dos cambios simultáneos sobre la misma clave siguen el orden de guardado del servidor.

El historial de conversaciones continúa siendo exclusivamente local. No se sincronizan conversaciones ni claves de IA con esta funcionalidad.

## Calificaciones institucionales

`institution_rules` contiene escala, mínimo, máximo, aprobación, decimales y promedio por créditos o con pesos iguales. El motor admite valores numéricos y letras con equivalencias explícitas. Las plantillas 0–100 y A/B/C/D/F son ejemplos configurables, no reglas oficiales de universidades nuevas. ESAN conserva 0–20 y aprobación desde 10,5.

La validación del servidor sustituye el límite fijo de `grades` por la regla de la institución del propietario. Las letras se guardan con su valor equivalente y se muestran como letras. Las ponderaciones de evaluaciones deben sumar 100%; no se normalizan pesos incorrectos silenciosamente. Una escala con notas existentes no puede cambiar sus límites o equivalencias sin una migración de los datos.

## Versiones y validación de mallas

`curriculum_versions.catalog` contiene la revisión completa. Los campos de año y nombre oficial permanecen vacíos cuando no existe evidencia; una revisión de fuente no acredita el año del plan. Un trigger valida automáticamente identificadores únicos, créditos totales, requisitos existentes y ausencia de ciclos. Los catálogos publicados son inmutables.

El alumno compara cursos añadidos, retirados y cambios de créditos y requisitos antes de confirmar. `upgrade_curriculum` verifica la revisión esperada, guarda el registro académico anterior en `curriculum_transitions` y conserva el avance de cursos estables. Los cambios de identificador necesitan correspondencias revisadas por un moderador académico en `curriculum_equivalences`. Las colisiones o equivalencias pendientes detienen la operación sin cambios parciales. El plan futuro vuelve a validarse en el motor. El asesor carga la misma revisión asignada desde el servidor.

## Prevención y recordatorios

Mi semestre muestra el resumen de la semana, choques de horarios de las próximas cuatro semanas y semanas con al menos cuatro entregas o exámenes. Respeta repeticiones y fechas finales; dos clases contiguas no se consideran un choque. El editor avisa si el borrador se superpone con otro evento.

Los avisos son opcionales, requieren permiso en cada navegador y se revisan mientras Lyra está abierta. Se respetan la zona horaria elegida y el silencio, incluso si atraviesa medianoche. El resumen semanal se ofrece los lunes desde las 08:00. Esta entrega no implementa un servidor push para enviar avisos con la aplicación cerrada.

## Consulta sin conexión

La PWA prepara una página independiente de consulta y sus dependencias durante el build. El Service Worker permite abrirla al fallar una navegación. IndexedDB conserva malla, avance, horarios y tareas de la cuenta activa, con fechas independientes de actualización académica y de agenda. La copia se actualiza al leer o guardar información confirmada. No permite escrituras sin conexión.

Cerrar sesión o bloquearla retira el acceso a esa copia y limpia los registros locales de consulta. Los cambios de cuenta no muestran la copia de otro alumno. No se guardan respuestas autenticadas, RPCs ni `/api/` en la caché del Service Worker.

## Moderación, reportes y servicios

Los administradores conservan su autorización existente en `profiles.is_admin`. Los permisos de mallas y soporte se asignan por institución en una tabla privada. Toda publicación, equivalencia, resolución y asignación vuelve a comprobar el permiso en el servidor. Los alumnos consultan sus propios reportes y los moderadores solo los de su ámbito.

El panel presenta solicitudes de IA por proveedor en 24 horas, límite diario, última respuesta y latencia. No presenta esas solicitudes como tokens o dinero. Los errores se agrupan por códigos cerrados, sin conversaciones, títulos ni trazas. Se limitan reportes y telemetría para evitar abuso; los eventos técnicos se conservan 30 días.

## Activación y comprobaciones

El código y SQL se entregan como propuesta revisable. **La activación remota de esta ampliación no se ha aplicado**: la revisión automática exige aprobación explícita del alcance de producción. La migración propuesta es `supabase/system_complete.sql`; `node scripts/systemCatalogSeed.mjs` genera la carga de los 18 catálogos existentes. Deben aplicarse juntos y desplegar después `study-advisor` de la misma revisión. El frontend se integra en la rama `Oficial`, por autorización del usuario. Esta subida no aplica SQL ni despliega funciones de Supabase.

El alcance de activación comprende preferencias, reglas de calificaciones, catálogos/validación, equivalencias/historial, roles de moderación, reportes y telemetría. Cambia la validación de notas y permite actualizar la revisión de malla exclusivamente mediante la RPC autorizada. No elimina alumnos, notas, avances ni conversaciones y no asigna permisos de moderador a cuentas concretas automáticamente.

- `npm run check`: catálogo reproducible, pruebas de reglas/SQL, Worker y build.
- `npm run test:browser`: recorridos existentes y nuevas superficies con servicios simulados, incluidas dos sesiones independientes y vistas móviles.
- `npm run test:offline`: build real con Service Worker y corte real de conexión en el navegador.
- Las pruebas SQL locales cubren permisos, aislamiento, mallas inválidas, conservación del registro y equivalencias.

Las pruebas locales y con fixtures no sustituyen la prueba del recorrido con cuentas reales de desarrollo. Esta última depende de la activación del backend y no se afirma como completada.

La resolución de revisiones de malla en el asesor permanece deshabilitada por defecto (`ADVISOR_VERSIONED_CURRICULA`). Habilitarla con valor `true` únicamente después de aplicar y comprobar el esquema de mallas. La política independiente de IA no activa esta ampliación.
