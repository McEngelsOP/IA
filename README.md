# Lyra AI

Plataforma web de organización académica para estudiantes: avance de la malla, notas, cursos del semestre, calendario, tareas y herramientas de estudio. Los datos personales se guardan por cuenta en Supabase.

Esta documentación describe el código de la rama `main`, revisado el **19 de octubre de 2026**. La presencia de una función en el repositorio no confirma que su SQL, secretos o servidor estén instalados en un entorno remoto.

## Funciones

- Registro, confirmación de correo, acceso por código de alumno y recuperación de contraseña.
- Catálogo de **18 carreras ESAN y Mecatrónica PUCP**, con mallas, prerrequisitos, avance, notas y planificación.
- Inicio con información académica de la cuenta, estadísticas, logros y la identidad visual de Lyra.
- Calendario con eventos, horarios semanales y tareas; importación de horario Excel y revisión de propuestas de **Texto → tareas** antes de guardarlas.
- Asesor IA con proveedores configurables Gemini, Groq y OpenRouter; **Mi IA** permite gestionar claves personales. La disponibilidad depende de las credenciales, cuotas y respuesta de cada proveedor.
- Brújula para proyectar ciclos mediante cálculos locales; Mod Focus con sesiones e historial; grupos de estudio por curso.
- Recursos compartidos, comunidad de cursos y profesores.
- Buzón para Aplicativo, Docente y Universidad, integrado con `/api/mailbox` y Google Apps Script.
- Arcade con siete juegos, incluido **Geoduelo local y online**. Online requiere su servidor de Cloudflare y configuración propia.

La aplicación funcional adapta `pagina.html` a escritorio y móvil. `ios-android.html` es una maqueta independiente de navegación móvil que Vite sigue compilando; no sustituye al portal ni genera un instalador nativo.

## Arquitectura y archivos

El frontend combina HTML, CSS y JavaScript en las páginas de entrada con componentes React que se cargan bajo demanda. Se compila con Vite.

| Ruta | Función |
| --- | --- |
| `login.html` | Acceso, registro y recuperación; usa `src/lib/accessController.js`. |
| `pagina.html` | Portal académico funcional, también en móvil. |
| `ios-android.html` | Maqueta independiente de navegación móvil. |
| `Pagina promocional/` | Landing con demostraciones ilustrativas y configuración de Vite propia. |
| `src/` | Componentes, modelos, estilos, marca y catálogos usados por el portal. |
| `public/` | Recursos estáticos que Vite copia a la salida, incluidos los datos y recursos de Geoduelo. |
| `api/mailbox.js` | Endpoint de Vercel que valida y reenvía el buzón a Google Apps Script. |
| `supabase/` | SQL, guías de instalación/mantenimiento y código de Edge Functions. |
| `workers/geoduelo/` | Backend online de Cloudflare Workers y Durable Objects, con despliegue y pruebas propios. |
| `Mallas curriculares/`, `scripts/` | Fuentes y herramientas de generación de catálogos y datos. |
| `tests/`, `docs/` | Pruebas, decisiones y guías por función. |

`vite.config.js` compila las cuatro entradas HTML. `vercel.json` redirige `/` a `/login.html` y ofrece `/promocional` como acceso a la landing cuando se despliega el proyecto desde la raíz.

## Desarrollo local

Instala Node.js y npm; la validación del frontend en GitHub Actions utiliza Node 20.

```bash
git clone --branch main https://github.com/McEngelsOP/IA.git
cd IA
npm ci
cp .env.example .env.local
npm run dev
```

En Windows se puede copiar `.env.example` a `.env.local` desde el explorador o con `Copy-Item .env.example .env.local` en PowerShell.

Completa las variables de `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-clave-publica-anon
# Opcional: URL pública del Worker de Geoduelo ya configurado.
VITE_GEODUELO_ONLINE_URL=
```

Las variables `VITE_` se incorporan al código del navegador. Nunca incluir en ellas claves de proveedores, `service_role`, credenciales de base de datos ni `TICKET_SECRET`. El archivo de ejemplo contiene solo valores de muestra.

Comandos del frontend:

```bash
npm run dev
npm run build
npm run preview
```

El servidor de desarrollo abre `/login.html` y el build se genera en `dist/`. `vite preview` permite revisar el frontend compilado; la función `/api/mailbox` necesita un entorno que ejecute la API de Vercel.

## Configuración de servicios y despliegue

**Frontend en Vercel.** Para el portal completo, usar la raíz del repositorio, `npm run build` y salida `dist`, con sus variables públicas. Para desplegar solo la landing, usar `Pagina promocional` como Root Directory y su propio `package.json`. Si la landing está en otro dominio, configurar `data-app-url` en su `index.html` con la URL real del acceso.

