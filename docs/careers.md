# Carreras y planes curriculares

El registro, la selección de cuentas anteriores y Administración comparten `src/data/careerOptions.js`: 18 carreras ESAN y Mecatrónica PUCP. Las opciones se ordenan alfabéticamente dentro de cada universidad. La carrera elegida se envía en `auth.signUp` y se guarda en `profiles.carrera` mediante el trigger de Supabase.

Inicio, la malla, el planificador, las fichas, Calendario/Horarios, Grupos de estudio, Mod Focus y Herramientas usan el catálogo de esa carrera. No se matricula automáticamente al estudiante: Focus sigue mostrando exclusivamente cursos marcados como Matriculado. Las cuentas sin carrera pueden elegirla una vez desde Inicio; las cuentas que ya la tienen conservan el candado existente.

## Fuentes

Los 21 Markdown de `Mallas curriculares/` representan 18 carreras distintas. La copia `Malla_Ingenieria_en_Inteligencia_Artificial (1).md` es idéntica al archivo sin sufijo. Industrial y Sistemas tienen versiones alternativas: no se mezclan planes ni se muestran carreras duplicadas.

- IA, Industrial y Comunicación/Marketing conservan sus catálogos e identificadores existentes, incluidos avances, profesores y notas. Sus nombres y totales coinciden con las fuentes.
- Para Sistemas se utiliza el archivo identificado como plan 2024 (`INGITIS_2024`), con 78 cursos y 213 créditos. El archivo alternativo sin año se conserva como fuente, sin fusionarlo con ese plan.
- Las cinco nuevas mallas de la serie 2026 y las otras diez carreras nuevas usan los archivos indicados en `scripts/curriculumSources.mjs`.
- Los Markdown son datos curriculares, no instrucciones de implementación.

| Carrera ESAN | Clave | Cursos | Créditos |
|---|---|---:|---:|
| Administración | administracion | 69 | 200 |
| Administración y Finanzas | administracion-finanzas | 73 | 215 |
| Administración y Marketing | administracion-marketing | 72 | 212 |
| Administración y Negocios Internacionales | administracion-negocios-internacionales | 74 | 215 |
| Comunicación Empresarial y Marketing Digital | marketing | 75 | 215 |
| Contabilidad | contabilidad | 68 | 200 |
| Derecho | derecho | 71 | 202 |
| Derecho Corporativo | derecho-corporativo | 87 | 251 |
| Economía | economia | 67 | 200 |
| Economía y Finanzas | economia-finanzas | 72 | 220 |
| Economía y Negocios Internacionales | economia-negocios-internacionales | 72 | 220 |
| Ingeniería Ambiental | ambiental | 66 | 200 |
| Ingeniería de Software | software | 69 | 200 |
| Ingeniería de Tecnologías de Información y Sistemas | sistemas | 78 | 213 |
| Ingeniería en Ciencia de Datos | ciencia-datos | 66 | 200 |
| Ingeniería en Inteligencia Artificial | ia | 69 | 200 |
| Ingeniería Industrial y Comercial | industrial | 77 | 215 |
| Psicología | psicologia | 82 | 225 |

PUCP conserva 64 cursos y 208,75 créditos, con sus identificadores separados.

## Generación y optimización

```bash
node scripts/generateCurricula.mjs
node scripts/generateCurricula.mjs --check
```

El generador produce el índice ligero de opciones, los 15 catálogos adicionales y `supabase/careers_catalog.sql`; también sincroniza las listas y totales de los scripts consolidados de Focus/Logros. El navegador no descarga ni analiza los Markdown. El acceso carga solo los nombres de las carreras; la malla calcula y conserva el grafo de la carrera que se abre, sin construir los 19 al iniciar.

Se resuelven explícitamente erratas de escritura (`Comuncaciones`, `Managemnet`, `Entreprenurship`, singular/plural de Tecnología, Matemática y Optimización, variantes de Marketing y Recursos Naturales). Se conservan los títulos originales. La lectura de requisitos reconoce nombres completos con comas, separadores coma/punto y coma, requisitos consecutivos y umbrales de créditos. Un requisito desconocido o un total incoherente detiene la generación; no se omiten silenciosamente.

Los cursos nuevos con nombre y créditos equivalentes reutilizan identificadores conocidos de ESAN, incluidos los talleres abreviados. Los cursos nuevos restantes usan identificadores derivados de nombre/créditos; las plazas de electivos incluyen la carrera. No se renombran los cursos anteriores. Los electivos conservan el aviso «Según electivo»: no se inventa un catálogo de especialidades que los Markdown no contienen.

Supabase comparte una sola instancia de cliente entre `pagina.html` y Herramientas, evitando conexiones de autenticación duplicadas.

## Activación en Supabase

En el proyecto `esuyrftsopevmbhvhwov`, ejecutar **solo `supabase/careers_catalog.sql`** en SQL Editor, antes de publicar el frontend nuevo en `l-esan`. No volver a ejecutar `setup.sql`, `carrera.sql`, `carrera_pucp.sql` ni todos los scripts históricos.

La migración es transaccional y repetible. Sustituye el CHECK de carrera y el trigger de registro, valida carrera/universidad y conserva perfiles existentes, avances, notas, RLS y candados. Actualiza las funciones de Focus y Logros si ya están instaladas, manteniendo sus permisos. No elimina tablas ni registros ni cambia las carreras de cuentas existentes.

La base activa no se modificó desde este entorno. La ejecución manual de esta migración es necesaria para que los registros de las carreras nuevas funcionen en producción.

## Verificación

- `node --test tests/careerCatalog.test.mjs`: 21 comprobaciones; totales, fuentes reproducibles, requisitos completos sin ciclos, geometría del grafo, disponibilidad, filtros de matrícula y erratas/nombres compuestos.
- `PGLITE_MODULE=/ruta/a/pglite/dist/index.js node tests/careerCatalog.sql.test.mjs`: PostgreSQL local; trigger de registro para 19 carreras, matrícula en Focus, logro de malla completa con el total correcto, migración repetida con/sin secciones opcionales, conservación de avance y candado de carrera, rechazo de carrera/código inválidos y acceso anónimo.
- `python tests/careerRegistration.py`: Chromium + Supabase simulado; registro de las 19 carreras hasta Inicio, datos de cada malla, selectores de calendario y grupos, matrícula de Focus, Brújula y selección de una cuenta sin carrera.
- `python tests/accessViewport.py`: matriz de 80 combinaciones de vistas con/sin error en ocho tamaños, navegación directa, replay y alturas extremas.
- `npm run build`.

Las pruebas de registro no crean cuentas reales ni equivalen a validar la migración en producción.
