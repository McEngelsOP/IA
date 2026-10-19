# Contexto técnico de Lyra AI

Actualizado el **19 de octubre de 2026**, a partir del código de `main`. Este documento describe la arquitectura del repositorio y las decisiones que deben preservarse. El estado de un despliegue, una migración aplicada o una credencial remota debe comprobarse en el servicio correspondiente; los informes de pruebas anteriores no son una comprobación de producción actual.

## Estado y puntos de entrada

Lyra organiza avance académico, notas, matrícula del semestre, calendario, tareas y herramientas de estudio. El catálogo admite **18 carreras ESAN y Mecatrónica PUCP**. React 18 y Vite conviven con el HTML, CSS y JavaScript del portal; no se trata de la SPA original de `src/App.jsx`.

| Entrada de Vite | Papel actual |
| --- | --- |
| `login.html` | Acceso, registro, confirmación de correo y recuperación mediante `src/lib/accessController.js`. |
| `pagina.html` | Portal funcional, con adaptación a escritorio y móvil y componentes React montados bajo demanda. |
| `ios-android.html` | Maqueta independiente de navegación y tema móvil. Sus avisos y menús no equivalen al flujo autenticado del portal. Sigue incluida en el build. |
| `Pagina promocional/index.html` | Landing con demostraciones ilustrativas; no usa cuentas ni proveedores de IA para sus ejemplos. |

`vite.config.js` define estas cuatro entradas y genera `dist/`. `vercel.json` redirige `/` a `/login.html` y reescribe `/promocional` a la landing. El frontend funcional en móvil usa `pagina.html`, no una redirección automática a la maqueta. Ninguna de estas entradas produce por sí misma un APK o un paquete iOS.

El trabajo actual se realiza en `main`. Las referencias a `aea` y `Oficial` en documentos anteriores son contexto de implementación; no prueban la rama que un proyecto de Vercel tiene seleccionada para producción. No cambiar ramas de producción ni dominios a partir de esas notas sin consultar la configuración efectiva.

## Estructura y límites de despliegue

- `src/`: componentes activos, modelos puros, catálogos, recursos de marca y estilos compartidos.
- `public/`: recursos que Vite copia al build. Los datos geográficos y módulos de `public/juegos/geoduelo/` también son dependencias del Worker.
- `api/mailbox.js`: función de Vercel que valida el buzón y lo reenvía a Google Apps Script. Una publicación puramente estática no ejecuta esta API.
- `supabase/functions/`: `auth-by-code`, `study-advisor`, `text-to-tasks`, `personal-ai` y `excel-schedule`. Editar el repositorio o publicar Vercel no las despliega.
- `supabase/`: instaladores, cambios, diagnósticos, mantenimiento e historia SQL. No ejecutar todos los archivos como una secuencia de migraciones.
- `workers/geoduelo/`: Cloudflare Worker con Durable Objects, configuración, lockfile y pruebas propios. Publicarlo es independiente del frontend y del SQL.
- `Mallas curriculares/` y `scripts/`: fuentes y generadores del catálogo; conservar la trazabilidad de IDs y requisitos.
- `tests/` y `docs/`: verificaciones y guías. Las evidencias fechadas o las versiones desplegadas que mencionan describen el momento de aquellas pruebas.
- La antigua carpeta `Revisar para limpiar/` se eliminó tras la revisión del 19 de octubre de 2026. Su contenido sigue disponible en Git; ver la sección de limpieza.

## Comandos y configuración local

Desde la raíz:

```bash
npm ci
cp .env.example .env.local
npm run dev
npm run build
npm run preview
```

En PowerShell, copiar el ejemplo con `Copy-Item .env.example .env.local`. El desarrollo abre `/login.html` en el puerto 5173. Completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`; `getSupabaseClient()` centraliza el cliente compartido.

`VITE_GEODUELO_ONLINE_URL` es opcional y contiene únicamente la URL pública del Worker ya desplegado. Sin ella, la interfaz informa que Online no está activado y permite el juego offline.

Las variables `VITE_` son públicas en el bundle. Las claves de proveedores, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` y `TICKET_SECRET` no deben incorporarse al navegador ni al repositorio. Las claves personales se gestionan mediante el backend de Mi IA, no mediante variables Vite.

La landing puede compilarse junto al portal desde la raíz o por separado con su propio `Pagina promocional/package.json`. Para un proyecto Vercel exclusivo de la landing, seleccionar esa carpeta como Root Directory. Si está en otro dominio, ajustar `data-app-url` en su `index.html` para que el acceso apunte al portal real.

## Acceso y recuperación

Las operaciones por código usan `auth-by-code` (login, recuperación, reenvío y comprobaciones previstas por el controlador). El registro usa `auth.signUp` con `student_code` y `carrera` en los metadatos. La identidad que consume el servidor procede de la sesión, nunca de un UUID de usuario enviado por el cliente como autorización.

