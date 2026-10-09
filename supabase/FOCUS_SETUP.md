# Mod Focus en Oficial

## Activación

Ejecutar **`focus_sessions.sql` completo en una consulta nueva del SQL Editor** del proyecto utilizado por `pagina.html` y después recargar la página. No es necesario volver a ejecutar los SQL de Grupos o Calendario para esta función. La migración necesita las tablas existentes `profiles` y `course_status`, es transaccional e idempotente y no inserta muestras. Usa la tabla independiente `focus_study_sessions`; no modifica el chat anterior ni el calendario.

La migración no se aplicó desde este entorno, cuya conexión administrativa PostgreSQL está bloqueada por el proxy. El usuario eligió ejecutar los scripts en el SQL Editor. Las pruebas descritas abajo son locales, no una validación con cuentas reales en producción.

## Cursos del semestre

La carrera se toma de `profiles.carrera`. El selector incluye solo cursos de esa carrera con `course_status.status = 'matriculado'`, excluye cursos que también figuren como llevados en `progress.done` y los ordena con un comparador español, sin alterar el catálogo de la malla. No toma el plan del próximo ciclo ni infiere matrícula a partir del número de ciclo.

El estado **Matriculado** de la ficha del curso representa la matrícula vigente. Cuando termine el semestre, actualizar esos estados en la ficha. Si no hay cursos matriculados, el selector conserva «Sin curso» y explica dónde actualizar la matrícula. No se modificó el registro de cuentas ni la selección inicial de carrera. Al iniciar una sesión con curso, el servidor comprueba también la matrícula del usuario.

## Temporizador e historial

- Métodos: Pomodoro (25 min), Estudio (45 min), Profundo (90 min) y Personalizado (mínimo 5 min, máximo 3 h 55 min). Se retiró la prueba de 10 segundos.
- Se conservan los cuatro relojes y los tres compañeros. Las opciones nativas del selector tienen fondos opacos y texto legible en ambos temas.
- El servidor estampa el inicio, registra las pausas, calcula el tiempo transcurrido y limita el tiempo de cada sesión a su duración prevista. Los descansos no suman. Una sesión solo puede marcarse completada después de alcanzar su duración.
- Una cuenta tiene como máximo una sesión abierta, que puede recuperarse al recargar. El reloj sigue al navegar dentro de la página. Al cerrar sesión se pausa primero una sesión en curso; si esa escritura falla, la pantalla permite reintentar antes de cerrar la cuenta.
- El reloj activo continúa al cerrar la pestaña. Al regresar se consulta el estado guardado. Si ya terminó, la finalización se registra con el vencimiento calculado por el servidor, aunque el navegador haya vuelto después. El tiempo representa el funcionamiento del reloj, no una comprobación de atención del estudiante.
- Terminar antes guarda únicamente el tiempo transcurrido, con un estado diferente de «completada». Un cierre accidental o una petición repetida no generan una segunda sesión: el inicio usa el mismo UUID al reintentar y las transiciones son idempotentes.
- El resumen se consulta por fecha en **America/Lima**. Agrupa cada sesión por su fecha de término, incluido el tiempo de las sesiones terminadas antes. Una sesión que cruza medianoche se contabiliza completa en el día en que termina; no se presenta como una medición minuto a minuto por día.
- El historial muestra las últimas 30 sesiones del día; los totales incluyen todas. Los mensajes de ánimo usan esos registros. Una fecha sin registros muestra un estado vacío. No se otorgan logros ni se inventan sesiones.
- El historial y cada fila son privados, con RLS de propietario. El navegador solo lee la tabla; las escrituras se realizan mediante RPC que comprueban la sesión y el propietario. No se acepta una duración de estudio declarada por el cliente ni el UUID de otro alumno. Se limita el inicio a 30 sesiones por hora para evitar peticiones repetidas abusivas.
- Los errores conservan la sesión y sus opciones. Un guardado pendiente no se presenta como confirmado. Sin la migración, se informa que falta configuración y se ofrece reintentar. Los visitantes pueden usar el reloj, pero no guardan historial ni consultan matrículas.

## Verificación local

```sh
npm run build
node --test tests/focusModel.test.mjs
npm install --prefix /tmp/ia-sql-tests --no-save @electric-sql/pglite
PGLITE_MODULE=/tmp/ia-sql-tests/node_modules/@electric-sql/pglite/dist/index.js node tests/focusSessions.sql.test.mjs
```

Las pruebas SQL verifican instalación repetida, aislamiento entre cuentas, rechazo anónimo y de escrituras directas, matrícula, rechazo de 10 segundos, pausa/reanudación, finalización real, reintentos, tiempo parcial y límites de fecha en Lima. El navegador se verificó con respuestas Supabase simuladas en desarrollo y en el build: selección de cursos, selector oscuro, teclado, recuperación al recargar, navegación, fallos, resumen por fecha, móvil y temas. No se crearon cuentas ni registros de prueba en la base activa.
