# Acceso y límites de la IA

La política se resuelve en Supabase a partir del perfil protegido y de una verificación administrativa vigente. No usa la universidad declarada en el navegador ni `user_metadata` para conceder créditos de Lyra.

- ESAN con afiliación verificada y vigente: puede elegir el servicio compartido o claves propias.
- Otra universidad, institución desconocida o ESAN pendiente, revocada o vencida: clave propia obligatoria.
- Sin claves propias activas, las funciones de IA se bloquean con una explicación y acceso a Mi IA. Nunca se mezclan claves personales con claves de Lyra ni se usa Lyra como respaldo.
- La habilitación del registro de otras universidades pertenece a las migraciones de universidades; esta política controla el acceso a IA de esas cuentas.

## Cuotas

| Control | Lyra | Claves propias |
| --- | --- | --- |
| Solicitudes por cuenta en 15 minutos | 5 | 10 |
| Solicitudes por cuenta al día de Lima | 20 | 200 |
| Texto → tareas al día | 10 | 50 |
| Interpretaciones de horario al día | 5 | 20 |
| Pruebas de claves | 3 en 15 minutos y 10 al día | 3 en 15 minutos y 10 al día |
| Consulta simultánea por cuenta | 1 | 1 |

Todas las herramientas y ambos modos contribuyen al mismo contador de la cuenta. Cambiar de dispositivo, proveedor, clave o modo no reinicia el uso. Los cupos de cada modo se comparan con ese contador común. Las solicitudes aceptadas cuentan incluso si el proveedor falla; una denegación previa no consume cupo. Se conservan los límites globales compartidos y las reservas por proveedor existentes. No constituyen un presupuesto monetario del proveedor.

Una reserva atómica bloquea la fila del perfil, comprueba de nuevo la afiliación y el modo, y registra la solicitud antes de llamar a la IA. Cada función libera su reserva al terminar, también en los errores. Una reserva abandonada vence a los 120 segundos; terminar una solicitud antigua no libera otra más reciente.

## Verificación administrativa

Mi IA muestra «Verificar afiliación ESAN» solo para administradores. Requiere el UUID de la cuenta y confirmar la revisión de una prueba institucional. «Usar mi cuenta» completa el identificador de la sesión actual sin conceder acceso por sí mismo. La verificación dura 180 días y puede revocarse. La RPC vuelve a comprobar el permiso administrativo y que el perfil pertenezca a ESAN. No se verifica automáticamente a cuentas existentes. Cada alumno puede consultar su UUID en Mi IA → Identificador de cuenta para soporte.

## Asistente

Los modos Breve, Paso a paso y Modo estudio controlan las instrucciones y la longitud de salida. Las respuestas muestran el contexto realmente consultado (cursos, tareas o agenda), versión de malla cuando existe, ventana temporal y fecha de consulta. Los datos ausentes se declaran; una institución sin malla verificada no hereda el catálogo de ESAN. Los borradores mantienen su revisión y confirmación antes de guardar.

## Instalación y estado

Aplicar `supabase/ai_access_policy.sql` después de los esquemas existentes de asesor y `personal_ai_keys.sql`. Es independiente de `system_complete.sql`. Después desplegar conjuntamente `study-advisor`, `text-to-tasks`, `excel-schedule` y `personal-ai`, conservando `verify_jwt=true`. Publicar el frontend de Oficial para habilitar los controles visuales. Sin el esquema de política, las nuevas funciones rechazan las consultas; no vuelven a la política anterior.

Estado comprobado el 3 de noviembre de 2026: el código está en `main` y las funciones SQL de política y verificación existen en Lyra. Los cuatro servicios desplegados conservan el enrutamiento anterior; requieren actualización desde la misma revisión de `main`. No se consultó el estado individual ni se verificaron automáticamente cuentas ESAN. La ejecución de SQL sigue siendo manual cuando haga falta en otro entorno. Pasos y límites de esta comprobación: [revisión de main](revision-main-2026-11-03.md).

## Pruebas

`tests/aiAccess.sql.test.mjs` ejecuta el SQL dos veces con Postgres local (PGlite), roles reales y claves sintéticas. Comprueba permisos, afiliación, revocación, cuotas comunes, límites diarios y por herramienta, reservas, duplicados y la ruta heredada. `tests/aiEndpoints.test.mjs`, `tests/personalAi.test.mjs` y `tests/assistantPersonal.test.mjs` comprueban el aislamiento de credenciales, errores y limpieza sin consumir proveedores reales. Las pruebas de navegador cubren Mi IA y el asesor a 1366/1440, 390 y 320 px.