Preservar la detección de correo repetido mediante identidades vacías. Con confirmación de correo activa, el registro muestra el aviso y espera el enlace; si ya hay sesión válida, puede continuar al portal. Las respuestas por código no deben exponer el correo completo de otra cuenta. El contador de 45 segundos es una ayuda del cliente y no sustituye los límites del servidor.

Los callbacks se construyen con el origen actual y la ruta `/login.html`; después del acceso se abre `pagina.html` en Inicio. La nueva contraseña exige sesión verificada mediante `auth.getUser` antes de `auth.updateUser`. Un enlace inválido o caducado vuelve a recuperación; cancelar cierra solo la sesión local de recuperación.

En Supabase Auth deben permitirse el origen y la ruta efectivos de redirección. `https://l-esan.vercel.app/login.html` es una dirección utilizada previamente, no una constante que deba copiarse a cualquier entorno. Un cambio de dominio requiere revisar callbacks, plantillas de correo, enlaces de la landing y orígenes permitidos del Worker.

El código de alumno tiene ocho dígitos y se valida según universidad/carrera tanto en el acceso como en el backend. Conservar las reglas del catálogo y del trigger sin sustituirlas por una validación solo visual ni revelar reglas internas en los mensajes de error.

### Fondo y layout del acceso

Los recursos actuales están en `public/`: `login-landscape.mp4`, `login-landscape.webp`, `Cat.jpg` y fuentes Entry. Vite los publica en la raíz de la salida. `src/lib/accessBackground.js` coordina la carga decorativa; esta no debe bloquear la autenticación. `login.html` usa el video de paisaje y su póster en escritorio y la imagen de gato para móvil.

El archivo raíz `270983.mp4` sigue presente, pero no es el recurso referenciado por el acceso actual. Está pendiente de limpieza; no se ha movido ni eliminado como parte de esta actualización documental.

El layout lo coordina `src/styles/accessViewport.css`: panel limitado al viewport, ajuste al contenido y teclado mediante `visualViewport`, con desplazamiento interno cuando hace falta. El éxito se anuncia en `#accessStatus`; los errores comparten `#formMessage`. La [verificación de acceso](docs/access-layout/verification.md) conserva la evidencia histórica con Supabase simulado y sus límites.

## Sesión y navegación del portal

`pagina.html` y `accessController.js` instalan `src/lib/webSession.js`: cierre de sesión tras 30 minutos sin interacción. Solo las acciones reales de teclado, puntero, entrada, scroll o toque en una pestaña visible actualizan la actividad; la renovación de tokens, las consultas y el temporizador de Focus no la prolongan. El registro por sesión persiste en el navegador y se comparte entre pestañas. Recargar, enfocar o volver desde suspensión/bfcache comprueba el plazo antes de admitir actividad o cargar datos académicos. Una sesión antigua sin registro válido requiere volver a iniciar sesión una vez.

Al caducar, el portal oculta y desmonta la información privada inmediatamente, intenta `signOut({scope:'local'})` y limpia únicamente las claves de autenticación de este proyecto aunque no haya conexión. Tras un máximo de 1,5 segundos esperando el cierre, vuelve al acceso. No elimina notas, cursos ni preferencias de Supabase y no cierra otros dispositivos. Los enlaces de recuperación/confirmación verificados y un login nuevo establecen un registro nuevo. Este guard no convierte la maqueta `ios-android.html` en un portal conectado. Este control es de la aplicación web, no una política de expiración de JWT ni una modificación de Supabase Auth en el servidor.

Pruebas: `node --test tests/webSession.test.mjs` y `tests/webSession.browser.mjs` (Playwright, `SETUP_BROWSER` opcional, Vite en 5181 con URL `https://setup-fixture.supabase.co` y clave fixture). Se comprueban inactividad, regreso siete horas después, recarga, actividad entre pestañas, restauración y cierre sin conexión; los requests de la prueba de navegador son simulados.

La extensión de escritorio y su evidencia histórica están documentadas en [docs/desktop-surfaces.md](docs/desktop-surfaces.md). Comprobar el código actual antes de interpretar como vigente una función allí marcada como pendiente.


## Datos académicos, catálogo y configuración inicial

Las opciones se generan en `src/data/careerOptions.js` desde `scripts/curriculumSources.mjs`: 18 ESAN más Mecatrónica PUCP. Los 15 catálogos añadidos están en `src/data/curriculaEsan.js`; IA, Industrial, Marketing y PUCP conservan sus módulos e IDs.

```bash
node scripts/generateCurricula.mjs
node scripts/generateCurricula.mjs --check
```

No editar las salidas generadas a mano. Los requisitos y créditos proceden de los Markdown seleccionados; la generación rechaza requisitos desconocidos. Ver [fuentes y generación](docs/careers.md).

