# Texto → tareas y cursos del semestre

## Uso

En el calendario, **Texto → tareas** permite pegar indicaciones de entre 10 y 6000 caracteres y generar hasta 10 propuestas. No admite archivos. Antes de guardar se puede editar el título, completar la fecha, elegir un curso matriculado o «Sin curso» y desmarcar propuestas. Las fechas ausentes o ambiguas quedan vacías: deben completarse para guardar. Las fechas relativas se interpretan según el día actual de Lima.

La generación no escribe tareas. Solo **Guardar** persiste las seleccionadas en `calendar_tasks`; los UUID estables permiten reintentar sin duplicarlas. Ante errores de generación se conserva el texto, y ante errores de guardado se conservan las propuestas. Sigue disponible la creación manual.

En la malla, **Cursos de este semestre** permite seleccionar hasta 30 cursos actuales y guardar la matrícula. Los cursos aprobados o convalidados quedan excluidos. Inicio, Focus y Texto → tareas usan esta matrícula; cambiarla no modifica notas ni cursos aprobados. Se requiere sesión para guardar y un fallo conserva la selección.

## Integración y diseño

La extensión conserva la paleta, fuentes, superficies y tokens existentes. Las propuestas y la selección del semestre usan dos columnas en escritorio y una en móvil; los controles móviles principales alcanzan 44 px. Se conserva el login y la desactivación del resplandor móvil de la base `cd26dd1` (rama `aea`). No se modifica el sistema de diseño ni su documentación normativa.

Las piezas principales son `TextToTasks.jsx`, `OfficialCalendar.jsx`, `OfficialCurriculum.jsx`, sus estilos y `src/lib/taskExtraction.mjs`. El parser valida JSON, títulos y fechas, descarta asociaciones a cursos desconocidos y elimina propuestas duplicadas.

## Backend y despliegue

`supabase/text_tasks_semester.sql` añade `calendar_tasks.course_id` manteniendo la RLS existente de propiedad del alumno. La RPC `set_semester_courses` usa `SECURITY INVOKER`, comprueba `auth.uid()` y actualiza matrícula y `student_setup.draft.enrolled` en una misma transacción. Respeta RLS y rechaza cursos ya completados; conserva estados ajenos a la matrícula retirada. Su ejecución está concedida solo a `authenticated`.

La Edge Function `text-to-tasks` verifica la sesión, consulta carrera y cursos matriculados y reutiliza la moderación, `advisor_usage`, `advisor_provider_reserve` y `advisor_provider_report` del asesor. Las claves permanecen en secretos del servidor. Gemini, Groq y OpenRouter comparten límites y pausas; el siguiente proveedor puede atender cuota agotada, timeout, indisponibilidad, HTTP 401/403/404/410 o respuestas malformadas. Una negativa explícita de seguridad detiene el intento.

**Comprobar proveedores de IA** solo aparece para administradores y el servidor vuelve a verificar `is_app_admin`. Realiza una petición real por proveedor configurado con los secretos existentes, consume cuota y devuelve estado/modelo, sin exponer claves.

Para instalar en otro entorno, aplicar el SQL sobre el esquema existente, conservar las RPC del asesor y sus secretos y desplegar ambas funciones:

```sh
supabase functions deploy text-to-tasks
supabase functions deploy study-advisor
```

En el entorno revisado se desplegaron `text-to-tasks` v2 y `study-advisor` v11. La publicación del frontend en Vercel sigue sin confirmarse: la inspección del proyecto `lyra-ia` devolvió 403 por permisos.

## Verificación y límites de la evidencia

Se registraron 31 pruebas unitarias relacionadas aprobadas, una prueba de navegador con datos simulados en 1366, 390 y 320 px, y una prueba SQL autenticada dentro de una transacción revertida. El navegador verificó revisión y guardado de propuestas, matrícula y estados de error, sin desbordamiento horizontal en los tamaños móviles revisados. Los archivos reproducibles incluyen `tests/textTasks.test.mjs`, `tests/textTasks.browser.mjs` y `tests/deberes.integration.sql`.

```sh
node --test tests/textTasks.test.mjs tests/calendarModel.test.mjs tests/setupModel.test.mjs tests/webSession.test.mjs
node tests/textTasks.browser.mjs
```

La prueba de navegador requiere Playwright y Chromium disponibles; admite `PLAYWRIGHT_MODULE` y `REVIEW_BROWSER` para indicar sus ubicaciones. La revisión final de interfaz concluyó «Ship», sin correcciones obligatorias.

La prueba real de APIs externas quedó bloqueada por la revisión automática de aprobación al intentar usar credenciales históricas. Existe metadata previa de éxito de Gemini; la disponibilidad real de Groq y OpenRouter permanece sin confirmar. Las pruebas simuladas no certifican esa disponibilidad.

No se declara aprobada la suite completa: su ejecución más amplia encontró la dependencia ausente `@electric-sql/pglite` y un problema de saltos de línea del catálogo por la materialización local. Estas limitaciones son distintas de las verificaciones relacionadas aprobadas.
