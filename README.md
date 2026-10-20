# Lyra Campus

Lyra ayuda a estudiantes de Universidad ESAN a entender su avance, planificar sus cursos y organizar el semestre. El catálogo activo incluye las 18 carreras ESAN presentes en las fuentes del proyecto. Es una herramienta independiente de apoyo; no confirma matrícula ni sustituye información institucional.

La rama de trabajo es **`aea`**. Esta reorganización incorpora la limpieza de `main`; los cambios nuevos se mantienen en `aea`.

## Recorrido del estudiante

| Sección | Funciones |
| --- | --- |
| Inicio | Actividades, pendientes, avance, calificaciones y logros privados. |
| Mi carrera | Malla, requisitos, progreso, matrícula, fichas y fuente del catálogo. |
| Mi semestre | Calendario y tareas, horario Excel, notas y objetivos, cursos actuales. |
| Planificar | Diagnóstico, comparación de cargas, proyección y plan guardado. |
| Asistente | Consultas con el plan, requisitos, créditos aprobados y matrícula actual. |

Grupos, Mod Focus, Recursos y Buzón están en Más herramientas. Arcade y las claves personales de IA están en el perfil. El mismo portal funciona en escritorio y móvil; `ios-android.html` conserva el enlace antiguo mediante una redirección.

## Desarrollo y comprobaciones

Requisitos: Node.js 20 o posterior y npm. El workspace raíz incluye el Worker de Geoduelo y usa un solo lockfile.

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
| `supabase/` | SQL y Edge Functions; restauración en `history/`. |
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

Antes de activar esta versión en un entorno conectado, ejecutar **`supabase/careers_catalog.sql`** y desplegar **`study-advisor`** de esta rama. La migración conserva datos, registra revisiones y bloquea registros externos a ESAN. No ejecutar todos los SQL históricos. El frontend admite el esquema anterior; la asignación persistente de revisión requiere la migración.

Cambiar de rama no despliega automáticamente SQL o Edge Functions. Un preview que comparte variables de producción utiliza los mismos servicios remotos. Esta tarea prepara los cambios de servidor en `aea`; no los aplica a producción.

Vite genera `dist/`. Las entradas y rutas de publicación permanecen en `vite.config.js` y `vercel.json`. La validación automática incluye `aea`; GitHub Pages conserva su despliegue de `main`.

## Documentación

- [Contexto técnico](CONTEXT.md)
- [Carreras y revisiones](docs/careers.md)
- [Arquitectura](docs/architecture.md)
- [Piloto y expansión](docs/esan-pilot.md)
- [Limpieza](docs/cleanup.md)
- [Configuración inicial](docs/initial-setup.md)
- [Matrícula y tareas](docs/text-tasks-semester.md)
- [Geoduelo](docs/geoduelo.md) y [partidas en línea](docs/geoduelo-online.md)
- [Mantenimiento SQL](supabase/SQL_MAINTENANCE.md)