**No renombrar IDs de cursos sin una migración de datos**: progreso, notas, estados, profesores y comunidad dependen de ellos. Los IDs equivalentes ESAN pueden compartirse; PUCP conserva su espacio separado con prefijo `pucp-`. Una modificación de malla puede requerir regenerar el catálogo y los totales de Logros y revisar el SQL correspondiente.

Inicio y `OfficialCurriculum` comparten el avance privado. Distinguir cursos completados, matrícula actual y plan futuro: Focus y Texto → tareas usan la matrícula actual, no el plan. La selección de Cursos de este semestre excluye cursos completados y se guarda mediante `set_semester_courses`; ver [matrícula y tareas](docs/text-tasks-semester.md).

La configuración inicial usa `InitialSetup.jsx`, `setupModel.js` y `student_setup.completed_at`. Una configuración completada no debe volver a abrirse como si fuera un usuario nuevo. Conservar los borradores y los avisos de reintento cuando falla una consulta o escritura. Ver [configuración inicial](docs/initial-setup.md).

## Calendario, tareas, Focus y grupos

`OfficialCalendar.jsx` administra `calendar_events` y `calendar_tasks` por cuenta: Día/Semana/Mes, horarios semanales, agenda y edición. Los modelos de fechas civiles usan Lima (UTC−5). Un error debe conservar registros y borradores; no reemplazar información remota por datos de muestra.

`ExcelScheduleImport.jsx` integra la importación de horario Excel y `excel-schedule`; las propuestas se revisan antes de persistir el horario. `TextToTasks.jsx` usa `text-to-tasks` para proponer tareas, no para guardarlas automáticamente. Mantener la validación de cursos, fechas y títulos y los identificadores estables para reintentos sin duplicados.

Mod Focus usa `focusModel.js`, sesiones privadas y reloj del servidor. Filtra cursos matriculados de la carrera que no estén completados. Conserva pausa, recuperación al recargar, finalización idempotente e historial por fecha en Lima. Ver [Focus](supabase/FOCUS_SETUP.md).

`OfficialStudyGroups.jsx` usa `study_rooms`, `study_room_members` y `study_room_messages`. La tabla histórica `study_messages` es independiente. Salas privadas y mensajes requieren membresía; solo el creador gestiona invitación y cierre. Los reintentos reutilizan UUID y conservan el borrador. La consulta periódica de mensajes no representa presencia en línea. Ver [grupos](supabase/STUDY_GROUPS_SETUP.md).

## IA, recursos y buzón

`OfficialTools.jsx` integra el asesor y la proyección de ciclos. Brújula/SemesterRoadmap calcula rutas localmente; no confundirla con una llamada a proveedores.

`study-advisor`, `text-to-tasks` y la importación inteligente reutilizan piezas de proveedores y enrutamiento. La disponibilidad de Gemini, Groq y OpenRouter depende del entorno y del momento. No describir una comprobación pasada como garantía de disponibilidad futura.

Mi IA se abre desde el perfil o el botón «+» del portal móvil. `PersonalAISettings.jsx` y `personal-ai` gestionan las claves personales con secretos en Vault y metadata enmascarada en la respuesta. No recuperarlas completas desde la UI ni guardarlas en localStorage. El modo personal usa sus claves activas y cuotas, sin recurrir automáticamente al servicio compartido si fallan. Ver [Mi IA](docs/personal-ai-keys.md).

Recursos consulta los enlaces compartidos de Supabase; no publicar datos de demostración como si fueran aportes reales.

**Buzón está implementado en el código actual**: `OfficialMailbox.jsx` → `POST /api/mailbox` → Google Apps Script. La API valida categorías, campos y límites y requiere una respuesta `OK` del servicio antes de anunciar éxito. Las categorías Aplicativo, Docente y Universidad se conservan en los datos reenviados. El flujo depende de que la función de Vercel y el Apps Script estén desplegados y accesibles; un servidor estático o `vite preview` por sí solos no ofrecen esta API. Esta revisión documental no envió mensajes ni comprobó la recepción externa.

## Arcade y Geoduelo

El catálogo de `pagina.html` tiene siete juegos: Memoria, Geoduelo, Reto lógico, Dino Run+, Escuadrón Galáctico, Quiz académico y Reflejos. `OfficialArcadeGame.jsx` monta Dino, Galaxia y Geoduelo; las referencias a AstroDefensa, Frogger y juegos externos del archivo histórico no describen el catálogo activo.

Geoduelo comparte `src/lib/geoduelo-modes.js` entre frontend y Worker, y depende también de datos de `public/juegos/geoduelo/`. No mover esas rutas de forma aislada.