**Autenticación.** Registrar el dominio y la ruta `/login.html` en la configuración de redirecciones de Supabase. El dominio usado anteriormente es `https://l-esan.vercel.app`; comprobar el dominio efectivo antes de configurar enlaces de correo. El controlador construye el callback desde el origen actual.

**Supabase.** El push del frontend no aplica SQL ni despliega Edge Functions. Revisar lo instalado y la guía del módulo antes de ejecutar scripts: la carpeta incluye instaladores, cambios y material histórico, no una secuencia para ejecutar completa. Empezar por [calendario](supabase/CALENDAR_SETUP.md) y [mantenimiento SQL](supabase/SQL_MAINTENANCE.md), según la tarea. El código incluye `auth-by-code`, `study-advisor`, `text-to-tasks`, `personal-ai` y `excel-schedule`.

**Geoduelo online.** Se despliega por separado desde `workers/geoduelo`; requiere Cloudflare, su SQL y `VITE_GEODUELO_ONLINE_URL`. Los secretos del Worker permanecen en Cloudflare. Consultar la [guía online](docs/geoduelo-online.md).

**Buzón.** La API implementa el reenvío a Google Apps Script y exige confirmación del servicio antes de comunicar éxito. La entrega depende del despliegue y permisos del servicio externo.

La rama de producción se elige en cada proyecto de Vercel. Los documentos antiguos que mencionan `Oficial` o `aea` describen etapas anteriores y no confirman la configuración remota actual.

## Pruebas

Ejemplos de verificaciones por módulo:

```bash
node --test tests/calendarModel.test.mjs tests/calendarEditing.test.mjs tests/focusModel.test.mjs tests/studyGroups.test.mjs
node --test tests/textTasks.test.mjs tests/scheduleImport.test.mjs tests/personalAi.test.mjs tests/webSession.test.mjs
node scripts/generateCurricula.mjs --check
```

El Worker tiene su propia suite:

```bash
cd workers/geoduelo
npm ci
npm test
```

Las pruebas de navegador requieren Playwright y un navegador compatible; algunas pruebas SQL requieren PGlite. Consultar las guías de cada módulo para preparar sus fixtures y dependencias. El `package.json` raíz no define `npm test`; `validate.yml` instala dependencias y compila, pero no ejecuta las suites. `deploy.yml` intenta publicar `dist/` en GitHub Pages al recibir cambios en `main`; es independiente de Vercel y no ejecuta la API del buzón.

Un build correcto y las pruebas con datos simulados no certifican el correo real, la disponibilidad de proveedores ni la configuración de producción.

## Guías

- [Contexto técnico y decisiones](CONTEXT.md)
- [Administración](ADMIN.md) — verificar los estados y pendientes históricos antes de operar.
- [Carreras y generación de catálogos](docs/careers.md)
- [Configuración inicial](docs/initial-setup.md)
- [Texto → tareas y matrícula del semestre](docs/text-tasks-semester.md)
- [Claves personales de IA](docs/personal-ai-keys.md)
- [Grupos de estudio](supabase/STUDY_GROUPS_SETUP.md)
- [Mod Focus](supabase/FOCUS_SETUP.md)
- [Geoduelo local](docs/geoduelo.md) y [online](docs/geoduelo-online.md)
- [Página promocional](Pagina%20promocional/README.md)

## Material histórico y limpieza

El 19 de octubre de 2026 se retiró `Revisar para limpiar/` de `main` tras revisar importaciones, configuración y fuentes del catálogo. Contenía la SPA anterior, dos planes alternativos no seleccionados, herramientas de agentes y el inventario histórico. También se retiró `.gitmodules`, cuya única entrada correspondía al submódulo archivado de Superpowers. El código y las 18 fuentes del catálogo activo se conservan.

El material eliminado puede consultarse y recuperarse desde la [última revisión anterior a esta limpieza](https://github.com/McEngelsOP/IA/tree/6fdfdf6ef0d5e87bfa41148ef6f08c3aeaa23645/Revisar%20para%20limpiar), incluido su README e inventario. El apéndice histórico de `CONTEXT.md` describe esa versión; no es una implementación disponible en el árbol actual.

El acceso actual usa `public/login-landscape.mp4`, su póster WebP y `public/Cat.jpg` para móvil. El video raíz `270983.mp4` permanece pendiente de limpieza; esta actualización documental no lo mueve ni lo elimina.

Los archivos de manifiesto, service worker e iconos de PWA permanecen en `public/`, pero las entradas actuales de acceso y portal no enlazan el manifiesto ni registran el service worker. Su presencia por sí sola no confirma que la aplicación actual sea instalable u opere sin conexión.
