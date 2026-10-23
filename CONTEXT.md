# Contexto técnico de Lyra Campus

Actualizado el 20 de octubre de 2026 para la reestructuración en `aea`. El código y las pruebas son la referencia de implementación. El catálogo ESAN y `study-advisor` v15 están activados en Lyra; el alcance comprobado se registra en `docs/backend-activation.md`.

## Alcance y entradas

Solo ESAN está habilitada, con las 18 carreras del catálogo. Lyra es la marca general. Las diferencias institucionales se separan del motor para permitir expansión futura.

Mecatrónica PUCP se retiró del registro, grafos y asesor. Se conserva la cuenta histórica y sus registros: al entrar se muestra un estado específico con exportación, sin reasignarla a ESAN. El SQL conserva ese valor histórico y rechaza registros o asignaciones nuevos de esa carrera.

- `login.html`: acceso, registro, confirmación y recuperación mediante `src/features/access/`.
- `pagina.html`: estructura del portal, con lógica y CSS separados en `src/app/`.
- `ios-android.html`: redirección compatible al portal responsive.
- `Pagina promocional/`: landing independiente con ejemplos ilustrativos.
- `src/app/navigation.js`: cinco destinos principales y herramientas secundarias; conserva rutas anteriores mediante `resolveRoute`.
- `src/core/`: modelos sin dependencias institucionales ni visuales.
- `src/institutions/`: configuración, catálogo y cargador de revisiones.
- `src/features/`: módulos funcionales con sus estilos.
- `src/shared/`: componentes, sesión, recursos y cliente compartidos.

## Catálogo y asignación

`scripts/curriculumSources.mjs` selecciona los 18 Markdown de `data/catalogs/esan/sources/`. El generador valida totales y referencias, conserva IDs históricos y produce opciones, catálogo del asesor, SQL y snapshots.

Cada carrera tiene institución, revisión, documento y hash de fuente. Los snapshots de `data/catalogs/esan/releases/` son inmutables. La revisión identifica datos importados; no acredita un año o validación oficial del plan.

`supabase/careers_catalog.sql` añade `profiles.institution_id`, `profiles.curriculum_version` y `curriculum_versions`. Asigna la revisión actual solo a perfiles sin asignación y protege los campos desde el cliente. Regenerar no cambia revisiones ya asignadas. El portal carga un snapshot anterior si corresponde; si no existe, presenta un error recuperable sin sustituirlo silenciosamente.

La interfaz admite la base anterior: perfiles sin asignación usan el catálogo activo. La migración de persistencia está aplicada en Lyra; otros entornos requieren instalarla. No renombrar IDs sin una migración específica: progreso, notas, profesores y comunidad dependen de ellos.

## Reglas que deben conservarse

- Aprobado/convalidado, matriculado y planificado son estados distintos.
- Un matriculado no se recomienda de nuevo para el plan futuro.
- La proyección puede asumir su aprobación, declarándola como condición sin modificar `done`.
- El semestre actual lo informa el estudiante; no se deduce de créditos ni ciclos de cursos.
- Los electivos con requisitos desconocidos quedan por verificar; no se habilitan ni programan automáticamente.
- La proyección respeta la carga elegida y deja sin ubicar cursos que la exceden.
- Cambiar una aprobación no inventa ni borra otras aprobaciones. El plan se vuelve a validar.
- Las RPC académicas existentes concentran escrituras atómicas. Errores conservan datos y borradores; nunca persistir listas vacías como respuesta a una consulta fallida.

## Semestre, planificación y asistente

Mi semestre reúne Calendario y tareas, Notas y objetivos y Cursos actuales. El cálculo de objetivos reutiliza Inicio y guarda estimaciones locales por cuenta; no son notas oficiales ni están sincronizadas. Las notas finales usan `grades`.

Solo Mi semestre ofrece importación de horario `.xlsx`. La propuesta se revisa y edita antes de guardar únicamente clases confirmadas. El onboarding remite allí y conserva clases de borradores anteriores, sin ofrecer CSV ni otro importador.

Planificar reúne diagnóstico, comparación, proyección y plan guardado. Se eliminó el modal duplicado `SemesterRoadmap`; la superficie activa usa directamente el motor. El asesor mantiene chats y borradores únicamente en IndexedDB por cuenta. El servidor obtiene perfil y datos académicos relevantes con la identidad del estudiante: plan guardado, requisitos, revisión, créditos aprobados, matrícula, agenda y tareas. No acepta el avance del cliente como autoridad ni envía código, correo o notas individuales. Permite crear tareas y eventos individuales desde borradores revisados con Guardar, aprobación firmada y RPC idempotente. No persiste mensajes ni resúmenes en Supabase; se deshabilitan las escrituras del historial antiguo sin borrar registros. Ver `docs/assistant-local.md` para límites y activación.

## Sesión, exportación y servicios

`src/shared/lib/webSession.js` aplica 30 minutos sin interacción real y coordinación entre pestañas. Consultas y renovación de tokens no extienden la sesión. Al caducar se desmonta contenido privado y se limpian solo credenciales del proyecto.

La exportación comprueba identidad antes y después de leer, filtra por propietario y pagina. Incluye perfil, progreso, notas, estados, configuración, eventos y tareas. No incluye contenido comunitario completo ni claves personales de IA. Si falla una tabla, no se descarga un archivo parcial como completo.

Conservar RLS, candado de carrera y verificación de usuario antes de escrituras. Nunca publicar `service_role`, claves de IA o secretos del Worker en `VITE_`.

Focus usa matrícula real, reloj del servidor e idempotencia. Los grupos exigen membresía para mensajes privados. Recursos conserva atribución y edición por autor. Arcade y Geoduelo siguen como complementos; el buzón usa `/api/mailbox`.

Base y Edge Functions son compartidas por los despliegues con las mismas variables. El 20 de octubre de 2026 se activaron explícitamente el catálogo y el asesor de `aea` en Lyra. Esto no publica el frontend ni cambia el Worker de Cloudflare.

## Comprobación y mantenimiento

`npm run check` comprueba catálogo, Node/PostgreSQL local, Worker y build. `npm run test:browser` inicia Vite con datos fixture y servicios simulados. Las pruebas no crean cuentas reales ni prueban un despliegue de servidor no aplicado.

No crear otra carpeta de descartes: usar Git para recuperar código retirado. Antes de borrar, revisar imports, entradas, rutas públicas, scripts, SQL y pruebas. Registrar decisiones materiales en `docs/cleanup.md`.
