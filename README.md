# Lyra Campus

**[Descargar Lyra-V1.0-android.apk](https://github.com/McEngelsOP/IA/releases/download/v1.0-android/Lyra-V1.0-android.apk)** · **[Ver todas las versiones](https://github.com/McEngelsOP/IA/releases)**

Lyra ayuda a estudiantes de Universidad ESAN a entender su avance, planificar sus cursos y organizar el semestre. El catálogo activo incluye las 18 carreras ESAN presentes en las fuentes del proyecto. Es una herramienta independiente de apoyo; no confirma matrícula ni sustituye información institucional.

La rama de trabajo es **`main`**. Incluye la integración de Oficial y la revisión general de noviembre. Los cambios de interfaz se publican mediante Git; las migraciones y Edge Functions tienen su propio proceso de activación.

## Recorrido del estudiante

| Sección | Funciones |
| --- | --- |
| Inicio | Actividades, pendientes, avance, calificaciones y logros privados. |
| Mi carrera | Malla, requisitos, progreso, matrícula, ficha del curso con dificultad y profesores de la comunidad, y fuente del catálogo. |
| Mi semestre | Calendario y tareas, horario Excel, notas y objetivos, cursos actuales. |
| Planificar | Diagnóstico, comparación de cargas, proyección y plan guardado. |
| Asistente | Consultas con el plan, requisitos, créditos aprobados y matrícula actual. |

Grupos, Mod Focus, Recursos y Buzón están en Más herramientas. Arcade y las claves personales de IA están en el perfil. El mismo portal funciona en escritorio y móvil; `ios-android.html` conserva el enlace antiguo mediante una redirección.

## Desarrollo y comprobaciones

Requisitos: Node.js 22.13 o posterior (22 LTS o 24+) y npm. El workspace raíz incluye el Worker de Geoduelo y usa un solo lockfile.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Configura las variables públicas `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Las claves de IA, `service_role` y secretos del Worker permanecen en sus servidores. La interfaz de visitante funciona sin credenciales, pero no guarda datos privados.

```bash
npm run check
npx playwright install chromium
npm run test:browser
```

`check` verifica catálogo reproducible, reglas, PostgreSQL local, Worker y compilación. Las pruebas de navegador usan credenciales fixture y respuestas simuladas, sin cuentas reales ni consumo de IA. `SETUP_BROWSER` indica un Chromium instalado y `WORKSPACE_SCREENSHOTS` una carpeta opcional de capturas.

## Organización

| Ruta | Responsabilidad |
| --- | --- |
| `src/app/` | Composición, navegación, montaje y estilos del portal. |
| `src/core/` | Reglas académicas y modelos de calendario independientes de universidad. |
| `src/features/` | Funciones y estilos agrupados por responsabilidad. |
| `src/institutions/` | Registro de instituciones y configuración/catálogos ESAN. |
| `src/shared/` | Componentes, cliente Supabase, sesión y recursos compartidos. |
| `data/catalogs/esan/` | Markdown de origen y revisiones inmutables de las mallas. |
| `scripts/` | Generación, comprobaciones de navegador y datos de Geoduelo. |
| `supabase/` | Migraciones, SQL vigente y Edge Functions. |
| `workers/geoduelo/` | Servidor de partidas en Cloudflare. |
| `Pagina promocional/` | Landing independiente con demostraciones ilustrativas. |
| `tests/` | Pruebas de reglas, SQL y navegador. |

`pagina.html` contiene la estructura; su lógica y CSS están en `src/app/portal.js` y `portal.css`. Las superficies React se importan por demanda.

## Catálogo y activación del servidor

```bash
node scripts/generateCurricula.mjs
node scripts/generateCurricula.mjs --check
```

El generador sincroniza opciones, catálogos, revisiones, catálogo del asesor y SQL. No editar salidas generadas ni renombrar IDs de cursos: están ligados a avances, notas y comunidad.

El backend de Lyra quedó activado el 20 de octubre de 2026: catálogo de 18 carreras, asignación persistente de revisión y `study-advisor` v14. La migración conserva los datos existentes y bloquea registros externos a ESAN.

Para otro entorno con el esquema previo, ejecutar **`supabase/careers_catalog.sql`** y desplegar **`study-advisor`** de la misma revisión. No ejecutar todos los SQL históricos. Cambiar de rama no despliega automáticamente SQL o Edge Functions; un preview que comparte variables de producción utiliza los mismos servicios remotos.

Vite genera `dist/`. Las entradas y rutas de publicación permanecen en `vite.config.js` y `vercel.json`. La validación automática incluye `aea`. Vercel publica `main`; el flujo opcional de GitHub Pages es manual y requiere que Pages esté habilitado antes de ejecutarlo.

## Documentación

- [Contexto técnico](CONTEXT.md)
- [Carreras y revisiones](docs/careers.md)
- [Arquitectura](docs/architecture.md)
- [Piloto y expansión](docs/esan-pilot.md)
- [Limpieza](docs/cleanup.md)
- [Configuración inicial](docs/initial-setup.md)
- [Revisión de noviembre y pasos manuales de IA](docs/revision-main-2026-11-03.md)
- [Matrícula y tareas](docs/text-tasks-semester.md)
- [Geoduelo](docs/geoduelo.md) y [partidas en línea](docs/geoduelo-online.md)
- [Mantenimiento SQL](supabase/SQL_MAINTENANCE.md)

## Asistente personal

El historial del asistente se conserva únicamente en el navegador y dispositivo, separado por cuenta. Consulta datos académicos autorizados cuando son necesarios y ofrece borradores editables de tareas/eventos con guardado validado. Arquitectura, límites y activación: [docs/assistant-local.md](docs/assistant-local.md).

## Fichas y comentarios de la comunidad

En Mi carrera, el botón **Ficha del curso** y su selector abren directamente los datos del curso: requisitos, registro académico, dificultad, profesores, recomendaciones y etiquetas. Los fallos de carga de dificultad y profesores se muestran por separado.

Recursos conserva la descripción editable por su autor y recupera los comentarios anteriores en **Comentarios de la comunidad**. Se consultan al desplegarlos, con paginación de 20 y solo las columnas públicas; no se leen identificadores de autores. Esta corrección reutiliza las tablas y permisos existentes, sin cambios de SQL.

## Acceso al código

El repositorio de desarrollo debe mantenerse privado y compartirse solo con colaboradores. Para probar Lyra, compartir la web publicada. Ver [seguridad](SECURITY.md) y [uso del código](NOTICE.md). Las guías administrativas y los informes de producción se conservan fuera de GitHub.

## Ampliación del sistema en revisión

La ampliación integrada en `Oficial` añade sincronización de preferencias, escalas institucionales, actualización de mallas, prevención de calendario, consulta sin conexión y administración de reportes/servicios. [Funcionamiento y límites](docs/system-complete.md). El SQL general y la resolución de nuevas versiones de malla en `study-advisor` siguen pendientes de activación; estas funciones no se presentan como activadas en producción. Tras `npm run build`, `npm run test:offline` comprueba la PWA con un corte real de conexión.

La política independiente del asistente exige claves propias a cuentas externas o sin afiliación ESAN verificada, unifica las cuotas y añade modos de respuesta y contexto consultado. [Acceso de IA, instalación y pruebas](docs/ai-access-policy.md).

La comparación de los últimos commits de Oficial y la recuperación del borrador se documentan en [la reconciliación de noviembre](docs/integration-oficial.md). La ampliación de universidades requiere [activación manual de SQL y funciones](docs/universities-curriculum.md). El modo sin conexión permanece pendiente y desactivado.

Inicio permite cambiar tamaños con los botones o arrastrando la esquina de cada bloque, con adaptación en vivo, teclado, cancelación, deshacer y recuperación del diseño. La paloma permanece fija. Los tamaños personalizados se conservan por cuenta y usan la sincronización existente. El acceso mantiene su tema oscuro aunque el portal se utilice en modo claro.