Online usa Cloudflare Workers, Durable Objects y WebSockets. El servidor decide preguntas, tiempos y puntajes; verifica la sesión con Supabase y guarda resultados mediante `record_geoduelo_online`, con permisos de servidor. No habilitar escritura directa de resultados a alumnos ni confiar en puntajes enviados por el navegador. Los secretos se cargan en Cloudflare, nunca en `VITE_` ni en `wrangler.jsonc`.

Frontend, Worker y SQL son entregas separadas. Un cambio solo visual no implica redesplegar el Worker ni repetir SQL si el protocolo sigue siendo compatible. Consultar [Geoduelo local](docs/geoduelo.md) y [online](docs/geoduelo-online.md); sus referencias a `aea` corresponden a la etapa de implementación. La pantalla de juego conserva adaptación móvil y controles de pantalla completa/salida.

## Base de datos y decisiones de seguridad

Los SQL del repositorio no certifican que estén aplicados en producción. Antes de cambiar una base existente, revisar tablas, funciones, permisos, RLS y la guía del módulo. No repetir instaladores e historia de forma indiscriminada. Consultar [calendario](supabase/CALENDAR_SETUP.md) y [mantenimiento SQL](supabase/SQL_MAINTENANCE.md); las instantáneas de `supabase/maintenance/` no son instaladores de una base vacía.

Preservar estas decisiones:

- Aislamiento de datos privados por cuenta mediante RLS y comprobación de sesión antes de escribir. La UI no constituye una barrera de autorización.
- Progreso, notas, estados y matrícula deben mantenerse coherentes al marcar o desmarcar cursos. Un curso completado no debe ofrecerse como matrícula futura incompatible.
- Notas en escala 0–20; las notas autodeclaradas no deben otorgar logros por sí solas.
- Logros otorgados mediante RPC que comprueba las condiciones en el servidor; no permitir inserción libre del cliente.
- Comentarios y puntajes públicos firmados con alias, sin exponer `author_id`, `student_id` ni un vínculo alias↔perfil al navegador. Los administradores del servicio pueden acceder a identidades según sus permisos; alias no equivale a anonimato frente al administrador.
- Selecciones explícitas de columnas en tablas con restricciones de lectura; no sustituirlas por `select('*')`.
- El alias es editable en el diseño posterior: `change_alias.sql` retira su candado y sincroniza firmas existentes. No restaurar `lock_alias` desde instrucciones antiguas. El estado efectivo de la base debe comprobarse.
- La función antigua `email_for_student_code` no debe reintroducirse como lookup público. La guía de mantenimiento documenta su retiro y el de `lock_alias`, con recuperación administrativa separada.
- Los permisos y topes contra spam viven también en el backend: no resolver un bloqueo ampliando RLS a todos los usuarios.
- No ampliar privilegios de `service_role` al navegador ni exponer claves de proveedores en respuestas o logs.

`ADMIN.md` conserva procedimientos y estados históricos; revisar sus pendientes antes de ejecutar consultas. Activar un CAPTCHA exige coordinar cliente y autenticación. Esta actualización de documentación no aplica SQL, no cambia configuración de Supabase ni declara resueltos avisos de seguridad anteriores.

## Marca, móvil y navegación

La marca se centraliza en `src/lib/lyraBrand.js` y sus estilos. Inicio monta los decorativos de la paloma mediante `homeCompanion.js` y `homeEnhancements.js`. Las transiciones del sidebar incluyen `src/styles/SidebarMotion.css`.

La interfaz responsive y el menú móvil del portal están en `pagina.html`. Preservar movimiento reducido, foco, controles táctiles y navegación con Atrás/Adelante. La maqueta `ios-android.html` puede servir de referencia visual, pero no demuestra que exista una integración equivalente con datos reales.

## Verificación y CI

Ejemplos de comprobaciones por módulo:

```bash
npm run build
node scripts/generateCurricula.mjs --check
node --test tests/calendarModel.test.mjs tests/calendarEditing.test.mjs tests/focusModel.test.mjs tests/studyGroups.test.mjs
node --test tests/textTasks.test.mjs tests/scheduleImport.test.mjs tests/personalAi.test.mjs tests/webSession.test.mjs
```

Las pruebas `*.browser.mjs` y los scripts Python de navegador necesitan Playwright y un navegador compatible. Algunas pruebas SQL requieren PGlite fuera de las dependencias raíz; seguir la guía de cada módulo y sus variables de fixture. No asumir que instalar solo el frontend prepara toda la suite.

Desde `workers/geoduelo`, `npm ci` y `npm test` preparan y ejecutan su suite propia. Un cambio en código compartido puede requerir validar tanto frontend como Worker.

El `package.json` raíz no define `npm test`. `.github/workflows/validate.yml` ejecuta `npm ci` y `npm run build` en pull requests y pushes a `feat/**`; no ejecuta las suites. `deploy.yml` intenta publicar `dist/` en GitHub Pages con pushes a `main` y por ejecución manual. Este workflow es independiente de Vercel y necesita Pages configurado; Pages no aloja la API de Vercel.

Los documentos de verificación conservan los resultados de sus entregas, incluidos fixtures y pruebas locales. No reutilizar cifras de pruebas antiguas como resultado de esta revisión ni asumir correo, proveedores o servicios externos validados por una compilación.

## Archivo y limpieza

El 19 de octubre de 2026 se eliminó `Revisar para limpiar/` tras comprobar que no era destino de importaciones del código activo ni de las pruebas, no era una entrada de Vite y sus dos planes alternativos no estaban seleccionados por `curriculumSources.mjs`. La carpeta contenía 37 archivos de la SPA anterior, dos planes alternativos, dos archivos de herramientas de agentes, el gitlink de Superpowers y dos documentos de inventario/revisión. Los juegos externos del antiguo inventario ya habían sido retirados en una limpieza anterior.

Se eliminó también `.gitmodules`: su única definición apuntaba al submódulo dentro de la carpeta retirada. No se eliminaron componentes, modelos, recursos, datos geográficos ni fuentes del catálogo activo.

La [revisión anterior a la limpieza](https://github.com/McEngelsOP/IA/tree/6fdfdf6ef0d5e87bfa41148ef6f08c3aeaa23645/Revisar%20para%20limpiar) conserva todos esos archivos, el README de archivo y el inventario. Para recuperar una parte, usar esa revisión como referencia y revisar sus dependencias antes de integrarla. No restaurar la SPA anterior como si fuera el portal vigente.

Los archivos de PWA (`public/manifest.webmanifest`, `public/sw.js` e iconos) permanecen en el repositorio. Las entradas actuales de acceso y portal no enlazan el manifiesto ni registran ese service worker; la instalación y el modo offline no deben darse por activos por la sola presencia de los archivos.

## Apéndice histórico: SPA original archivada

El bloque siguiente se conserva para no perder decisiones y detalles de la implementación anterior. **No es una descripción de la aplicación actual ni una lista de instrucciones para restaurarla.** Sus rutas a `App.jsx`, `MallaCurricular.jsx`, juegos retirados y registro PWA remiten al contenido eliminado, recuperable desde la revisión de Git enlazada en la sección anterior. Sus afirmaciones de catálogo activo, interfaz móvil o funciones pendientes deben interpretarse en aquel contexto. Para editar el portal, usar las secciones anteriores y comprobar el código vigente.

### Arquitectura original: index.html

`App.jsx` decide la pantalla según la sesión de Supabase: `LoginPage` (login/registro/recuperación), `UpdatePassword` (llega del enlace del correo), `CareerSelect` o `MallaCurricular`. La malla recibe `user` y `carrera` — si `user` es `null` es **modo visitante**: puede explorar (y alternar de carrera con `onSwitchCarrera`) pero nada persiste, y las funciones sociales (profesores, panel lateral) ni se renderizan. El bloqueo real del visitante no es la UI: las tablas nuevas tienen políticas RLS solo para `authenticated`, el rol `anon` no tiene ninguna.

#### Carreras

- `data/carreras.js` indexa las mallas: `data/cursos.js` (IA, 200 créd), `data/cursosIndustrial.js` (Industrial y Comercial, 215 créd), `data/cursosMarketing.js` (Comunicación Empresarial y Marketing Digital, 215 créd) y `data/cursosPucp.js` (PUCP). Cada curso: `id`, `n` nombre, `c` ciclo, `cr` créditos, `r` prerequisitos, `rc` créditos aprobados requeridos (opcional; bloquea el marcado hasta alcanzar el umbral), `a` área temática (clave de `data/areas.js`; da color a las líneas de la malla — cada línea toma el color del área del curso al que llega).
- **Cursos equivalentes entre las carreras ESAN comparten el mismo `id`** (calc1, fis1, est1, prog1, com1, comlit2, fin, glob, precalc, pcrit, contab, costos, econ, estinf, adat1, fil, metinv, entre, ttesis1/2, ieint1/2, talleres, pre-formación): así los profesores y sus votos se ven desde las tres mallas ESAN sin tocar la base. Los **requisitos y créditos sí pueden variar por malla** (cada archivo declara los suyos; p. ej. `metinv` pide 85 créd. en Marketing y 105 en Industrial). **No renombrar esos ids** sin migrar la tabla `professors`. Los electivos NO se comparten (ele* en IA, iele* en Industrial, cele* en Marketing).
- **La PUCP es un sistema separado a propósito**: `data/cursosPucp.js` (Ingeniería Mecatrónica, 208.75 créd, sin ciclo 0) usa ids con prefijo **`pucp-`** en TODOS sus cursos, así profesores, votos, notas y reseñas nunca se cruzan con ESAN aunque los cursos se llamen igual. Además exporta `ELECTIVOS_PUCP` (catálogo de electivos por grupos; no son nodos del grafo, se muestran en un desplegable sobre la malla — campo `electivos` de la carrera). Co-requisitos `[ ]` y "nota 08+" `( )` del plan oficial se tratan como requisitos normales; en pares curso↔laboratorio solo queda la flecha lab → curso para no crear ciclos.
- Cada carrera declara `uni` y `ciclosLabel` (el header y `CareerSelect` los muestran). `buildMalla` normaliza las columnas al primer ciclo (`minC`) porque PUCP no tiene pre-formación.
- La carrera vive en `profiles.carrera` (`'ia'` | `'industrial'` | `'marketing'` | `'pucp-mecatronica'`), se elige en el registro (desplegable, va en los metadatos del signUp) y **es fija**: un trigger (`lock_carrera`) rechaza el cambio desde la app; solo el dueño la corrige desde el Table Editor. Cuentas anteriores a esta función tienen `carrera` NULL y `App.jsx` les muestra `CareerSelect` una sola vez.

#### Tema claro/oscuro

Toda la app (login, carreras, malla y paneles) tiene modo oscuro: `src/lib/theme.js` guarda la elección en localStorage (`malla-tema`) y la aplica como `data-theme="dark"` en `<html>` — el modo elegido es con el que la app inicia siempre en ese dispositivo. El botón flotante (🌙/☀️, abajo a la izquierda) vive en `App.jsx` y aparece en todas las pantallas. **El arcade no cambia**: tiene su propio look siempre oscuro y al abrirse tapa el botón. Los overrides oscuros viven al final de cada CSS en bloques `[data-theme='dark']` — al tocar estilos claros, revisar si el bloque oscuro del mismo archivo necesita el cambio equivalente.

#### Componentes

- `MallaCurricular.jsx` — grafo de cursos (layout calculado por carrera a nivel de módulo en `buildMalla`; el orden de las filas dentro de cada ciclo lo decide una heurística de baricentro —4 pasadas ida/vuelta, promedio, no mediana— que minimiza cruces de líneas: IA 25→7, Industrial 62→16, PUCP 153→55. No reordenar los archivos de datos a mano para "arreglar" el dibujo). Modos: qué abre / qué requiere / marcar llevados (BFS sobre dependencias; los cursos con `rc` no se marcan sin los créditos y caen en cascada al desmarcar) / qué puedo llevar / **planificar ciclo** / **ficha del curso** (solo con sesión). El avance se guarda en la tabla `progress` (array `done` y array `plan` sincronizados en la nube + localStorage). La leyenda de áreas incluye **filtro interactivo por área temática** (`selectedArea`), atenuando los cursos y aristas ajenos para estudiar ramas de especialización. El **buscador** de la toolbar normaliza tildes, resalta coincidencias (clase `hit`) y hace scroll suave al resultado (Enter cicla entre varios). El modo **planificar ciclo** arma el plan del próximo ciclo (solo cursos `disponible`; sincronizado en Supabase por alumno y con fallback en localStorage): la barra muestra créditos, aviso de carga alta (>22 créd), cuántos cursos desbloquearía y señala «cursos exigentes» con la RPC `stats_cursos` (query 28 — agregados anónimos de `course_status` con umbral de ≥5 registros; si la RPC no existe o eres visitante, el medidor funciona sin esa señal).
- `CourseDetail.jsx` — drawer derecho del modo «Ficha del curso»: estado académico con colores (aprobado verde / convalidado azul / matriculado naranja / desaprobado rojo / pendiente blanco), nota (reusa `grades`), veces llevado, fecha de aprobación, comentario personal privado y **reseñas anónimas por curso** (máx. 50 palabras; visibles entre carreras gracias al id compartido). Sincronización con «llevados»: aprobado/convalidado marcan el curso (con requisitos, respetando `rc`); matriculado/desaprobado/pendiente lo quitan en cascada; a la inversa, `reconcileStatuses` limpia estados contradictorios al marcar/desmarcar. Un curso llevado sin fila propia cuenta como **aprobado implícito**.
- `ProfessorPanel.jsx` — solo se muestra incrustado en la ficha del curso (prop `embedded`; ya no aparece bajo la barra de estado en los modos qué abre / qué requiere): profesores con corazones/dislikes, orden por `likes − dislikes`, insignia al primero si su puntaje es positivo, y **etiquetas** (hasta 3 por alumno por profesor, cada una se prende/apaga y suma a su conteo — tabla `professor_tags`, claves fijas en el CHECK y en `TAGS` del componente: estricto-bueno/estricto-mal/pasa/aprender/relajo/balance). Votos y etiquetas con actualización optimista.
- `SidePanel.jsx` — panel lateral (botón "Mi panel"): notas por curso, gráficos SVG hechos a mano (barras, línea e histograma, sin librería de charts), ponderado `Σ(nota×créd)/Σcréd` ignorando cursos de 0 créditos, pestaña «Estadísticas» (promedios, mejor/peor nota y ciclo, créditos, distribución de notas — todo calculado en el cliente desde `grades` y `done`), herramientas compartidas, pestaña «Logros» (catálogo en `src/lib/logros.js`, claves = CHECK de la tabla `logros`; se otorgan SOLO por la RPC `reclamar_logros` — SECURITY DEFINER que valida condiciones observables en el servidor, el cliente no puede insertar; MallaCurricular la llama al entrar y al abrir/cerrar el arcade y muestra un toast con los nuevos; **las notas no otorgan logros a propósito**: son autodeclaradas) y pestaña «Historia» (línea de tiempo privada calculada en el cliente: ingreso, cursos por ciclo, hitos de créditos 25/50/75/100 % y logros con fecha; incluye el botón «Generar mi resumen» que abre `ResumenCiclo.jsx` — póster compartible «Tu avance en números» dibujado en canvas 1080×1350 y descargado como PNG: solo números, nunca nombre ni alias; el alumno elige ciclo o carrera completa).
- `AcademicCalendar.jsx` — vista a pantalla completa (botón «📅 Calendario» de la toolbar, disponible también para visitantes) estilo Notion: grid mensual con hoy resaltado, leyenda por tipo y popups. Dos capas de eventos: **oficiales** de `data/calendario.js`, indexados por universidad en `CALENDARIO_POR_UNI` (clave = campo `uni` de `data/carreras.js`; ESAN tiene el 2026-2 del PDF oficial, PUCP está vacío a propósito — un alumno PUCP nunca ve fechas ESAN), inmutables en la UI; y **personales** por usuario sincronizados en la tabla `calendar_events` en Supabase con RLS (y en localStorage `malla-cal-${userId}` como fallback): se crean clicando un día o el «+» al pasar el mouse, con título, descripción y color a elegir (`COLORES_PERSONAL`), editables y borrables al clicarlos. Los colores de tipos y de eventos personales viven como clases `t-*`/`c-*` en AcademicCalendar.css con paleta propia clara y oscura (sin filtros). Máximo 3 pastillas por celda, el resto se agrupa en «+N más» (popup del día). Carga por lazy/Suspense en chunk propio, como el arcade.
- **PWA**: la app es instalable — `public/` tiene `manifest.webmanifest`, `sw.js` (service worker conservador: HTML por red primero con caché solo como respaldo offline, `/assets/` con hash por caché primero; al cambiar la constante `CACHE` se invalida todo) e íconos generados (motivo de mini-malla). El SW se registra en `main.jsx` solo en producción. Si un deploy se comporta raro en un dispositivo, subir la versión de `CACHE` en `sw.js`.
- **Móvil**: `src/lib/useMediaQuery.js` (hook de matchMedia reactivo) decide la interfaz en pantallas chicas: el botón del arcade **no se muestra en móvil** (los juegos no están optimizados para táctil), la malla tiene **zoom por pellizco** y botones ± (lienzo con `transform: scale` + wrapper que reserva el tamaño escalado; en desktop zoom = 1 y nada cambia), y el calendario pinta los eventos como **puntos de color** (tocar el día abre su lista). El hint «desliza» aparece una sola vez.
- `Arcade.jsx` + `DinoGame.jsx` — pantalla interna de juegos (botón «🕹 ARCADE» en la toolbar, disponible también para visitantes, solo en desktop; **carga por lazy/Suspense en chunk propio** para no engordar el bundle inicial — los estilos del botón viven en MallaCurricular.css por eso). Dino Run+ en canvas puro (rAF, estado en refs, overlays HTML para menú/pausa/game over) con 5 modos: Clásico, Fácil, Difícil, Caótico (eventos: viento/oscuridad/tormenta/terremoto/meteoritos) y Zen; power-ups, combos aéreos, día/noche y estadísticas al morir. **Todos los modos puntúan en el ranking salvo Zen** (inmortal = puntaje infinito; flag `ranked` en `onGameOver(score, ranked)` — decisión del usuario, antes solo puntuaba Clásico/Normal). El arcade abre en una **portada con la lista vertical de juegos** (tarjetas con descripción y mejor puntaje propio); al elegir uno, la vista se centra solo en ese juego con su ranking («← Todos los juegos» regresa). Segundo juego: `AstroDefensa.jsx` (clon de Asteroids, lazy dentro del arcade): nave con inercia, OVNIs que disparan al jugador, hiper-salto (Shift, sin invulnerabilidad a propósito), power-ups (escudo/rápido/expansivo/bomba de plasma/vida), vida extra cada 10 000 pts y bonus por oleada; modos Normal (3 vidas, sin power-ups, `game = 'astro'`), Fácil y Caótico — los tres puntúan. Tercer juego: `Galaxia.jsx` (Escuadrón Galáctico, shooter vertical, `game = 'galaxia'`, reusa los estilos `ad-*` de AstroDefensa.css): oleadas de drones/cazas/acorazados con tiro cruzado, casco como barra, power-ups y eventos (enjambre, lluvia de meteoritos) en Caótico; arrastre táctil con disparo automático en móvil. Cuarto juego: `Frogger.jsx` (Frogger+, `game = 'frogger'`, reusa los overlays `ast-*`): cruzar carretera (autos/camiones/motos/tren bala con aviso) y río (troncos, tortugas y troncos que se hunden en Difícil-Caótico, cocodrilos con boca peligrosa) hasta llenar 5 metas; niveles infinitos con biomas cada 5 (ciudad/noche/desierto/pantano/invierno — paleta + efecto: faros, arena, niebla, hielo que patina), turbo con Espacio (salto doble, cooldown), monedas y power-ups (⭐🕒🛡️⚡💰), eventos en Caótico (inundación de la berma, tráfico invertido, terremoto) y serpiente en Difícil; **solo puntúan Clásico, Difícil y Caótico** (Fácil y Zen mandan `ranked = false` — decisión del usuario); en Zen nada mata, los golpes solo regresan a la berma. Controles: flechas/WASD y deslizar en móvil (toque corto = adelante). Quinto juego: `MemoryMatch.jsx` (Memory Match+, `game = 'memoria'`, único juego DOM+CSS en vez de canvas — cartas con flip 3D, estilos propios `mm-*` en MemoryMatch.css): parejas en tableros crecientes (4×4 → 6×6, luego el tiempo se encoge) contra el reloj con **vidas**: quedarse sin tiempo cuesta 1 vida y el reloj se reinicia; pasar de nivel recupera solo 1 (tope el máximo del modo); gradiente Fácil 7 vidas/tiempo normal → Clásico 6/0.95 → Difícil 5/0.9 → Caótico 5/0.85, temática nueva por nivel (animales/frutas/retro/caritas/cosmos — sin banderas: Windows no las renderiza), rachas de 3 regalan power-ups (👁️ revelar, 🔍 pista, ⏳ tiempo, 🌀 rebarajar, máx. 3), cartas especiales (🧊 congela el reloj, 💀 trampa resta al voltear, 💣 explota si no se desactiva en 12 s, 🃏 comodín suelto que al emparejar limpia también a la gemela para que el tablero cierre en cero); Difícil/Caótico rebarajan las cartas boca abajo cada 12/9 s y Caótico invierte colores por momentos; **solo puntúan Clásico, Difícil y Caótico**; Zen no tiene reloj (no termina). Tecla R reinicia. Ranking global top 10 por juego (claves `'dino'`, `'astro'`, `'galaxia'`, `'frogger'` y `'memoria'` en el CHECK de `game_scores` — juego nuevo = ampliar CHECK + lista blanca de `submit_game_score`, script consolidado `arcade.sql`). El ranking es **por temporada académica** (`YYYY-I` ene–jul / `YYYY-II` ago–dic; columna `season` en `game_scores`, PK alumno+juego+temporada — script `arcade.sql`, Query 26): el arcade muestra la temporada actual con un selector y las pasadas quedan como salón de la fama de solo lectura; `submit_game_score` estampa la temporada del servidor y `my_game_score` devuelve el mejor de la actual. La regla de temporada vive **duplicada** en `src/lib/temporada.js` y en `temporada_actual()` (SQL) — si se cambia una, cambiar la otra. El Dino monta una **patineta** (cosmética: flip al subir, aterriza sobre ella) y usa sprites pixel art estilo Chrome con paleta día/noche monocroma. El ranking firma con el **alias** y el cliente NUNCA puede leer `student_id` de `game_scores` (permiso a nivel de columna, como en los comentarios) — no exponer jamás un join alias↔cuenta. Escrituras solo vía RPC `submit_game_score` (SECURITY DEFINER: valida juego/tope 100 000, estampa alias, conserva el máximo); el mejor propio se lee con `my_game_score`. El visitante juega pero no puntúa (RLS solo `authenticated`). Si no hay alias, la RPC falla con `ALIAS_REQUIRED` y la UI ofrece elegirlo (mismo flujo único de las reseñas).
- **Juegos locales en iframe**: Para juegos de terceros o experimentales sin ranking global, se alojan en `public/juegos/` y se renderizan aislados dentro de un `<iframe src="/juegos/...">` con botón de pantalla completa y foco automático. Catálogo local activo: **Escape Roads**, **Lighthouse** y **Block Ninja**. (Se depuraron BMX Racer, Backrooms, Memoria CSS, Ghost Writer y The Mine para aligerar el repositorio).




